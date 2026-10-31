/**
 * Regressão de ponta a ponta do fluxo real de meta (diagnóstico).
 * Mesmo motor do chat (`discussGoal`) + fixture de outubro com 4 níveis.
 * Deve FALHAR enquanto os bugs do caso real existirem — não altera o produto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRecord } from "@/data/wedash/engine/goalTypes";
import {
  discussGoal,
  emptyGoalAssembly,
  emptyGoalForm,
  looksLikeInspectGoalDraft,
  type GoalDraft,
} from "./goalDraft";
import { resolveGoalValueDecision } from "./goalContract";

const OCTOBER_TIERS = [
  { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
  { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
  { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
  { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
] as const;

const OCTOBER_GROUPS = [
  { shiftId: "m", name: "Turno 1", pct: 45 },
  { shiftId: "t", name: "Turno 2", pct: 55 },
];

const octoberGoal: GoalRecord = {
  id: "goal-oct-4tiers",
  storeId: "a",
  name: "Meta Outubro 2026",
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  target: 420_000,
  tierMode: "GROUP",
  spreadUnidentified: true,
  tiers: OCTOBER_TIERS.map((t) => ({ ...t })),
  groups: OCTOBER_GROUPS.map((g) => ({ ...g })),
  published: true,
};

vi.mock("@/data/wedash/goalsRepo", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/data/wedash/goalsRepo")>();
  return {
    ...mod,
    fetchGoals: async (q: {
      storeIds: string[];
      from: string;
      to: string;
    }) => {
      const overlapsOct =
        q.storeIds.includes("a") && q.from <= "2026-10-31" && q.to >= "2026-10-01";
      return overlapsOct ? [octoberGoal] : [];
    },
  };
});

const ctx = {
  tenantId: "t",
  membershipId: "m1",
  storeIds: ["a"],
  stores: [
    { id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" },
  ],
  network: [
    { id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" },
  ],
  today: "2026-10-31",
  managerFirstName: "Romeu",
};

function proposalDraft(amount: number): GoalDraft {
  return {
    form: {
      ...emptyGoalForm("a"),
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
      rationale: "fixture de teste",
      seasonalSummary: "",
      chatBlocks: [`Para Novembro 2026, eu trabalharia com R$ ${amount.toLocaleString("pt-BR")}.`],
    },
    pendingCommit: null,
    copyStatus: null,
    pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
  };
}

async function acceptThenCopy(): Promise<GoalDraft> {
  const accepted = await discussGoal("Pode ser", ctx, proposalDraft(500_000), {
    turnId: "reg-accept",
  });
  const copied = await discussGoal("Copie a configuração de outubro", ctx, accepted.draft, {
    turnId: "reg-copy",
  });
  return copied.draft;
}

describe("REGRESSAO meta novembro + copia outubro (diagnostico)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("A — apos 'Pode ser', rascunho sem escada aceita (tiers vazios)", async () => {
    const { draft, spokenReply, shouldCommit } = await discussGoal(
      "Pode ser",
      ctx,
      proposalDraft(500_000),
      { turnId: "a" },
    );
    expect(draft.form.target).toBe(500_000);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.path).toBeNull();
    expect(shouldCommit).toBeFalsy();
    expect(spokenReply ?? "").toMatch(/escolha abaixo|Apliquei/i);
    // Fase 2: aceite de valor nao cria escada — tiers vazios ate o caminho.
    expect(draft.form.tiers).toEqual([]);
  });

  it("B — copia fiel da fixture 50/75/100/110 (mesma filial) deve popular o rascunho", async () => {
    const accepted = await discussGoal("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "b1",
    });
    const { draft, spokenReply, shouldCommit } = await discussGoal(
      "Copie a configuração de outubro",
      ctx,
      accepted.draft,
      { turnId: "b2" },
    );
    expect(draft.copyStatus).toBe("ok");
    expect(draft.copiedFrom?.goalId).toBe("goal-oct-4tiers");
    expect(draft.copiedFrom?.storeId).toBe("a");
    expect(draft.form.target).toBe(500_000);
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(draft.form.tiers.map((t) => t.commissionPct)).toEqual([1.5, 2, 2.5, 3]);
    expect(draft.form.tiers.map((t) => t.bonus)).toEqual([50, 50, 50, 50]);
    expect(draft.form.groups.map((g) => g.pct)).toEqual([45, 55]);
    expect(spokenReply ?? "").toMatch(/50%|75%|100%|110%/);
    expect(spokenReply ?? "").not.toMatch(/120%|150%|180%/);
    expect(shouldCommit).toBeFalsy();
  });

  it("C — 'Sim' apos copia NAO deve autorizar commit nem zerar spokenReply (passos 8–12)", async () => {
    const afterCopy = await acceptThenCopy();
    expect(afterCopy.copyStatus).toBe("ok");
    expect(afterCopy.assembly?.confirmedMount).toBe(false);

    const stance = resolveGoalValueDecision({
      text: "Sim",
      utteredAmount: null,
      proposedTarget: afterCopy.proposedTarget ?? null,
      proposalAwaiting: false,
      saveAwaiting: afterCopy.pendingCommit?.awaitingConfirm === true,
      scenarios: null,
    });

    const { draft, spokenReply, shouldCommit } = await discussGoal("Sim", ctx, afterCopy, {
      turnId: "c",
    });

    // Estado estrutural deve permanecer.
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(draft.form.target).toBe(500_000);
    expect(draft.copyStatus).toBe("ok");
    expect(shouldCommit).toBe(false);
    expect(draft.pendingCommit?.authorized).not.toBe(true);
    expect(draft.assembly?.confirmedMount).toBe(false);

    // CONTRATO UX: apos copia, 'Sim' precisa de fala deterministica (resumo da config).
    expect(
      spokenReply,
      `stance=${stance.stance}; confirmedMount=${draft.assembly?.confirmedMount}; path=${draft.assembly?.path}`,
    ).toBeTruthy();
    expect(spokenReply ?? "").toMatch(/50%|75%|100%|110%|escada|niveis|níveis|rascunho/i);
    expect(spokenReply ?? "").not.toMatch(/Posso salvar|confirma.*R\$\s*500/i);
  });

  it("D — reafirmar R$ 500 mil nao pode destruir a escada copiada", async () => {
    const afterCopy = await acceptThenCopy();
    const afterSim = await discussGoal("Sim", ctx, afterCopy, { turnId: "d1" });
    const { draft, shouldCommit } = await discussGoal("R$ 500.000", ctx, afterSim.draft, {
      turnId: "d2",
    });
    expect(draft.form.target).toBe(500_000);
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(shouldCommit).toBeFalsy();
  });

  it("E — pergunta consultiva sobre niveis deve ler o rascunho (nao cair no LLM vazio)", async () => {
    const afterCopy = await acceptThenCopy();
    expect(looksLikeInspectGoalDraft("Tem quatro níveis?")).toBe(true);

    const { draft, spokenReply } = await discussGoal("Tem quatro níveis?", ctx, afterCopy, {
      turnId: "e",
    });
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(draft.form.tiers).toEqual(afterCopy.form.tiers);
    expect(spokenReply ?? "").toMatch(/50%|75%|100%|110%/);
    expect(spokenReply ?? "").not.toMatch(/120%|150%|180%/);
    const pctHits = (spokenReply ?? "").match(/\b\d{2,3}\s*%/g) ?? [];
    expect(pctHits.length).toBeLessThanOrEqual(4);
  });

  it("F — 'Quais sao os niveis?' deve listar exatamente a copia (4), nunca misturar default", async () => {
    const afterCopy = await acceptThenCopy();
    const { draft, spokenReply } = await discussGoal("Quais são os níveis?", ctx, afterCopy, {
      turnId: "f",
    });
    expect(draft.form.tiers).toHaveLength(4);
    expect(spokenReply ?? "").toMatch(/50%/);
    expect(spokenReply ?? "").toMatch(/75%/);
    expect(spokenReply ?? "").toMatch(/100%/);
    expect(spokenReply ?? "").toMatch(/110%/);
    expect(spokenReply ?? "").not.toMatch(/120%|150%|180%/);
  });

  it("G — Sim apos resumo explicito de gravacao autoriza shouldCommit", async () => {
    const afterCopy = await acceptThenCopy();
    const offered = await discussGoal("salvar o rascunho", ctx, afterCopy, { turnId: "g1" });
    expect(offered.draft.pendingCommit?.awaitingConfirm).toBe(true);
    expect(offered.shouldCommit).toBeFalsy();
    expect(offered.spokenReply ?? "").toMatch(/Posso salvar/i);

    const blob =
      `user: salvar o rascunho\njarvis: ${offered.spokenReply}\nuser: Sim`;
    const { draft, shouldCommit, spokenReply } = await discussGoal(blob, ctx, offered.draft, {
      turnId: "g2",
    });
    expect(draft.pendingCommit?.authorized).toBe(true);
    expect(shouldCommit).toBe(true);
    expect(spokenReply).toBeNull();
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
  });

  it("H — Sim apos pergunta com duas alternativas pede escolha objetiva", async () => {
    const afterCopy = await acceptThenCopy();
    const blob =
      `jarvis: Quer revisar a configuração ou salvar o rascunho?\nuser: Sim`;
    const { draft, spokenReply, shouldCommit } = await discussGoal(blob, ctx, afterCopy, {
      turnId: "h",
    });
    expect(shouldCommit).toBeFalsy();
    expect(draft.pendingCommit?.authorized).toBeFalsy();
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(spokenReply ?? "").toMatch(/não ficou claro|objetivamente|revisar|salvar/i);
  });

  it("I — Quais sao os bonus? e Como ficaram os grupos? leem o rascunho", async () => {
    const afterCopy = await acceptThenCopy();
    const bonus = await discussGoal("Quais são os bônus?", ctx, afterCopy, { turnId: "i1" });
    expect(bonus.draft.form.tiers).toEqual(afterCopy.form.tiers);
    expect(bonus.spokenReply ?? "").toMatch(/bônus|bonus|50|comiss/i);

    const groups = await discussGoal("Como ficaram os grupos?", ctx, afterCopy, {
      turnId: "i2",
    });
    expect(groups.draft.form.groups.map((g) => g.pct)).toEqual([45, 55]);
    expect(groups.spokenReply ?? "").toMatch(/Turno|45%|55%/);
  });

  it("J — copia com 4 niveis preservada apos varios turnos", async () => {
    let draft = await acceptThenCopy();
    for (const [i, q] of [
      "Sim",
      "Tem quatro níveis?",
      "Quais são os bônus?",
      "Como ficaram os grupos?",
    ].entries()) {
      const r = await discussGoal(q, ctx, draft, { turnId: `j${i}` });
      draft = r.draft;
      expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
      expect(draft.form.tiers.map((t) => t.bonus)).toEqual([50, 50, 50, 50]);
      expect(draft.form.groups.map((g) => g.pct)).toEqual([45, 55]);
      expect(r.shouldCommit).toBeFalsy();
    }
  });

  it("L — rascunho novo e aceite de valor sem escada automatica (Fase 2)", async () => {
    const blank = emptyGoalForm("a");
    expect(blank.tiers).toEqual([]);
    const { draft, spokenReply } = await discussGoal("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "l",
    });
    expect(draft.form.target).toBe(500_000);
    expect(draft.form.tiers).toEqual([]);
    expect(spokenReply ?? "").not.toMatch(/100%|120%|150%|180%/);
  });

  it("M — falha de copia nao cai em defaults silenciosos", async () => {
    const accepted = await discussGoal("Pode ser", ctx, proposalDraft(500_000), { turnId: "m1" });
    expect(accepted.draft.form.tiers).toEqual([]);
    // Janeiro sem fixture → copy_miss; tiers permanecem vazios.
    // Usa "Copiar" (infinitivo) — o detector já cobre; sem regex nova para "Copie".
    const { draft, spokenReply } = await discussGoal(
      "Copiar a configuração de janeiro",
      ctx,
      accepted.draft,
      { turnId: "m2" },
    );
    expect(draft.assembly?.path).toBe("copy");
    expect(draft.copyStatus).toBe("failed");
    expect(draft.form.tiers).toEqual([]);
    expect(spokenReply ?? "").toMatch(/não consegui|nao consegui|recuperar|copiar/i);
    expect(spokenReply ?? "").not.toMatch(/Pronto — trouxe|100%.*120%.*150%.*180%/);
  });

  it("N — recomendacao nao confirmada nao permite salvar", async () => {
    const accepted = await discussGoal("Pode ser", ctx, proposalDraft(500_000), { turnId: "n1" });
    const rec = await discussGoal("Criar com recomendações", ctx, accepted.draft, {
      turnId: "n2",
      recentConfigs: [
        {
          startsOn: "2026-09-01",
          name: "Meta Setembro",
          tierMode: "GROUP" as const,
          spreadUnidentified: true,
          groups: OCTOBER_GROUPS.map((g) => ({ ...g })),
          tiers: OCTOBER_TIERS.map((t) => ({ ...t })),
        },
      ],
    });
    expect(rec.draft.assembly?.path).toBe("recommended");
    expect(rec.draft.assembly?.confirmedTiers).toBe(false);
    expect(rec.draft.form.tiers.length).toBeGreaterThan(0);
    const saveTry = await discussGoal("salvar o rascunho", ctx, rec.draft, { turnId: "n3" });
    expect(saveTry.shouldCommit).toBeFalsy();
    expect(saveTry.draft.pendingCommit?.awaitingConfirm).not.toBe(true);
  });

  it("O — modo do zero so aplica escada padrao apos confirmacao", async () => {
    const base = {
      ...proposalDraft(500_000),
      pendingConfigCopy: null,
      form: { ...proposalDraft(500_000).form, target: 500_000 },
      userLockedTarget: true,
      proposedTarget: 500_000,
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: null,
      },
    };
    const fresh = await discussGoal("Criar do zero", ctx, base, { turnId: "o2" });
    expect(fresh.draft.form.tiers).toEqual([]);
    expect(fresh.draft.assembly?.path).toBe("fresh");
    const structured = await discussGoal(
      "Quero divisão por grupos, com rateio de venda sem vendedor e serve a escada",
      ctx,
      fresh.draft,
      { turnId: "o3" },
    );
    expect(structured.draft.assembly?.confirmedTiers).toBe(true);
    expect(structured.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([
      100, 120, 150, 180,
    ]);
  });

  it("K — tentativa de salvar sem pendingCommit nao grava; mudanca invalida pending", async () => {
    const afterCopy = await acceptThenCopy();
    const bare = await discussGoal("Sim", ctx, afterCopy, { turnId: "k1" });
    expect(bare.shouldCommit).toBeFalsy();
    expect(bare.draft.pendingCommit?.authorized).toBeFalsy();

    const offered = await discussGoal("salvar o rascunho", ctx, afterCopy, { turnId: "k2" });
    expect(offered.draft.pendingCommit?.awaitingConfirm).toBe(true);
    const mutated = await discussGoal("R$ 510.000", ctx, offered.draft, { turnId: "k3" });
    expect(mutated.draft.pendingCommit == null || mutated.draft.pendingCommit.awaitingConfirm).toBe(
      true,
    );
    // Fingerprint mudou → pending anterior nao autoriza.
    const confirm = await discussGoal("Sim", ctx, mutated.draft, { turnId: "k4" });
    if (mutated.draft.pendingCommit && !mutated.draft.pendingCommit.awaitingConfirm) {
      expect(confirm.shouldCommit).toBeFalsy();
    } else if (!mutated.draft.pendingCommit) {
      expect(confirm.shouldCommit).toBeFalsy();
    } else {
      // Pending recriado ou ainda awaiting com fingerprint novo — Sim so confirma se fingerprint bate.
      expect(confirm.draft.form.target).toBe(510_000);
      if (confirm.shouldCommit) {
        expect(confirm.draft.pendingCommit?.fingerprint).toBeTruthy();
      }
    }
  });
});
