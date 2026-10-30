import { describe, expect, it } from "vitest";
import { classifyIntent, jarvisReply } from "./respond";

describe("classifyIntent", () => {
  it("reconhece cumprimento", () => {
    expect(classifyIntent("Oi JARVIS")).toBe("greeting");
  });

  it("reconhece desafio, meta, escala e pedidos de sair do chat", () => {
    expect(classifyIntent("Quero criar um desafio de body splash")).toBe("challenge");
    expect(classifyIntent("Vamos montar a meta de março")).toBe("goal");
    expect(classifyIntent("Gerar a escala de novembro 6x1")).toBe("schedule");
    expect(classifyIntent("Abre a Visão geral")).toBe("stay_in_chat");
    expect(classifyIntent("Rolar a página")).toBe("stay_in_chat");
    expect(classifyIntent("Vai pro Financeiro")).toBe("stay_in_chat");
  });

  it("reconhece estoque e vendas", () => {
    expect(classifyIntent("Tem produto parado no estoque?")).toBe("analyze_stock");
    expect(classifyIntent("Como está o faturamento da rede?")).toBe("analyze_sales");
    expect(classifyIntent("Quanto vendi hoje?")).toBe("analyze_sales");
    expect(classifyIntent("Quanto a loja vendeu ontem?")).toBe("analyze_sales");
    expect(classifyIntent("E em todas as filiais?")).toBe("analyze_sales");
  });

  it("leitura de meta não vira faturamento nem rascunho", () => {
    expect(classifyIntent("A meta deste mês está com meta de quanto?")).toBe("analyze_goal");
    expect(classifyIntent("Quanto é a meta?")).toBe("analyze_goal");
    expect(classifyIntent("Qual a meta da loja este mês?")).toBe("analyze_goal");
    expect(classifyIntent("Como está a meta deste mês?")).toBe("analyze_goal");
  });

  it("opinião sobre meta não vira leitura seca do brief", () => {
    expect(classifyIntent("Você acha que a gente atinge essa meta?")).toBe("goal");
    expect(classifyIntent("Você acha melhor reduzir o valor da meta?")).toBe("goal");
    expect(classifyIntent("Melhor reduzir a meta?")).toBe("goal");
  });

  it("nível desafio da escada não vira CRUD Desafio", () => {
    expect(classifyIntent("O nível desafio pode ser 10% a mais")).toBe("goal");
    expect(
      classifyIntent(
        "Sim, a meta pode ser 350.000 e o desafio 10% a mais, mesma configuração de outubro",
      ),
    ).toBe("goal");
    expect(classifyIntent("Quero criar um desafio de body splash")).toBe("challenge");
  });

  it("sugestão/reajuste de meta não vira atalho de vendas", () => {
    expect(
      classifyIntent(
        "Na verdade quero que você me der sugestão do novo valor tendo em vista os valores vendidos até hoje",
      ),
    ).toBe("goal");
    expect(classifyIntent("Posso reajustar a meta de outubro?")).toBe("goal");
    expect(classifyIntent("Vamos montar a meta de março")).toBe("goal");
  });

  it("reconhece autorização sem rascunho", () => {
    expect(classifyIntent("Autorizo")).toBe("authorize");
    expect(classifyIntent("Ok vamos criar essa meta")).toBe("authorize");
    expect(classifyIntent("cria a meta")).toBe("authorize");
    expect(classifyIntent("pode seguir assim")).toBe("authorize");
  });

  it("pedido de comecar meta nao vira autorizacao", () => {
    expect(classifyIntent("Precisava criar a meta da minha loja")).toBe("goal");
    expect(classifyIntent("Quero criar a meta de novembro")).toBe("goal");
    expect(classifyIntent("Preciso criar a meta")).toBe("goal");
    expect(classifyIntent("Vamos criar a meta da minha loja")).toBe("goal");
  });

  it("nao grava rascunho quando ainda esta mudando contexto ou valor", () => {
    expect(
      classifyIntent(
        "Na verdade no caso da minha filial do norte sul, pode seguir a mesma escala dela que de Outubro em novembro, porem acho que da pra melhorar o valor da meta",
      ),
    ).not.toBe("authorize");
    expect(classifyIntent("pode seguir a mesma escala de outubro")).toBe("goal");
  });
});

describe("jarvisReply", () => {
  it("menciona autorização no desafio", () => {
    const text = jarvisReply("Quero montar um desafio");
    expect(text.toLowerCase()).toMatch(/autoriz/);
  });

  it("não inventa número de faturamento", () => {
    const text = jarvisReply("Qual o faturamento de hoje?");
    expect(text).not.toMatch(/R\$\s*\d/);
  });

  it("pede para ficar no chat em vez de redirecionar", () => {
    const text = jarvisReply("Abre a Visão geral");
    expect(text.toLowerCase()).toMatch(/chat/);
  });
});
