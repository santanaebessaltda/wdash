import { describe, expect, it } from "vitest";
import { stoneFileReady } from "../../../src/data/wedash/stoneClock";
import { parseStonePixCsv, registerStoneWebhook, stonePixPaidCents } from "./stonePix";

const csv = [
  "id;status;created_at;pix_transaction__e2e_id;pix_transaction__paid_amount;pix_transaction__canceled_amount;pix_transaction__fee_amount;pix_transaction__terminal__serial_number",
  "e1;paid;2026-10-07T15:20:28Z;E2E1;10.50;0;0.10;ABC123",
  "e2;canceled;2026-10-07 18:00:00;E2E2;20,00;20,00;0;",
  "e3;paid;2026-10-07T19:00:00Z;E2E3;1.234,56;0;0;T9",
].join("\n");

describe("parseStonePixCsv", () => {
  it("lê o CSV com ponto e vírgula e trata cancelado à parte", () => {
    const rows = parseStonePixCsv(csv);
    expect(rows.map((r) => r.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(rows[0]).toMatchObject({
      e2eId: "E2E1",
      status: "paid",
      paidCents: 1050,
      feeCents: 10,
      occurredAt: "2026-10-07T15:20:28.000Z",
      terminalSerial: "ABC123",
    });
    expect(rows[1]?.occurredAt).toBe("2026-10-07T18:00:00.000Z");
    expect(rows[1]?.paidCents).toBe(2000);
    expect(stonePixPaidCents(rows[1]!)).toBe(0);
    expect(rows[2]?.paidCents).toBe(123456);
  });

  it("cabeçalho sozinho é um dia sem PIX", () => {
    expect(parseStonePixCsv("id;status\n")).toEqual([]);
  });
});

describe("registerStoneWebhook", () => {
  it("atualiza o aviso quando a Stone já tinha o endereço", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      return new Response(null, { status: init?.method === "PUT" ? 204 : 409 });
    }) as typeof fetch;
    await expect(registerStoneWebhook({ secret: "s", url: "https://example.com/hooks/stone/pix/t", fetchImpl })).resolves.toBe("updated");
    expect(calls).toEqual(["POST", "PUT"]);
  });
});

describe("stoneFileReady", () => {
  it("libera o dia às 5h de Brasília do dia seguinte", () => {
    expect(stoneFileReady("2026-10-07", new Date("2026-10-08T07:59:00.000Z"))).toBe(false);
    expect(stoneFileReady("2026-10-07", new Date("2026-10-08T08:00:00.000Z"))).toBe(true);
  });
});
