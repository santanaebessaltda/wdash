import { describe, expect, it } from "vitest";
import {
  cieloOauthHtml,
  exchangeCieloAuthorizationCode,
  handleCieloOauthCallback,
  parseCieloOauthQuery,
  readCieloOauthSecrets,
} from "./cieloOauth";

describe("parseCieloOauthQuery", () => {
  it("lê code e state", () => {
    const q = parseCieloOauthQuery(new URL("https://x/hooks/cielo/oauth?code=abc&state=t1"));
    expect(q).toEqual({ kind: "code", code: "abc", state: "t1" });
  });

  it("lê error da Cielo", () => {
    const q = parseCieloOauthQuery(
      new URL("https://x/hooks/cielo/oauth?error=access_denied&error_description=negado&state=s"),
    );
    expect(q).toEqual({ kind: "error", error: "access_denied", description: "negado", state: "s" });
  });

  it("vazio sem parâmetros", () => {
    expect(parseCieloOauthQuery(new URL("https://x/hooks/cielo/oauth")).kind).toBe("empty");
  });
});

describe("readCieloOauthSecrets", () => {
  it("exige id e secret", () => {
    expect(readCieloOauthSecrets({})).toBeNull();
    expect(readCieloOauthSecrets({ CIELO_OAUTH_CLIENT_ID: "id" })).toBeNull();
    expect(readCieloOauthSecrets({ CIELO_OAUTH_CLIENT_ID: "id", CIELO_OAUTH_CLIENT_SECRET: "sec" })).toEqual({
      clientId: "id",
      clientSecret: "sec",
      redirectUri: "https://wdash-millennium-sync.fly.dev/hooks/cielo/oauth",
    });
  });
});

describe("exchangeCieloAuthorizationCode", () => {
  it("troca o code pelo token no fluxo novo", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      expect(String(init?.body)).toContain("grant_type=authorization_code");
      expect(String(init?.body)).toContain("code=xyz");
      return new Response(
        JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer" }),
        { status: 200 },
      );
    };
    await expect(
      exchangeCieloAuthorizationCode({
        secrets: {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://wdash-millennium-sync.fly.dev/hooks/cielo/oauth",
        },
        code: "xyz",
        fetchImpl,
      }),
    ).resolves.toEqual({ accessToken: "a", refreshToken: "r", expiresIn: 3600 });
  });
});

describe("handleCieloOauthCallback", () => {
  it("aceita code sem credencial de parceiro", async () => {
    const page = await handleCieloOauthCallback({
      query: { kind: "code", code: "c", state: "s" },
      secrets: null,
      erpSecret: "k".repeat(32),
    });
    expect(page.status).toBe(200);
    expect(page.html).toContain("Código recebido");
    expect(page.persist?.error).toBe("missing_partner_secrets");
  });

  it("grava token quando a troca funciona", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 60 }), { status: 200 });
    const page = await handleCieloOauthCallback({
      query: { kind: "code", code: "c", state: "s" },
      secrets: {
        clientId: "id",
        clientSecret: "sec",
        redirectUri: "https://wdash-millennium-sync.fly.dev/hooks/cielo/oauth",
      },
      erpSecret: "k".repeat(32),
      fetchImpl,
    });
    expect(page.status).toBe(200);
    expect(page.html).toContain("Cielo conectada");
    expect(page.persist?.accessCiphertext).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(page.persist?.refreshCiphertext).toBeTruthy();
    expect(page.persist?.error).toBeNull();
  });
});

describe("cieloOauthHtml", () => {
  it("escapa HTML", () => {
    const html = cieloOauthHtml({ title: "<b>x</b>", body: 'a&b"', ok: true });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a&amp;b&quot;");
  });
});
