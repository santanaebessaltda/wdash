import { describe, expect, it } from "vitest";
import { dayAggregate, SalesDayStore, salesDay, sumAggregates } from "./sales";
import { stores } from "./stores";
import { TODAY_ISO } from "./clock";
import { intervaloDias } from "@/lib/format";

describe("DiaVendasStore", () => {
  it("gera histórico de INICIO_HISTORICO até HOJE_ISO para todas as filiais", () => {
    const s = new SalesDayStore();
    for (const f of stores) {
      const dias = s.dias(f.id, "2026-06-01", TODAY_ISO);
      expect(dias.length).toBe(intervaloDias("2026-06-01", TODAY_ISO).length);
      for (const d of dias) {
        expect(d.filialId).toBe(f.id);
        expect(d.total.faturamento).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gera o dia da mesma forma que o helper global diaVendas", () => {
    const s = new SalesDayStore();
    for (const f of stores) {
      const iso = "2026-09-10";
      const d1 = s.dia(f.id, iso);
      const d2 = salesDay(f.id, iso);
      expect(d1).toBeDefined();
      expect(d2).toBeDefined();
      expect(d1!.total).toEqual(d2!.total);
    }
  });

  it("não retorna um dia fora do histórico", () => {
    const s = new SalesDayStore();
    expect(s.dia("f1", "2099-01-01")).toBeUndefined();
  });
});

describe("agregadoDoDia: recorte por divisão", () => {
  it("sem divisão retorna o total exato do dia", () => {
    const d = salesDay("f1", "2026-09-08")!;
    const ag = dayAggregate(d, null);
    expect(ag).toEqual(d.total);
  });

  it("com divisão retorna apenas a fatia estimada da divisão", () => {
    const d = salesDay("f1", "2026-09-08")!;
    const ag = dayAggregate(d, "WEPINK");
    expect(ag.faturamento).toBe(d.porDivisao["WEPINK"].faturamento);
    // A fatia e estimada pela fracao de faturamento (mock); pode diferir em 1
    // do total por arredondamento. Aqui asseveramos que coincide com a fatia
    // registrada, nao que seja  total (o gerador existente permite excedente).
  });
});

describe("agregadoDoDia: recorte por hora (horaMax)", () => {
  it("respeita o corte na hora máxima", () => {
    const s = new SalesDayStore();
    const d = s.dia("f1", "2026-09-08")!;
    const cheio = dayAggregate(d, null);
    const ate10 = dayAggregate(d, null, 10);
    expect(ate10.atendimentos).toBeLessThanOrEqual(cheio.atendimentos);
    // Horas com indice > 10 nao entram.
    const em11 = d.porHora[11] ?? { faturamento: 0, atendimentos: 0, itens: 0 };
    expect(ate10.faturamento).toBeLessThanOrEqual(cheio.faturamento - em11.faturamento);
  });
});

describe("somarAgregados", () => {
  it("soma corretamente múltiplos agregados", () => {
    const a = { faturamento: 100, atendimentos: 10, itens: 20 };
    const b = { faturamento: 50, atendimentos: 20, itens: 30 };
    expect(sumAggregates([a, b])).toEqual({ faturamento: 150, atendimentos: 30, itens: 50 });
  });
  it("soma vazia é zero", () => {
    expect(sumAggregates([])).toEqual({ faturamento: 0, atendimentos: 0, itens: 0 });
  });
});