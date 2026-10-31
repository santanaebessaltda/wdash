import { describe, expect, it } from "vitest";
import { emptyChallengeForm } from "@/data/wedash/challengeForm";
import {
  challengeDraftReady,
  discussChallenge,
  ensureChallengeName,
  mergeChallengeUtterance,
  missingChallengeLabels,
  parseChallengeDates,
} from "./challengeDraft";
import { validateChallengeForm } from "@/data/wedash/challengeForm";
import { vi } from "vitest";

vi.mock("@/data/wedash/challengesRepo", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/data/wedash/challengesRepo")>();
  return {
    ...mod,
    fetchChallengeCatalog: async () => null,
  };
});

const ctx = {
  tenantId: "t",
  membershipId: "m1",
  storeIds: ["a"],
  stores: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  network: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  today: "2026-10-29",
  managerFirstName: "Romeu",
};

describe("parseChallengeDates", () => {
  it("interpreta N dias a partir de hoje", () => {
    expect(parseChallengeDates("desafio por 7 dias", "2026-10-29")).toEqual({
      startsOn: "2026-10-29",
      endsOn: "2026-11-04",
    });
  });

  it("interpreta de DD/MM a DD/MM", () => {
    expect(parseChallengeDates("de 01/11 a 07/11", "2026-10-29")).toEqual({
      startsOn: "2026-11-01",
      endsOn: "2026-11-07",
    });
  });
});

describe("mergeChallengeUtterance", () => {
  it("fecha modo, métrica, prêmio e período", () => {
    let form = emptyChallengeForm("a");
    form = mergeChallengeUtterance(form, "disputa de itens por 7 dias, 100 reais pro primeiro", ctx);
    form = ensureChallengeName(form);
    form = {
      ...form,
      scope: "ALL",
      products: [],
    };
    expect(form.mode).toBe("CONTEST");
    expect(form.metric).toBe("QUANTITY");
    expect(form.prizes[0]?.kind).toBe("MONEY");
    expect(form.startsOn).not.toBeNull();
    expect(form.endsOn).not.toBeNull();
    expect(challengeDraftReady(form)).toBe(true);
  });

  it("mínimo exige alvo", () => {
    let form = emptyChallengeForm("a");
    form = mergeChallengeUtterance(form, "mínimo de 10 itens por 5 dias, prêmio 50 reais", ctx);
    form = ensureChallengeName({ ...form, scope: "ALL", products: [] });
    expect(form.mode).toBe("MINIMUM");
    expect(form.target).toMatch(/10/);
    expect(Object.keys(validateChallengeForm(form)).length).toBe(0);
  });
});

describe("missingChallengeLabels", () => {
  it("lista o que falta", () => {
    const labels = missingChallengeLabels(validateChallengeForm(emptyChallengeForm("")));
    expect(labels).toContain("nome");
    expect(labels).toContain("filial");
    expect(labels).toContain("período");
  });
});

describe("Topbar Todas — desafio pede filial", () => {
  it("nao inventa a primeira loja", async () => {
    const multi = {
      ...ctx,
      storeIds: [] as string[],
      stores: [
        ctx.stores[0]!,
        { id: "b", name: "CENTRO", tradeName: "Loja Centro", code: "00386" },
      ],
      network: [
        ctx.stores[0]!,
        { id: "b", name: "CENTRO", tradeName: "Loja Centro", code: "00386" },
      ],
    };
    const { draft, spokenReply } = await discussChallenge("Criar um desafio", multi, null);
    expect(draft.form.storeId).toBe("");
    expect(spokenReply).toMatch(/todas as lojas|filial/i);
  });
});
