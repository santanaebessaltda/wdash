import { describe, expect, it } from "vitest";
import { looksLikeUnfinishedAnalysisPromise } from "./llmClient";
import { looksLikePrematureSaveOffer } from "./goalContract";

describe("contrato de conclusao de analise", () => {
  it("detecta promessa sem resultado", () => {
    expect(
      looksLikeUnfinishedAnalysisPromise(
        "Vamos analisar as vendas da loja Centro para definir a melhor meta. Vou buscar os dados recentes.",
      ),
    ).toBe(true);
    expect(looksLikeUnfinishedAnalysisPromise("Deixa eu consultar o histórico.")).toBe(true);
  });

  it("nao marca quando ja ha numeros ou desfecho", () => {
    expect(
      looksLikeUnfinishedAnalysisPromise(
        "Em Loja Centro, outubro fechou em R$ 180.000. Recomendo R$ 200 mil para novembro.",
      ),
    ).toBe(false);
    expect(
      looksLikeUnfinishedAnalysisPromise(
        "Não achei venda sincronizada nesta filial. Vale conferir o sync.",
      ),
    ).toBe(false);
  });

  it("detecta oferta prematura de salvar a mesma config", () => {
    expect(
      looksLikePrematureSaveOffer(
        "Posso salvar a mesma configuração como rascunho para essa loja?",
      ),
    ).toBe(true);
    expect(looksLikePrematureSaveOffer("Aceita a recomendada de R$ 244.600?")).toBe(false);
  });

  it("cenario reproduzido: promessa + nome tecnico nao conta como resultado", () => {
    expect(
      looksLikeUnfinishedAnalysisPromise(
        "Vamos analisar as vendas da loja LOJAWEPINK.CENTRO.CAMPOGRANDE para definir a melhor meta. Vou buscar os dados recentes.",
      ),
    ).toBe(true);
  });
});
