import { afterEach, describe, expect, it } from "vitest";
import { fetchCieloFiles, readCieloSecrets, resetCieloTokenCache, type CieloHttp, type CieloSecrets } from "./cieloClient";

const secrets: CieloSecrets = {
  clientId: "client",
  clientSecret: "secret",
  hmac: "hmac-key",
  cert: "-----BEGIN CERTIFICATE-----\nQUFB\n-----END CERTIFICATE-----",
  key: "-----BEGIN PRIVATE KEY-----\nQkJC\n-----END PRIVATE KEY-----",
  merchantCode: "2898168445",
};

afterEach(() => {
  resetCieloTokenCache();
});

describe("readCieloSecrets", () => {
  it("exige certificado, chave e credenciais", () => {
    expect(readCieloSecrets({})).toBeNull();
    const read = readCieloSecrets({
      CIELO_CLIENT_ID: "id",
      CIELO_CLIENT_SECRET: "sec",
      CIELO_HMAC: "hmac",
      CIELO_CERT: "QUFB",
      CIELO_KEY: "-----BEGIN PRIVATE KEY-----\nQkJC\n-----END PRIVATE KEY-----",
    });
    expect(read?.merchantCode).toBe("2898168445");
    expect(read?.cert.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(read?.key.includes("BEGIN PRIVATE KEY")).toBe(true);
  });
});

describe("fetchCieloFiles", () => {
  it("pede o token, assina o link e baixa o arquivo do dia", async () => {
    const calls: string[] = [];
    const http: CieloHttp = async (req) => {
      calls.push(`${req.method} ${req.url} mtls=${req.mtls}`);
      if (req.url.includes("/token")) {
        expect(req.body).toContain("grant_type=client_credentials");
        expect(req.headers["X-Signature"]).toBeUndefined();
        return { status: 200, body: JSON.stringify({ access_token: "tok", expires_in: 600 }) };
      }
      if (req.url.includes("/link/generate")) {
        expect(req.headers.Authorization).toBe("Bearer tok");
        expect(req.headers["X-Signature"]).toBe("hmac-key");
        expect(JSON.parse(req.body ?? "{}")).toMatchObject({
          merchantCode: "2898168445",
          fileType: [3],
          startDate: "2026-10-15",
          endDate: "2026-10-15",
        });
        return {
          status: 200,
          body: JSON.stringify({
            links: [{ url: "https://files.example/edi.txt", fileType: 3, generationDate: "2026-10-16" }],
          }),
        };
      }
      expect(req.mtls).toBe(false);
      return { status: 200, body: "E arquivo" };
    };
    const texts = await fetchCieloFiles({ secrets, day: "2026-10-15", fileType: 3, http, now: 1_000 });
    expect(texts).toEqual(["E arquivo"]);
    expect(calls).toHaveLength(3);
  });

  it("lista vazia quando a Cielo ainda não publicou", async () => {
    const http: CieloHttp = async (req) => {
      if (req.url.includes("/token")) return { status: 200, body: JSON.stringify({ access_token: "tok", expires_in: 600 }) };
      return { status: 200, body: JSON.stringify({ links: [] }) };
    };
    await expect(fetchCieloFiles({ secrets, day: "2026-10-15", fileType: 16, http, now: 1_000 })).resolves.toEqual([]);
  });

  it("diz quando a chave foi recusada", async () => {
    const http: CieloHttp = async (req) => {
      if (req.url.includes("/token")) return { status: 200, body: JSON.stringify({ access_token: "tok", expires_in: 600 }) };
      return { status: 401, body: JSON.stringify({ reason: "Invalid HMAC" }) };
    };
    await expect(fetchCieloFiles({ secrets, day: "2026-10-15", fileType: 3, http, now: 1_000 })).rejects.toThrow(
      "A Cielo recusou a chave.",
    );
  });
});
