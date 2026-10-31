/**
 * Homologação funcional (Fases 1–5) — dados reais da filial código 00010.
 * Não altera o comportamento do JARVIS. Cópia sem saveGoal de meta 2026.
 * Requer .env com SUPABASE_DB_PASSWORD (senão os testes são skip).
 */
import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { goalFromRow, type GoalRow } from "@/data/wedash/engine/goalRows";
import type { GoalRecord } from "@/data/wedash/engine/goalTypes";
import { applyGoalTurn } from "./goalTurnApply";
import { emptyGoalAssembly, emptyGoalForm, type GoalDraft } from "./goalDraft";
import { setGoalTurnTraceSink, type GoalTurnTrace } from "./goalTurnTrace";

type RealBundle = {
  store: {
    id: string;
    tenantId: string;
    code: string;
    legalName: string;
    tradeName: string;
  };
  octoberRow: GoalRow & { tenant_id?: string };
  october: GoalRecord;
};

let bundle: RealBundle | null = null;
let loadError: string | null = null;

async function loadReal00010(): Promise<RealBundle | null> {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    loadError = "missing_.env";
    return null;
  }
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  const password = env.SUPABASE_DB_PASSWORD;
  const ref = (env.VITE_SUPABASE_URL || "").match(/https:\/\/([^.]+)/)?.[1];
  if (!password || !ref) {
    loadError = "missing_db_env";
    return null;
  }

  const pg = await import("pg");
  const candidates = [
    { host: `db.${ref}.supabase.co`, user: "postgres", port: 5432 },
    { host: "aws-0-sa-east-1.pooler.supabase.com", user: `postgres.${ref}`, port: 6543 },
    { host: "aws-0-us-east-1.pooler.supabase.com", user: `postgres.${ref}`, port: 6543 },
  ];
  let client: InstanceType<typeof pg.Client> | null = null;
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
    } catch {
      try {
        await tryClient.end();
      } catch {
        /* ignore */
      }
    }
  }
  if (!client) {
    loadError = "db_connect_failed";
    return null;
  }

  try {
    const storeRes = await client.query(
      `select id::text, tenant_id::text, code, name, trade_name from store where code = $1 limit 1`,
      ["00010"],
    );
    if (!storeRes.rows[0]) {
      loadError = "store_00010_missing";
      return null;
    }
    const s = storeRes.rows[0];
    const goalRes = await client.query(
      `
      select id::text, store_id::text, name,
             starts_on::text as starts_on,
             ends_on::text as ends_on,
             target_cents, tier_mode, tiers, groups, spread_unidentified,
             published_at::text as published_at
      from goal
      where store_id = $1::uuid
        and starts_on <= '2026-10-31' and ends_on >= '2026-10-01'
        and published_at is not null
      order by published_at desc
      limit 1
    `,
      [s.id],
    );
    if (!goalRes.rows[0]) {
      loadError = "october_goal_missing";
      return null;
    }
    const raw = goalRes.rows[0];
    const row: GoalRow = {
      id: String(raw.id),
      store_id: String(raw.store_id),
      name: String(raw.name),
      starts_on: String(raw.starts_on).slice(0, 10),
      ends_on: String(raw.ends_on).slice(0, 10),
      target_cents: Number(raw.target_cents),
      tier_mode: String(raw.tier_mode),
      tiers: raw.tiers,
      groups: raw.groups,
      spread_unidentified: raw.spread_unidentified,
      published_at: raw.published_at,
    };
    return {
      store: {
        id: s.id,
        tenantId: s.tenant_id,
        code: s.code,
        legalName: s.name,
        tradeName: s.trade_name,
      },
      octoberRow: row,
      october: goalFromRow(row),
    };
  } finally {
    await client.end();
  }
}

vi.mock("@/data/wedash/goalsRepo", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/data/wedash/goalsRepo")>();
  return {
    ...mod,
    fetchGoals: async (q: {
      storeIds: string[];
      from: string;
      to: string;
      includeDrafts?: boolean;
    }) => {
      if (!bundle) return [];
      const g = bundle.october;
      const overlaps =
        q.storeIds.includes(g.storeId) && q.from <= g.endsOn && q.to >= g.startsOn;
      if (!overlaps) return [];
      if (!q.includeDrafts && g.published === false) return [];
      return [g];
    },
  };
});

function proposalDraft(storeId: string, amount: number): GoalDraft {
  return {
    form: {
      ...emptyGoalForm(storeId),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: null,
    },
    assembly: {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: null,
    },
    userLockedTarget: false,
    proposedTarget: amount,
    proposal: {
      amount,
      scenarios: [
        { kind: "conservative", amount: Math.round(amount * 0.92), label: "Conservadora" },
        { kind: "recommended", amount, label: "Recomendada" },
        { kind: "challenging", amount: Math.round(amount * 1.1), label: "Desafiadora" },
      ],
      evidence: [],
      caveats: [],
      confidence: "medium",
      rationale: "homolog",
      seasonalSummary: "",
      chatBlocks: [`Proposta ${amount}`],
    },
    pendingCommit: null,
    copyStatus: null,
    pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
  };
}

