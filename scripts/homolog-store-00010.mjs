/**
 * Homologação read-only + gravação descartável (2099-03) da filial código 00010.
 * Não altera metas reais de 2026. Ao final apaga o rascunho de teste se criado.
 */
import fs from "fs";
import pg from "pg";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const password = env.SUPABASE_DB_PASSWORD;
const ref = (env.VITE_SUPABASE_URL || "").match(/https:\/\/([^.]+)/)?.[1];
if (!ref || !password) {
  console.log(JSON.stringify({ ok: false, stage: "env", reason: "missing_env" }));
  process.exit(1);
}

const candidates = [
  { host: `db.${ref}.supabase.co`, user: "postgres", port: 5432 },
  { host: "aws-0-sa-east-1.pooler.supabase.com", user: `postgres.${ref}`, port: 6543 },
  { host: "aws-0-us-east-1.pooler.supabase.com", user: `postgres.${ref}`, port: 6543 },
];

let client = null;
let lastErr = null;
for (const c of candidates) {
  const tryClient = new pg.Client({
    host: c.host,
    port: c.port,
    database: "postgres",
    user: c.user,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });
  try {
    await tryClient.connect();
    client = tryClient;
    break;
  } catch (e) {
    lastErr = e;
    try {
      await tryClient.end();
    } catch {
      /* ignore */
    }
  }
}
if (!client) {
  console.log(JSON.stringify({ ok: false, stage: "connect", reason: String(lastErr?.message || lastErr).slice(0, 200) }));
  process.exit(1);
}

function prefix(id, n = 8) {
  return String(id).slice(0, n);
}

function mapTier(t) {
  return {
    name: t.name,
    minAttainmentPct: t.minPct ?? t.minAttainmentPct,
    commissionPct: t.commissionPct,
    bonus: (t.bonusCents ?? t.bonus_cents ?? 0) / 100,
    managerPct: t.managerCommissionPct ?? t.managerPct ?? null,
    managerBonus:
      t.managerBonusCents != null ? Number(t.managerBonusCents) / 100 : t.managerBonus ?? null,
  };
}

