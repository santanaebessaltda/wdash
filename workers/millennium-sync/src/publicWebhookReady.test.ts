import { describe, expect, it } from "vitest";
import { publicWebhookReady } from "./stoneCloseScan.ts";

describe("publicWebhookReady", () => {
  it("aceita quando o endereço público responde", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("down");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await expect(
      publicWebhookReady("https://wdash.example/hooks/stone/pix/t", { fetchImpl, attempts: 2, waitMs: 0 }),
    ).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it("desiste de uma URL inválida", async () => {
    await expect(publicWebhookReady("nao-e-url", { attempts: 1, waitMs: 0 })).resolves.toBe(false);
  });
});