describe("Homologacao real filial 00010", () => {
  const traces: GoalTurnTrace[] = [];

  beforeAll(async () => {
    bundle = await loadReal00010();
  }, 30000);

  it("1 — identidade da filial 00010 e meta outubro publicada", () => {
    if (!bundle) {
      console.warn(`[homolog] skip identity: ${loadError}`);
      expect(loadError).not.toBeNull();
      return;
    }
    expect(bundle.store.code).toBe("00010");
    expect(bundle.store.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(bundle.store.tenantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(bundle.store.legalName.length).toBeGreaterThan(0);
    expect(bundle.october.published).toBe(true);
    expect(bundle.october.startsOn).toBe("2026-10-01");
    expect(bundle.october.endsOn).toBe("2026-10-31");
    expect(bundle.october.storeId).toBe(bundle.store.id);
    expect(bundle.october.tiers).toHaveLength(4);
    expect(bundle.october.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    // Relatório (sem UUID completo na assertion string)
    console.info("[homolog.identity]", {
      code: bundle.store.code,
      idPrefix: bundle.store.id.slice(0, 8),
      tenantPrefix: bundle.store.tenantId.slice(0, 8),
      legalName: bundle.store.legalName,
      tradeName: bundle.store.tradeName,
      displayName: bundle.store.tradeName || bundle.store.legalName,
      october: {
        name: bundle.october.name,
        target: bundle.october.target,
        tierMode: bundle.october.tierMode,
        tierPcts: bundle.october.tiers.map((t) => t.minAttainmentPct),
        commissions: bundle.october.tiers.map((t) => t.commissionPct),
        bonuses: bundle.october.tiers.map((t) => t.bonus),
        managerPcts: bundle.october.tiers.map((t) => t.managerPct ?? null),
        groups: bundle.october.groups,
        spreadUnidentified: bundle.october.spreadUnidentified === true,
      },
    });
  });

  it("2 — copia no motor (sem salvar) preserva niveis/grupos/bonus/gerencia", async () => {
    if (!bundle) {
      console.warn(`[homolog] skip copy: ${loadError}`);
      expect(loadError).not.toBeNull();
      return;
    }
    setGoalTurnTraceSink((t) => traces.push(t));
    const ctx = {
      tenantId: bundle.store.tenantId,
      membershipId: "homolog-m1",
      storeIds: [bundle.store.id],
      stores: [
        {
          id: bundle.store.id,
          name: bundle.store.legalName,
          tradeName: bundle.store.tradeName,
          code: bundle.store.code,
        },
      ],
      network: [
        {
          id: bundle.store.id,
          name: bundle.store.legalName,
          tradeName: bundle.store.tradeName,
          code: bundle.store.code,
        },
      ],
      today: "2026-10-31",
      managerFirstName: "Romeu",
    };
    const src = bundle.october;
    const accepted = await applyGoalTurn(
      "Pode ser",
      ctx,
      proposalDraft(bundle.store.id, 500_000),
      { turnId: "homolog-accept", sessionKey: "homolog" },
    );
    expect(accepted.draft.form.target).toBe(500_000);
    expect(accepted.draft.form.tiers).toEqual([]);

    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "homolog-copy",
      sessionKey: "homolog",
    });
    expect(copied.draft.copyStatus).toBe("ok");
    expect(copied.invariantBlocked).not.toBe(true);
    expect(copied.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual(
      src.tiers.map((t) => t.minAttainmentPct),
    );
    expect(copied.draft.form.tiers.map((t) => t.commissionPct)).toEqual(
      src.tiers.map((t) => t.commissionPct),
    );
    expect(copied.draft.form.tiers.map((t) => t.bonus)).toEqual(src.tiers.map((t) => t.bonus));
    expect(copied.draft.form.tiers.map((t) => t.name)).toEqual(src.tiers.map((t) => t.name));
    expect(copied.draft.form.tiers.map((t) => t.managerPct ?? null)).toEqual(
      src.tiers.map((t) => t.managerPct ?? null),
    );
    expect(copied.draft.form.groups.map((g) => ({ name: g.name, pct: g.pct }))).toEqual(
      src.groups.map((g) => ({ name: g.name, pct: g.pct })),
    );
    expect(copied.draft.form.tierMode).toBe(src.tierMode);
    expect(copied.draft.form.spreadUnidentified).toBe(src.spreadUnidentified === true);
    expect(copied.draft.form.managerOn).toBe(src.tiers.some((t) => t.managerPct != null));
    expect(copied.draft.form.target).toBe(500_000);
    expect(copied.draft.copiedFrom?.goalId).toBe(src.id);
    expect(copied.trace?.before.tierCount).toBe(0);
    expect(copied.trace?.after.tierCount).toBe(4);
    expect(copied.trace?.after.tierPcts).toEqual([50, 75, 100, 110]);
    console.info("[homolog.copy]", {
      originGoalPrefix: src.id.slice(0, 8),
      draftTiers: copied.draft.form.tiers.map((t) => ({
        name: t.name,
        pct: t.minAttainmentPct,
        commission: t.commissionPct,
        bonus: t.bonus,
        managerPct: t.managerPct ?? null,
      })),
      draftGroups: copied.draft.form.groups,
      tierMode: copied.draft.form.tierMode,
      spread: copied.draft.form.spreadUnidentified,
      managerOn: copied.draft.form.managerOn,
      speechSource: copied.speechSource,
      traceStatus: copied.trace?.finalStatus,
    });
  });

  it("3 — perguntas consultivas nao alteram rascunho nem reiniciam", async () => {
    if (!bundle) {
      console.warn(`[homolog] skip consult: ${loadError}`);
      expect(loadError).not.toBeNull();
      return;
    }
    const ctx = {
      tenantId: bundle.store.tenantId,
      membershipId: "homolog-m1",
      storeIds: [bundle.store.id],
      stores: [
        {
          id: bundle.store.id,
          name: bundle.store.legalName,
          tradeName: bundle.store.tradeName,
          code: bundle.store.code,
        },
      ],
      network: [
        {
          id: bundle.store.id,
          name: bundle.store.legalName,
          tradeName: bundle.store.tradeName,
          code: bundle.store.code,
        },
      ],
      today: "2026-10-31",
      managerFirstName: "Romeu",
    };
    let draft = (
      await applyGoalTurn("Pode ser", ctx, proposalDraft(bundle.store.id, 500_000), {
        turnId: "h3-a",
      })
    ).draft;
    draft = (await applyGoalTurn("Copiar outubro", ctx, draft, { turnId: "h3-b" })).draft;
    const snapshot = JSON.stringify({
      target: draft.form.target,
      tiers: draft.form.tiers,
      groups: draft.form.groups,
      path: draft.assembly?.path,
      copyStatus: draft.copyStatus,
    });

    const questions = [
      "Qual o valor da meta?",
      "Quais são os níveis?",
      "Como ficaram os grupos?",
      "O que acha dos pesos?",
      "Quais são as premiações e bônus?",
      "Vale a pena mudar a estratégia da meta?",
    ];
    for (let i = 0; i < questions.length; i++) {
      const r = await applyGoalTurn(questions[i]!, ctx, draft, { turnId: `h3-q${i}` });
      expect(r.draft.form.target).toBe(500_000);
      expect(r.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
      expect(r.draft.assembly?.path).toBe("copy");
      expect(r.draft.copyStatus).toBe("ok");
      expect(r.shouldCommit).toBeFalsy();
      // consultiva / inspect: sem mutação estrutural
      expect(
        JSON.stringify({
          target: r.draft.form.target,
          tiers: r.draft.form.tiers,
          groups: r.draft.form.groups,
          path: r.draft.assembly?.path,
          copyStatus: r.draft.copyStatus,
        }),
      ).toBe(snapshot);
      draft = r.draft;
    }
  });

  it("4 — confirmacao de gravacao (pendingCommit) sem saveGoal de meta real", async () => {
    if (!bundle) {
      console.warn(`[homolog] skip save-offer: ${loadError}`);
      expect(loadError).not.toBeNull();
      return;
    }
    const ctx = {
      tenantId: bundle.store.tenantId,
      membershipId: "homolog-m1",
      storeIds: [bundle.store.id],
      stores: [
        {
          id: bundle.store.id,
          name: bundle.store.legalName,
          tradeName: bundle.store.tradeName,
          code: bundle.store.code,
        },
      ],
      network: [
        {
          id: bundle.store.id,
          name: bundle.store.legalName,
          tradeName: bundle.store.tradeName,
          code: bundle.store.code,
        },
      ],
      today: "2026-10-31",
      managerFirstName: "Romeu",
    };
    let draft = (
      await applyGoalTurn("Pode ser", ctx, proposalDraft(bundle.store.id, 500_000), {
        turnId: "h4-a",
      })
    ).draft;
    draft = (await applyGoalTurn("Copiar outubro", ctx, draft, { turnId: "h4-b" })).draft;
    const offered = await applyGoalTurn("salvar o rascunho", ctx, draft, { turnId: "h4-c" });
    expect(offered.draft.pendingCommit?.awaitingConfirm).toBe(true);
    expect(offered.speech ?? "").toMatch(/Posso salvar/i);
    const blob = `user: salvar o rascunho\njarvis: ${offered.speech}\nuser: Sim`;
    const confirmed = await applyGoalTurn(blob, ctx, offered.draft, { turnId: "h4-d" });
    expect(confirmed.shouldCommit).toBe(true);
    expect(confirmed.draft.pendingCommit?.authorized).toBe(true);
    expect(confirmed.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    // Não chama saveGoal aqui — gravação descartável fica no script homolog-store-00010.mjs
  });
});
