import { describe, expect, it } from "vitest";
import { dayAggregate, SalesDayStore, salesDay, sumAggregates } from "./sales";
import { stores } from "./stores";
import { TODAY_ISO } from "./clock";
import { eachDay } from "@/lib/format";

describe("DiaVendasStore", () => {
  it("gera histórico de INICIO_HISTORICO até HOJE_ISO para todas as filiais", () => {
    const s = new SalesDayStore();
    for (const f of stores) {
      const days = s.days(f.id, "2026-06-01", TODAY_ISO);
      expect(days.length).toBe(eachDay("2026-06-01", TODAY_ISO).length);
      for (const d of days) {
        expect(d.storeId).toBe(f.id);
        expect(d.total.revenue).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gera o dia da mesma forma que o helper global diaVendas", () => {
    const s = new SalesDayStore();
    for (const f of stores) {
      const iso = "2026-09-10";
      const d1 = s.day(f.id, iso);
      const d2 = salesDay(f.id, iso);
      expect(d1).toBeDefined();
      expect(d2).toBeDefined();
      expect(d1!.total).toEqual(d2!.total);
    }
  });

  it("não retorna um dia fora do histórico", () => {
    const s = new SalesDayStore();
    expect(s.day("f1", "2099-01-01")).toBeUndefined();
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
    expect(ag.revenue).toBe(d.byDivision["WEPINK"].revenue);
    // A fatia e estimada pela fracao de faturamento (mock); pode diferir em 1
    // do total por arredondamento. Aqui asseveramos que coincide com a fatia
    // registrada, nao que seja  total (o gerador existente permite excedente).
  });
});

describe("agregadoDoDia: recorte por hora (horaMax)", () => {
  it("respeita o corte na hora máxima", () => {
    const s = new SalesDayStore();
    const d = s.day("f1", "2026-09-08")!;
    const full = dayAggregate(d, null);
    const ate10 = dayAggregate(d, null, 10);
    expect(ate10.salesCount).toBeLessThanOrEqual(full.salesCount);
    // Horas com indice > 10 nao entram.
    const em11 = d.byHour[11] ?? { revenue: 0, salesCount: 0, items: 0 };
    expect(ate10.revenue).toBeLessThanOrEqual(full.revenue - em11.revenue);
  });
});

describe("somarAgregados", () => {
  it("soma corretamente múltiplos agregados", () => {
    const a = { revenue: 100, salesCount: 10, items: 20 };
    const b = { revenue: 50, salesCount: 20, items: 30 };
    expect(sumAggregates([a, b])).toEqual({ revenue: 150, salesCount: 30, items: 50 });
  });
  it("soma vazia é zero", () => {
    expect(sumAggregates([])).toEqual({ revenue: 0, salesCount: 0, items: 0 });
  });
});