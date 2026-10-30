/**
 * Inteligência de configuração de meta: resumo fiel da cópia, simulação
 * alinhada ao editor, e recomendação de pesos (sem aplicar sozinha).
 */
import { endOfMonth } from "@/data/wedash/engine/format";
import { brlCent } from "@/lib/format";
import { fetchGoals, fetchGoalTeam } from "@/data/wedash/goalsRepo";
import { fetchSalesSellerDayAggs } from "@/data/wedash/salesRepo";
import type { GoalGroup, GoalRecord, Tier } from "@/data/wedash/engine/goalTypes";
import type { GoalDraftForm } from "./goalDraft";
import type { JarvisContext } from "./context";

export type GoalCopyIntent = "exact" | "reference";

export function parseGoalCopyIntent(text: string): GoalCopyIntent {
  const p = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (
    /tendo em vista|como referencia|como referência|basead|inspirad|partir d[ae]|usar de referencia|usar de referência|nao precisa copiar tudo|não precisa copiar tudo|pode melhorar|recomenda/.test(
      p,
    )
  ) {
    return "reference";
  }
  // "copiar", "mesma configuração", "100%", "igual a outubro" = fiel
  return "exact";
}

/** Mesma conta do editor: limiar = meta × % atingimento; premiação ilustrativa no limiar. */
export function simulateLevelAtStoreTarget(
  storeTarget: number,
  tier: Tier,
): { threshold: number; commissionAtThreshold: number } {
  const threshold = Math.round((storeTarget * tier.minAttainmentPct) / 100);
  const commissionAtThreshold = Math.round((threshold * tier.commissionPct) / 100);
  return { threshold, commissionAtThreshold };
}

export type GoalConfigSnapshot = {
  tierMode: GoalDraftForm["tierMode"];
  spreadUnidentified: boolean;
  managerOn: boolean;
  groups: { name: string; pct: number; amount: number | null }[];
  levels: {
    name: string;
    minAttainmentPct: number;
    commissionPct: number;
    bonus: number;
    threshold: number | null;
    commissionAtThreshold: number | null;
    managerPct: number | null;
    managerBonus: number | null;
  }[];
  chatBlocks: string[];
};

/** Resumo objetivo do que está no form (o que será persistido). */
export function buildGoalConfigSnapshot(
  form: GoalDraftForm,
  storeTarget: number | null,
): GoalConfigSnapshot {
  const groups = form.groups.map((g) => ({
    name: g.name,
    pct: g.pct,
    amount: storeTarget != null ? Math.round((storeTarget * g.pct) / 100) : null,
  }));
  const levels = form.tiers.map((t) => {
    const sim =
      storeTarget != null ? simulateLevelAtStoreTarget(storeTarget, t) : null;
    return {
      name: t.name,
      minAttainmentPct: t.minAttainmentPct,
      commissionPct: t.commissionPct,
      bonus: t.bonus,
      threshold: sim?.threshold ?? null,
      commissionAtThreshold: sim?.commissionAtThreshold ?? null,
      managerPct: t.managerPct ?? null,
      managerBonus: t.managerBonus ?? null,
    };
  });

  const chatBlocks: string[] = [];
  const modeLabel =
    form.tierMode === "GROUP"
      ? "por grupo"
      : form.tierMode === "GENERAL"
        ? "geral (loja)"
        : "individual";
  chatBlocks.push(
    `Configuração no rascunho: modo ${modeLabel}; ${form.tiers.length} níveis; ${form.groups.length} grupo(s); rateio sem vendedor ${form.spreadUnidentified ? "ligado" : "desligado"}; gerência ${form.managerOn ? "com premiação" : "sem premiação"}.`,
  );

  if (groups.length > 0) {
    chatBlocks.push(
      "Grupos: " +
        groups
          .map((g) =>
            g.amount != null
              ? `${g.name} ${g.pct}% → ${brlCent(g.amount)}`
              : `${g.name} ${g.pct}%`,
          )
          .join("; ") +
        ".",
    );
  }

  chatBlocks.push(
    "Níveis: " +
      levels
        .map((l) => {
          const thr = l.threshold != null ? ` (limiar loja ${brlCent(l.threshold)})` : "";
          const bonus = l.bonus > 0 ? ` + bônus ${brlCent(l.bonus)}` : "";
          const mgr =
            l.managerPct != null
              ? ` · gerência ${l.managerPct}%` +
                (l.managerBonus != null && l.managerBonus > 0
                  ? ` + ${brlCent(l.managerBonus)}`
                  : "")
              : "";
          return `${l.name} ${l.minAttainmentPct}% / ${l.commissionPct}%${bonus}${thr}${mgr}`;
        })
        .join("; ") +
      ".",
  );

  return {
    tierMode: form.tierMode,
    spreadUnidentified: form.spreadUnidentified,
    managerOn: form.managerOn,
    groups,
    levels,
    chatBlocks,
  };
}

