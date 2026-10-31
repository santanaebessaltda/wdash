/**
 * Read-only probe: October goal for Campo Grande (code 00010).
 * Does not print secrets or full UUIDs.
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
const url = env.VITE_SUPABASE_URL || "";
const ref = url.match(/https:\/\/([^.]+)/)?.[1];
if (!ref || !password) {
  console.log(JSON.stringify({ ok: false, reason: "missing_env" }));
  process.exit(0);
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

try {
  if (!client) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: String(lastErr?.message || lastErr || "connect_failed").slice(0, 200),
      }),
    );
    process.exit(0);
  }
  const stores = await client.query(`
    select id::text, code, name, trade_name
    from store
    where code = '00010'
       or name ilike '%CAMPO GRANDE%'
       or trade_name ilike '%Campo Grande%'
       or trade_name ilike '%Shopping%'
    order by case when trade_name ilike '%Campo Grande%' then 0 when code = '00010' then 1 else 2 end
    limit 10
  `);
  if (!stores.rows.length) {
    console.log(JSON.stringify({ ok: false, reason: "store_not_found" }));
    await client.end();
    process.exit(0);
  }

  const byStore = [];
  for (const store of stores.rows) {
    const goals = await client.query(
      `
      select id::text, store_id::text, name, starts_on::text, ends_on::text,
             target_cents, tier_mode, spread_unidentified,
             published_at is not null as published,
             jsonb_array_length(coalesce(tiers, '[]'::jsonb)) as tier_count,
             tiers, groups
      from goal
      where store_id = $1::uuid
        and starts_on <= '2026-10-31'
        and ends_on >= '2026-10-01'
      order by published_at desc nulls last, starts_on desc
      limit 3
    `,
      [store.id],
    );
    if (!goals.rows.length) continue;
    byStore.push({
      store: {
        idPrefix: store.id.slice(0, 8),
        code: store.code,
        name: store.name,
        tradeName: store.trade_name,
      },
      octoberGoals: goals.rows.map((g) => ({
        idPrefix: String(g.id).slice(0, 8),
        name: g.name,
        startsOn: g.starts_on,
        endsOn: g.ends_on,
        target: g.target_cents != null ? Number(g.target_cents) / 100 : null,
        tierMode: g.tier_mode,
        spreadUnidentified: g.spread_unidentified,
        published: g.published,
        tierCount: g.tier_count,
        tierKeys: Array.isArray(g.tiers) && g.tiers[0] ? Object.keys(g.tiers[0]) : [],
        tierPcts: Array.isArray(g.tiers)
          ? g.tiers.map((t) => t.minPct ?? t.minAttainmentPct ?? t.min_attainment_pct)
          : null,
        tierNames: Array.isArray(g.tiers) ? g.tiers.map((t) => t.name) : null,
        commissions: Array.isArray(g.tiers)
          ? g.tiers.map((t) => t.commissionPct ?? t.commission_pct)
          : null,
        bonusesReais: Array.isArray(g.tiers)
          ? g.tiers.map((t) => {
              const c = t.bonusCents ?? t.bonus_cents ?? t.bonus;
              return c != null && c > 100 ? Number(c) / 100 : c;
            })
          : null,
        groups: Array.isArray(g.groups)
          ? g.groups.map((x) => ({ name: x.name, pct: x.pct }))
          : null,
      })),
    });
  }

  console.log(JSON.stringify({ ok: true, matches: byStore }, null, 2));
  await client.end();
} catch (e) {
  console.log(JSON.stringify({ ok: false, reason: String(e.message || e).slice(0, 200) }));
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}
