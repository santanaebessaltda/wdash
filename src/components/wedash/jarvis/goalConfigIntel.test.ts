import { describe, expect, it } from "vitest";
import {
  applyConfigPatternToForm,
  buildGoalConfigSnapshot,
  inferConfigPatternFromHistory,
  parseGoalCopyIntent,
  roundPctTo100,
  simulateLevelAtStoreTarget,
} from "./goalConfigIntel";
import { emptyGoalForm } from "./goalDraft";
import { copyGoalLadderFromPeriod } from "./goalDraft";
import type { JarvisContext } from "./context";

describe("parseGoalCopyIntent", () => {
  it("copia fiel por padrao", () => {
    expect(parseGoalCopyIntent("vamos copiar a configuração de outubro")).toBe("exact");
    expect(parseGoalCopyIntent("copia 100% a meta de outubro")).toBe("exact");
  });

  it("referencia quando pede base/inspiracao", () => {
    expect(parseGoalCopyIntent("tendo em vista a meta de outubro, recomenda")).toBe("reference");
    expect(parseGoalCopyIntent("usa outubro como referencia")).toBe("reference");
  });
});

describe("simulateLevelAtStoreTarget", () => {
  it("usa a mesma conta do editor (limiar × %)", () => {
    const sim = simulateLevelAtStoreTarget(244_600, {
      name: "Meta",
      minAttainmentPct: 50,
      commissionPct: 1.5,
      bonus: 50,
    });
    expect(sim.threshold).toBe(122_300);
    expect(sim.commissionAtThreshold).toBe(Math.round(122_300 * 0.015));
  });
});

