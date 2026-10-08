import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { classifyStoneHook, startStoneWebhook } from "./stoneWebhook";

describe("classifyStoneHook", () => {
  it("reconhece o teste de cadastro e o aviso com link", () => {
    expect(classifyStoneHook({ type: "validation_notification" })).toEqual({ kind: "validation" });
    expect(
      classifyStoneHook({
        type: "pix",
        url: "https://arquivos.stone.com.br/x.csv",
        document: "12.345.678/0001-99",
        referenceDate: "2026-10-07",
      }),
    ).toEqual({
      kind: "pix",
      notice: {
        document: "12345678000199",
        referenceDate: "2026-10-07",
        url: "https://arquivos.stone.com.br/x.csv",
      },
    });
  });

  it("ignora aviso sem link https", () => {
    expect(classifyStoneHook({ type: "pix", url: "http://x", document: "12345678000199", referenceDate: "2026-10-07" }).kind).toBe(
      "ignore",
    );
  });
});

describe("startStoneWebhook", () => {
  it("responde na hora ao teste e ao aviso, e recusa outro token", async () => {
    const received: string[] = [];
    const server = startStoneWebhook({
      port: 0,
      token: "segredo",
      onPix: async (notice) => {
        received.push(notice.referenceDate);
      },
    });
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const validation = await post("/hooks/stone/pix/segredo", { type: "validation_notification" });
    expect(validation.status).toBe(200);
    const pix = await post("/hooks/stone/pix/segredo", {
      type: "pix",
      url: "https://arquivos.stone.com.br/x.csv",
      document: "12345678000199",
      referenceDate: "2026-10-07",
    });
    expect(pix.status).toBe(200);
    const wrong = await post("/hooks/stone/pix/outro", { type: "validation_notification" });
    expect(wrong.status).toBe(404);
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(["2026-10-07"]);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
});
