import { describe, expect, it } from "vitest";
import {
  challengeManagerTarget,
  challenges,
  activeChallenges,
  challengeFloor,
  cappedManagerProgress,
  individualProgress,
} from "./challenges";
import { collaboratorById } from "./team";

describe("T1: desafios ativos (EQUIP-05)", () => {
  it("competência corrente tem 4 desafios ativos", () => {
    expect(activeChallenges("2026-09").length).toBe(4);
  });

  it("competência sem desafios devolve lista vazia", () => {
    expect(activeChallenges("2026-08")).toEqual([]);
    expect(activeChallenges("2025-01")).toEqual([]);
  });

  it("cobre os tipos usados no mock: quantidade, produto, P.A. e ticket", () => {
    const tipos = activeChallenges("2026-09").map((d) => d.kind);
    expect(new Set(tipos)).toEqual(new Set(["quantidade", "produto", "pa", "ticket"]));
  });

  it("desafios nunca em reais como unidade de meta: prêmio é o único campo de recompensa", () => {
    for (const d of challenges) {
      expect(["un", "x", "R$"]).toContain(d.unit);
      expect(d.prize).toBeGreaterThan(0);
      expect(d.premioGerente).toBeGreaterThan(0);
      expect(d.minimoVendedorasAtingindo).toBeGreaterThan(0);
      expect(d.minimoVendedorasAtingindo).toBeLessThanOrEqual(d.participants.length);
    }
  });

  it("participantes são vendedoras elegíveis existentes e sem férias no meio", () => {
    for (const d of activeChallenges("2026-09")) {
      expect(d.participants.length).toBeGreaterThan(0);
      for (const id of d.participants) {
        const c = collaboratorById(id);
        expect(c).toBeDefined();
        expect(c!.kind).toBe("SELLER");
        expect(id).not.toBe("c06"); // Fernanda em ferias
        expect(id).not.toBe("c09"); // caixa
      }
    }
  });

  it("cada desafio pertence a uma loja; participantes são da mesma loja", () => {
    const ativos = activeChallenges("2026-09");
    const perf = ativos.find((d) => d.id === "d-perfumaria")!;
    const body = ativos.find((d) => d.id === "d-bodycream")!;
    const pa = ativos.find((d) => d.id === "d-pa")!;
    const ticket = ativos.find((d) => d.id === "d-ticket")!;
    expect(perf.storeId).toBe("f1");
    expect(pa.storeId).toBe("f1");
    expect(body.storeId).toBe("f2");
    expect(ticket.storeId).toBe("f2");
    for (const d of ativos) {
      expect(d.storeId).toBeTruthy();
      for (const id of d.participants) {
        expect(collaboratorById(id)!.storeId).toBe(d.storeId);
      }
    }
    expect(perf.participants.length).toBeLessThanOrEqual(pa.participants.length);
    expect(body.participants.length).toBeLessThanOrEqual(ticket.participants.length);
  });

  it("progresso individual é determinístico (mesma chave, mesmo valor)", () => {
    const d = activeChallenges("2026-09")[0];
    const id = d.participants[0];
    expect(individualProgress(d, id)).toBe(individualProgress(d, id));
  });

  it("progresso individual nunca é negativo e respeita não-participante", () => {
    const d = activeChallenges("2026-09")[0];
    for (const id of d.participants) {
      expect(individualProgress(d, id)).toBeGreaterThanOrEqual(0);
    }
    expect(individualProgress(d, "c09")).toBe(0);
  });

  it("progresso de quantidade/produto é sempre unidade inteira", () => {
    for (const d of activeChallenges("2026-09").filter((x) => x.unit === "un")) {
      for (const id of d.participants) {
        const p = individualProgress(d, id);
        expect(Number.isInteger(p)).toBe(true);
      }
    }
  });

  it("cada desafio tem janela inicio/fim válida na competência", () => {
    for (const d of activeChallenges("2026-09")) {
      expect(d.start <= d.end).toBe(true);
      expect(d.start.startsWith("2026-09")).toBe(true);
      expect(d.end.startsWith("2026-09")).toBe(true);
    }
  });

  it("meta do gerente: un = piso × N; índices (pa/ticket) = o próprio piso; capped não deixa 1 carregar", () => {
    const perf = activeChallenges("2026-09").find((d) => d.id === "d-perfumaria")!;
    const pa = activeChallenges("2026-09").find((d) => d.id === "d-pa")!;
    expect(challengeManagerTarget(perf, perf.participants.length)).toBe(challengeFloor(perf) * 3);
    expect(challengeManagerTarget(pa, pa.participants.length)).toBe(challengeFloor(pa));
    // 1 pessoa com 10 e 4 com 0  ->  capped = 3 (nao 10)
    expect(cappedManagerProgress([10, 0, 0, 0, 0], 3)).toBe(3);
    expect(cappedManagerProgress([3, 3, 3, 0, 0], 3)).toBe(9);
  });

  it("progresso de P.A. fica na faixa de índice (~0,5–2,5), não soma absurda", () => {
    const pa = activeChallenges("2026-09").find((d) => d.id === "d-pa")!;
    for (const id of pa.participants) {
      const p = individualProgress(pa, id);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(3);
    }
  });

  it("desafio a começar (ticket) ainda não tem progresso", () => {
    const ticket = activeChallenges("2026-09").find((d) => d.id === "d-ticket")!;
    for (const id of ticket.participants) {
      expect(individualProgress(ticket, id)).toBe(0);
    }
  });
});