try {
  // ——— 1. Identidade da filial 00010 ———
  const storeRes = await client.query(
    `
    select s.id::text, s.tenant_id::text, s.code, s.name, s.trade_name,
           t.name as tenant_name
    from store s
    left join tenant t on t.id = s.tenant_id
    where s.code = $1
    limit 3
  `,
    ["00010"],
  );
  if (!storeRes.rows.length) {
    console.log(JSON.stringify({ ok: false, stage: "identity", reason: "store_00010_not_found" }));
    await client.end();
    process.exit(1);
  }
  const store = storeRes.rows[0];
  const identity = {
    storeId: store.id,
    storeIdPrefix: prefix(store.id),
    tenantId: store.tenant_id,
    tenantIdPrefix: prefix(store.tenant_id),
    tenantName: store.tenant_name,
    erpCode: store.code,
    legalName: store.name,
    tradeName: store.trade_name,
    displayName: store.trade_name || store.name,
  };

  // Meta outubro 2026 publicada
  const octRes = await client.query(
    `
    select id::text, store_id::text, tenant_id::text, name,
           starts_on::text, ends_on::text, target_cents, tier_mode,
           spread_unidentified, published_at is not null as published,
           published_at::text, tiers, groups
    from goal
    where store_id = $1::uuid
      and starts_on <= '2026-10-31' and ends_on >= '2026-10-01'
      and published_at is not null
    order by published_at desc
    limit 3
  `,
    [store.id],
  );
  const october = octRes.rows[0]
    ? {
        id: octRes.rows[0].id,
        idPrefix: prefix(octRes.rows[0].id),
        name: octRes.rows[0].name,
        startsOn: octRes.rows[0].starts_on,
        endsOn: octRes.rows[0].ends_on,
        target: Number(octRes.rows[0].target_cents) / 100,
        tierMode: octRes.rows[0].tier_mode,
        spreadUnidentified: octRes.rows[0].spread_unidentified === true,
        published: octRes.rows[0].published,
        tiers: (octRes.rows[0].tiers || []).map(mapTier),
        groups: (octRes.rows[0].groups || []).map((g) => ({
          shiftId: g.shiftId,
          name: g.name,
          pct: g.pct,
        })),
      }
    : null;

  // ——— 4. Gravação descartável (2099-03) ———
  const disposableName = `JARVIS HOMOLOG DESCARTAVEL 2099-03 ${Date.now().toString(36)}`;
  const disposableStarts = "2099-03-01";
  const disposableEnds = "2099-03-31";
  let saveResult = null;
  if (october) {
    const tiersJson = october.tiers.map((t) => ({
      name: t.name,
      minPct: t.minAttainmentPct,
      commissionPct: t.commissionPct,
      bonusCents: Math.round(t.bonus * 100),
      ...(t.managerPct != null
        ? {
            managerCommissionPct: t.managerPct,
            managerBonusCents: Math.round((t.managerBonus ?? 0) * 100),
          }
        : {}),
    }));
    const groupsJson = october.groups.map((g) => ({
      shiftId: g.shiftId,
      name: g.name,
      pct: g.pct,
    }));
    const ins = await client.query(
      `
      insert into goal (
        tenant_id, store_id, name, starts_on, ends_on, target_cents,
        tier_mode, spread_unidentified, tiers, groups, published_at
      ) values (
        $1::uuid, $2::uuid, $3, $4::date, $5::date, $6,
        $7, $8, $9::jsonb, $10::jsonb, null
      )
      returning id::text, name, starts_on::text, ends_on::text, target_cents,
                tier_mode, spread_unidentified, published_at is not null as published,
                tiers, groups
    `,
      [
        store.tenant_id,
        store.id,
        disposableName,
        disposableStarts,
        disposableEnds,
        Math.round(500_000 * 100),
        october.tierMode,
        october.spreadUnidentified,
        JSON.stringify(tiersJson),
        JSON.stringify(groupsJson),
      ],
    );
    const row = ins.rows[0];
    const persisted = {
      idPrefix: prefix(row.id),
      name: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      target: Number(row.target_cents) / 100,
      tierMode: row.tier_mode,
      spreadUnidentified: row.spread_unidentified === true,
      published: row.published,
      tiers: (row.tiers || []).map(mapTier),
      groups: (row.groups || []).map((g) => ({
        shiftId: g.shiftId,
        name: g.name,
        pct: g.pct,
      })),
    };
    const authorized = {
      name: disposableName,
      startsOn: disposableStarts,
      endsOn: disposableEnds,
      target: 500_000,
      tierMode: october.tierMode,
      spreadUnidentified: october.spreadUnidentified,
      tiers: october.tiers,
      groups: october.groups,
      published: false,
    };
    const diffs = [];
    if (persisted.target !== authorized.target) diffs.push(`target ${persisted.target}≠${authorized.target}`);
    if (persisted.tierMode !== authorized.tierMode) diffs.push(`tierMode`);
    if (persisted.spreadUnidentified !== authorized.spreadUnidentified) diffs.push(`spread`);
    if (persisted.tiers.length !== authorized.tiers.length) diffs.push(`tierCount`);
    for (let i = 0; i < authorized.tiers.length; i++) {
      const a = authorized.tiers[i];
      const b = persisted.tiers[i];
      if (!b || a.minAttainmentPct !== b.minAttainmentPct || a.commissionPct !== b.commissionPct || a.bonus !== b.bonus) {
        diffs.push(`tier[${i}]`);
      }
      if (a.managerPct != null && b?.managerPct !== a.managerPct) diffs.push(`tier[${i}].manager`);
    }
    if (persisted.groups.length !== authorized.groups.length) diffs.push(`groupCount`);
    for (let i = 0; i < authorized.groups.length; i++) {
      const a = authorized.groups[i];
      const b = persisted.groups[i];
      if (!b || a.pct !== b.pct || a.name !== b.name) diffs.push(`group[${i}]`);
    }

    // Cleanup descartável
    await client.query(`delete from goal where id = $1::uuid`, [row.id]);
    const gone = await client.query(`select 1 from goal where id = $1::uuid`, [row.id]);

    saveResult = {
      inserted: true,
      deleted: gone.rowCount === 0,
      authorized,
      persisted,
      diffs,
      match: diffs.length === 0,
    };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        stage1_identity: identity,
        stage1_october: october
          ? {
              idPrefix: october.idPrefix,
              name: october.name,
              period: `${october.startsOn}…${october.endsOn}`,
              target: october.target,
              tierMode: october.tierMode,
              spreadUnidentified: october.spreadUnidentified,
              published: october.published,
              tierCount: october.tiers.length,
              tierPcts: october.tiers.map((t) => t.minAttainmentPct),
              tierNames: october.tiers.map((t) => t.name),
              commissions: october.tiers.map((t) => t.commissionPct),
              bonuses: october.tiers.map((t) => t.bonus),
              managerPcts: october.tiers.map((t) => t.managerPct),
              groups: october.groups,
            }
          : null,
        stage4_disposable_save: saveResult,
      },
      null,
      2,
    ),
  );
  await client.end();
} catch (e) {
  console.log(JSON.stringify({ ok: false, reason: String(e.message || e).slice(0, 300) }));
  try {
    await client.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