export type GroupWeightSuggestion = {
  current: { name: string; pct: number }[];
  suggested: { name: string; pct: number }[];
  evidence: string;
  caveat: string | null;
  /** Nunca aplicar sozinho — só texto para o modelo oferecer. */
  chatBlocks: string[];
};

/** Exportado para testes — pesos sugeridos sempre somam 100. */
export function roundPctTo100(parts: { name: string; raw: number }[]): { name: string; pct: number }[] {
  if (parts.length === 0) return [];
  const total = parts.reduce((s, p) => s + p.raw, 0);
  if (total <= 0) return parts.map((p) => ({ name: p.name, pct: 0 }));
  const rounded = parts.map((p) => ({
    name: p.name,
    pct: Math.round((100 * p.raw) / total),
  }));
  const drift = 100 - rounded.reduce((s, p) => s + p.pct, 0);
  if (drift !== 0 && rounded[0]) rounded[0] = { ...rounded[0], pct: rounded[0].pct + drift };
  return rounded;
}

/**
 * Participação comercial por turno (faturamento dos sellers no grupo).
 * Não altera pesos — só recomenda. Sem dado confiável → null.
 */
export async function suggestGroupWeightsFromSales(
  ctx: JarvisContext,
  storeId: string,
  groups: GoalGroup[],
  monthsBack = 3,
): Promise<GroupWeightSuggestion | null> {
  if (!storeId || groups.length < 2) return null;
  const to = ctx.today;
  const fromY = Number(to.slice(0, 4));
  const fromM = Number(to.slice(5, 7)) - monthsBack;
  const fromDate = new Date(Date.UTC(fromY, fromM - 1, 1));
  const from = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, "0")}-01`;

  try {
    const [team, sales] = await Promise.all([
      fetchGoalTeam(ctx.tenantId, [storeId]),
      fetchSalesSellerDayAggs({
        tenantId: ctx.tenantId,
        storeIds: [storeId],
        from,
        to,
      }),
    ]);
    if (sales.length === 0) return null;

    const empToShift = new Map<number, string>();
    for (const m of team) {
      if (m.shiftId && m.employeeId != null) empToShift.set(m.employeeId, m.shiftId);
    }

    const byShift = new Map<string, number>();
    for (const g of groups) byShift.set(g.shiftId, 0);
    let matched = 0;
    for (const row of sales) {
      const empId = row.sellerEmployeeId;
      if (empId == null) continue;
      const shiftId = empToShift.get(empId);
      if (!shiftId || !byShift.has(shiftId)) continue;
      byShift.set(shiftId, (byShift.get(shiftId) ?? 0) + row.revenueCents);
      matched += 1;
    }
    if (matched < 10) {
      return {
        current: groups.map((g) => ({ name: g.name, pct: g.pct })),
        suggested: groups.map((g) => ({ name: g.name, pct: g.pct })),
        evidence: "Poucas vendas ligadas a turno no período.",
        caveat: "Mantive os pesos atuais; dado por turno insuficiente.",
        chatBlocks: [
          "Não tenho participação por turno confiável nos últimos meses — mantive os pesos da configuração. Se quiser, ajustamos na mão.",
        ],
      };
    }

    const parts = groups.map((g) => ({
      name: g.name,
      raw: byShift.get(g.shiftId) ?? 0,
    }));
    const suggested = roundPctTo100(parts);
    const current = groups.map((g) => ({ name: g.name, pct: g.pct }));
    const same =
      current.length === suggested.length &&
      current.every((c, i) => c.pct === suggested[i]?.pct);

    const evidence =
      `Participação observada (~${monthsBack} meses, vendas ligadas ao turno): ` +
      suggested.map((s) => `${s.name} ${s.pct}%`).join(", ") +
      ".";

    const chatBlocks: string[] = [
      `Hoje os pesos são ${current.map((c) => `${c.name} ${c.pct}%`).join(" / ")}.`,
      evidence,
    ];
    if (!same) {
      chatBlocks.push(
        `Recomendo avaliar ${suggested.map((s) => `${s.name} ${s.pct}%`).join(" / ")} para refletir o potencial comercial recente. Isso é sugestão — não alterei os pesos no rascunho.`,
      );
      chatBlocks.push("Prefere manter os pesos da cópia ou aplicar a recomendação?");
    } else {
      chatBlocks.push("A participação recente está alinhada aos pesos copiados.");
    }

    return {
      current,
      suggested,
      evidence,
      caveat: same
        ? null
        : "Participação ≠ produtividade (horas/equipe). Não apliquei sozinho.",
      chatBlocks,
    };
  } catch {
    return null;
  }
}

export type ConfigPatternSource = Pick<
  GoalRecord,
  "startsOn" | "tierMode" | "tiers" | "groups" | "spreadUnidentified" | "name"
>;

export type ConfigPatternSuggestion = {
  /** Padrão mais recorrente — não é “melhor” por ser recente. */
  pattern: {
    tierMode: GoalDraftForm["tierMode"];
    tiers: Tier[];
    groups: GoalGroup[];
    spreadUnidentified: boolean;
    managerOn: boolean;
    sampleCount: number;
    monthsLabel: string;
  };
  chatBlocks: string[];
};

function tierFingerprint(tiers: Tier[]): string {
  return tiers
    .map((t) => `${t.minAttainmentPct}:${t.commissionPct}:${t.bonus}`)
    .join("|");
}

function groupFingerprint(groups: GoalGroup[]): string {
  return groups
    .map((g) => `${g.name}:${g.pct}`)
    .sort()
    .join("|");
}

/**
 * Padrão recorrente nas metas da filial (frequência, não só a mais recente).
 * Usado no caminho “do zero” — recomenda sem gravar sozinho.
 */
export function inferConfigPatternFromHistory(
  sources: ConfigPatternSource[],
): ConfigPatternSuggestion | null {
  if (sources.length === 0) return null;

  const modeCount = new Map<string, number>();
  const ladderCount = new Map<string, { n: number; tiers: Tier[] }>();
  const groupsCount = new Map<string, { n: number; groups: GoalGroup[] }>();
  let spreadTrue = 0;
  let managerTrue = 0;

  for (const s of sources) {
    modeCount.set(s.tierMode, (modeCount.get(s.tierMode) ?? 0) + 1);
    const lf = tierFingerprint(s.tiers);
    const prevL = ladderCount.get(lf);
    if (!prevL || s.tiers.length >= prevL.tiers.length) {
      ladderCount.set(lf, { n: (prevL?.n ?? 0) + 1, tiers: s.tiers.map((t) => ({ ...t })) });
    } else {
      ladderCount.set(lf, { n: (prevL?.n ?? 0) + 1, tiers: prevL.tiers });
    }
    if (s.groups.length > 0) {
      const gf = groupFingerprint(s.groups);
      const prevG = groupsCount.get(gf);
      groupsCount.set(gf, {
        n: (prevG?.n ?? 0) + 1,
        groups: s.groups.map((g) => ({ ...g })),
      });
    }
    if (s.spreadUnidentified) spreadTrue += 1;
    if (s.tiers.some((t) => t.managerPct != null)) managerTrue += 1;
  }

  let bestMode: GoalDraftForm["tierMode"] = "INDIVIDUAL";
  let bestModeN = 0;
  for (const [m, n] of modeCount) {
    if (n > bestModeN) {
      bestModeN = n;
      bestMode = m as GoalDraftForm["tierMode"];
    }
  }

  let bestLadder: { n: number; tiers: Tier[] } | null = null;
  for (const v of ladderCount.values()) {
    if (!bestLadder || v.n > bestLadder.n || (v.n === bestLadder.n && v.tiers.length > bestLadder.tiers.length)) {
      bestLadder = v;
    }
  }
  if (!bestLadder) return null;

  let bestGroups: GoalGroup[] = [];
  let bestGroupsN = 0;
  for (const v of groupsCount.values()) {
    if (v.n > bestGroupsN) {
      bestGroupsN = v.n;
      bestGroups = v.groups;
    }
  }

  const monthsLabel = sources
    .slice(0, 3)
    .map((s) => s.startsOn.slice(0, 7))
    .join(", ");

  const managerOn = managerTrue > sources.length / 2;
  const spreadUnidentified = spreadTrue > sources.length / 2;

  const chatBlocks = [
    `Padrão identificado em ${sources.length} meta(s) desta filial (${monthsLabel}): modo ${bestMode.toLowerCase()}, ${bestLadder.tiers.length} níveis` +
      (bestGroups.length ? `, ${bestGroups.length} grupo(s)` : "") +
      (managerOn ? ", com premiação da gerência" : "") +
      ".",
    "Níveis recorrentes: " +
      bestLadder.tiers
        .map((t) => {
          const b = t.bonus > 0 ? ` + bônus ${brlCent(t.bonus)}` : "";
          return `${t.name} ${t.minAttainmentPct}% / ${t.commissionPct}%${b}`;
        })
        .join("; ") +
      ".",
    "Isso é o padrão da operação — não necessariamente o ótimo. Posso montar com ele e depois avaliamos pesos/custos, ou ajustar algum ponto agora.",
  ];

  return {
    pattern: {
      tierMode: bestMode,
      tiers: bestLadder.tiers,
      groups: bestGroups,
      spreadUnidentified,
      managerOn,
      sampleCount: sources.length,
      monthsLabel,
    },
    chatBlocks,
  };
}

/** Últimas metas publicadas da filial (até 12 meses antes do mês-alvo). */
export async function fetchRecentGoalConfigs(
  ctx: JarvisContext,
  storeId: string,
  beforeStartsOn: string,
  limit = 6,
): Promise<ConfigPatternSource[]> {
  if (!storeId || !beforeStartsOn) return [];
  const y = Number(beforeStartsOn.slice(0, 4));
  const m = Number(beforeStartsOn.slice(5, 7));
  const fromDate = new Date(Date.UTC(y, m - 1 - 12, 1));
  const from = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const priorMonth = new Date(Date.UTC(y, m - 2, 1));
  const priorTo = endOfMonth(
    `${priorMonth.getUTCFullYear()}-${String(priorMonth.getUTCMonth() + 1).padStart(2, "0")}-01`,
  );

  try {
    const goals = await fetchGoals({
      tenantId: ctx.tenantId,
      storeIds: [storeId],
      from,
      to: priorTo,
    });
    return goals
      .filter((g) => g.storeId === storeId && g.startsOn < beforeStartsOn)
      .slice(0, limit)
      .map((g) => ({
        startsOn: g.startsOn,
        tierMode: g.tierMode,
        tiers: g.tiers,
        groups: g.groups,
        spreadUnidentified: g.spreadUnidentified === true,
        name: g.name,
      }));
  } catch {
    return [];
  }
}

/** Aplica o padrão ao form (criação do zero) — só estrutura; alvo R$ permanece. */
export function applyConfigPatternToForm(
  form: GoalDraftForm,
  pattern: ConfigPatternSuggestion["pattern"],
): GoalDraftForm {
  return {
    ...form,
    tierMode: pattern.tierMode,
    spreadUnidentified: pattern.spreadUnidentified,
    managerOn: pattern.managerOn,
    tiers: pattern.tiers.map((t) => ({ ...t })),
    groups: pattern.groups.map((g) => ({ ...g })),
  };
}