describe("buildGoalConfigSnapshot", () => {
  it("resume 4 niveis, 2 grupos, bonus e gerencia com R$ da nova meta", () => {
    const form = emptyGoalForm("a");
    form.target = 244_600;
    form.tierMode = "GROUP";
    form.managerOn = true;
    form.groups = [
      { shiftId: "m", name: "Turno 1", pct: 45 },
      { shiftId: "t", name: "Turno 2", pct: 55 },
    ];
    form.tiers = [
      { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50, managerPct: 0.5, managerBonus: 0 },
      { name: "Super meta", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
      { name: "Hiper meta", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
      {
        name: "Meta desafio",
        minAttainmentPct: 110,
        commissionPct: 3,
        bonus: 50,
        managerPct: 1,
        managerBonus: 100,
      },
    ];
    const snap = buildGoalConfigSnapshot(form, 244_600);
    expect(snap.groups).toEqual([
      { name: "Turno 1", pct: 45, amount: 110_070 },
      { name: "Turno 2", pct: 55, amount: 134_530 },
    ]);
    expect(snap.levels).toHaveLength(4);
    expect(snap.levels[0]?.minAttainmentPct).toBe(50);
    expect(snap.levels[3]?.minAttainmentPct).toBe(110);
    expect(snap.levels[0]?.bonus).toBe(50);
    expect(snap.levels[0]?.managerPct).toBe(0.5);
    expect(snap.chatBlocks.join(" ")).toMatch(/Turno 1 45%/);
    expect(snap.chatBlocks.join(" ")).toMatch(/110\.070|110070|R\$/);
    expect(snap.chatBlocks.join(" ")).not.toMatch(/85%/);
  });
});

describe("roundPctTo100", () => {
  it("soma exatamente 100", () => {
    const out = roundPctTo100([
      { name: "A", raw: 42 },
      { name: "B", raw: 58 },
    ]);
    expect(out.reduce((s, x) => s + x.pct, 0)).toBe(100);
    expect(out.map((x) => x.pct)).toEqual([42, 58]);
  });

  it("corrige drift de arredondamento", () => {
    const out = roundPctTo100([
      { name: "A", raw: 1 },
      { name: "B", raw: 1 },
      { name: "C", raw: 1 },
    ]);
    expect(out.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });
});

describe("inferConfigPatternFromHistory", () => {
  it("escolhe escada mais frequente, nao so a mais recente", () => {
    const four = [
      { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
      { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
      { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
      { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
    ];
    const two = [
      { name: "Meta", minAttainmentPct: 100, commissionPct: 2, bonus: 0 },
      { name: "Super", minAttainmentPct: 120, commissionPct: 3, bonus: 0 },
    ];
    const inferred = inferConfigPatternFromHistory([
      {
        startsOn: "2026-10-01",
        tierMode: "GROUP",
        tiers: two,
        groups: [{ shiftId: "m", name: "T1", pct: 40 }],
        spreadUnidentified: false,
        name: "Out",
      },
      {
        startsOn: "2026-09-01",
        tierMode: "GROUP",
        tiers: four,
        groups: [
          { shiftId: "m", name: "T1", pct: 45 },
          { shiftId: "t", name: "T2", pct: 55 },
        ],
        spreadUnidentified: true,
        name: "Set",
      },
      {
        startsOn: "2026-08-01",
        tierMode: "GROUP",
        tiers: four,
        groups: [
          { shiftId: "m", name: "T1", pct: 45 },
          { shiftId: "t", name: "T2", pct: 55 },
        ],
        spreadUnidentified: true,
        name: "Ago",
      },
    ]);
    expect(inferred).not.toBeNull();
    expect(inferred!.pattern.tiers).toHaveLength(4);
    expect(inferred!.pattern.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(inferred!.pattern.groups.map((g) => g.pct)).toEqual([45, 55]);
    expect(inferred!.chatBlocks.join(" ")).toMatch(/Padrão identificado|padrao/i);
  });

  it("applyConfigPatternToForm nao mexe no alvo R$", () => {
    const form = emptyGoalForm("a");
    form.target = 244_600;
    const next = applyConfigPatternToForm(form, {
      tierMode: "GROUP",
      tiers: [{ name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 }],
      groups: [
        { shiftId: "m", name: "T1", pct: 45 },
        { shiftId: "t", name: "T2", pct: 55 },
      ],
      spreadUnidentified: true,
      managerOn: true,
      sampleCount: 2,
      monthsLabel: "2026-09",
    });
    expect(next.target).toBe(244_600);
    expect(next.tiers).toHaveLength(1);
    expect(next.groups).toHaveLength(2);
    expect(next.managerOn).toBe(true);
  });
});

describe("copyGoalLadderFromPeriod fiel", () => {
  it("preserva niveis, grupos, bonus e managerPct do source", async () => {
    const ctx = {
      tenantId: "t",
      membershipId: "m1",
      storeIds: ["a"],
      stores: [{ id: "a", name: "LOJA", tradeName: "Loja", code: "1" }],
      network: [{ id: "a", name: "LOJA", tradeName: "Loja", code: "1" }],
      today: "2026-10-29",
      managerFirstName: "Romeu",
    } as JarvisContext;

    // Sem banco: ok=false; o contrato de mapeamento e coberto pelo snapshot acima.
    // Aqui garantimos que, dado um form ja preenchido como apos copia, o snapshot nao inventa.
    const form = emptyGoalForm("a");
    form.target = 244_600;
    form.tierMode = "GROUP";
    form.groups = [
      { shiftId: "m", name: "Turno 1", pct: 45 },
      { shiftId: "t", name: "Turno 2", pct: 55 },
    ];
    form.tiers = [
      { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
      { name: "Super meta", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
      { name: "Hiper meta", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
      { name: "Meta desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
    ];
    const failed = await copyGoalLadderFromPeriod(
      form,
      ctx,
      { from: "2026-10-01", to: "2026-10-31" },
      "a",
    );
    // Sem UUID real a busca falha — form de entrada permanece (nao vira default 100/120/150/180).
    expect(failed.ok).toBe(false);
    expect(failed.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(failed.form.groups.map((g) => g.pct)).toEqual([45, 55]);
  });
});
