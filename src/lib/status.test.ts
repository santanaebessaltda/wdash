import { describe, expect, it } from "vitest";
import { statusBadgeVariant } from "./status";

describe("statusBadgeVariant", () => {
  it("maps product status labels to the fixed color semantics", () => {
    // success — resultado positivo / saudável
    expect(statusBadgeVariant("Ativo")).toBe("success");
    expect(statusBadgeVariant("Regular")).toBe("success");
    expect(statusBadgeVariant("Fechado")).toBe("success");
    expect(statusBadgeVariant("Recebido")).toBe("success");
    expect(statusBadgeVariant("Informado")).toBe("success");
    expect(statusBadgeVariant("Conectado")).toBe("success");
    expect(statusBadgeVariant("Concluído")).toBe("success");
    expect(statusBadgeVariant("Alcançado")).toBe("success");
    expect(statusBadgeVariant("Atingido")).toBe("success");

    // warning — pendência
    expect(statusBadgeVariant("Pendente")).toBe("warning");
    expect(statusBadgeVariant("Convite pendente")).toBe("warning");
    expect(statusBadgeVariant("A receber")).toBe("warning");
    expect(statusBadgeVariant("Aguardando transferência")).toBe("warning");
    expect(statusBadgeVariant("Fechamento em andamento")).toBe("warning");
    expect(statusBadgeVariant("Não informado")).toBe("warning");
    expect(statusBadgeVariant("Oculto")).toBe("warning");

    // danger
    expect(statusBadgeVariant("Suspenso")).toBe("danger");
    expect(statusBadgeVariant("Negativo")).toBe("danger");
    expect(statusBadgeVariant("Erro")).toBe("danger");
    expect(statusBadgeVariant("Senha inválida")).toBe("danger");
    expect(statusBadgeVariant("Não alcançado")).toBe("danger");
    expect(statusBadgeVariant("Com diferença")).toBe("danger");

    // info — futuro
    expect(statusBadgeVariant("A começar")).toBe("info");

    // accent — estado atual
    expect(statusBadgeVariant("Em andamento")).toBe("accent");
    expect(statusBadgeVariant("Em aberto")).toBe("accent");

    // neutral — encerrado / sem config
    expect(statusBadgeVariant("Desligado")).toBe("neutral");
    expect(statusBadgeVariant("Sem acesso")).toBe("neutral");
    expect(statusBadgeVariant("Encerrada")).toBe("neutral");
    expect(statusBadgeVariant("Encerrado")).toBe("neutral");
    expect(statusBadgeVariant("Rascunho")).toBe("neutral");
    expect(statusBadgeVariant("Desativada")).toBe("neutral");
    expect(statusBadgeVariant("Desconectado")).toBe("neutral");
  });
});
