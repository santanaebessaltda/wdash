import { describe, expect, it } from "vitest";
import { looksLikeNavigate, resolveNavigate } from "./navigateBrief";
import { paths } from "@/router/paths";

describe("looksLikeNavigate", () => {
  it("reconhece verbos de navegação", () => {
    expect(looksLikeNavigate("Abre a Visão geral")).toBe(true);
    expect(looksLikeNavigate("Como estão as vendas?")).toBe(false);
  });
});

describe("resolveNavigate", () => {
  it("abre Visão geral e Financeiro", () => {
    expect(resolveNavigate("Entra na Visão geral", "OWNER")?.to).toBe(paths.overview);
    expect(resolveNavigate("Vai pro Financeiro", "OWNER")?.to).toBe(paths.financial);
  });
});
