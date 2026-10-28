/**
 * Callback OAuth da conciliadora Cielo (GET /hooks/cielo/oauth).
 * Fluxo novo (Keycloak), vigente em produção desde 2026-10-01.
 */
import { encryptSecret } from "./decrypt.ts";

export const CIELO_OAUTH_TOKEN_URL =
  "https://acesso.cielo.com.br/realms/digital-idp/protocol/openid-connect/token";

export const CIELO_OAUTH_REDIRECT_DEFAULT = "https://wdash-millennium-sync.fly.dev/hooks/cielo/oauth";

export type CieloOauthQuery =
  | { kind: "code"; code: string; state: string }
  | { kind: "error"; error: string; description: string; state: string }
  | { kind: "empty" };

export type CieloOauthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type CieloOauthSecrets = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function parseCieloOauthQuery(url: URL): CieloOauthQuery {
  const error = (url.searchParams.get("error") ?? "").trim();
  if (error) {
    return {
      kind: "error",
      error,
      description: (url.searchParams.get("error_description") ?? "").trim(),
      state: (url.searchParams.get("state") ?? "").trim(),
    };
  }
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!code) return { kind: "empty" };
  return {
    kind: "code",
    code,
    state: (url.searchParams.get("state") ?? "").trim(),
  };
}

export function readCieloOauthSecrets(env: NodeJS.ProcessEnv = process.env): CieloOauthSecrets | null {
  const clientId = (env.CIELO_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.CIELO_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri = (env.CIELO_OAUTH_REDIRECT_URI ?? "").trim() || CIELO_OAUTH_REDIRECT_DEFAULT;
  return { clientId, clientSecret, redirectUri };
}

export async function exchangeCieloAuthorizationCode(opts: {
  secrets: CieloOauthSecrets;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<CieloOauthTokens> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: opts.secrets.clientId,
    client_secret: opts.secrets.clientSecret,
    code: opts.code,
    redirect_uri: opts.secrets.redirectUri,
  });
  const res = await fetchImpl(CIELO_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`A Cielo recusou o código OAuth (${res.status}).`);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("A Cielo devolveu um token inválido.");
  }
  const accessToken = typeof json.access_token === "string" ? json.access_token.trim() : "";
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token.trim() : "";
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : Number(json.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("A Cielo devolveu um token incompleto.");
  }
  return { accessToken, refreshToken, expiresIn };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function cieloOauthHtml(opts: { title: string; body: string; ok: boolean }): string {
  const tone = opts.ok ? "#0a7a3e" : "#b42318";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(opts.title)} · WDash</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#0b0b0f;color:#f5f5f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    main{max-width:28rem;width:100%}
    h1{font-size:1.25rem;margin:0 0 .5rem;color:${tone}}
    p{margin:0;line-height:1.5;color:#c7c7cc}
    .mark{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#8e8e93;margin-bottom:1rem}
  </style>
</head>
<body>
  <main>
    <div class="mark">WDash</div>
    <h1>${escapeHtml(opts.title)}</h1>
    <p>${escapeHtml(opts.body)}</p>
  </main>
</body>
</html>`;
}

export type CieloOauthPersist = {
  state: string;
  accessCiphertext: string | null;
  refreshCiphertext: string | null;
  expiresAt: string | null;
  error: string | null;
};

/** Processa o redirect da Cielo: troca o code (se houver credencial) e monta a página. */
export async function handleCieloOauthCallback(opts: {
  query: CieloOauthQuery;
  secrets: CieloOauthSecrets | null;
  erpSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: number; html: string; persist: CieloOauthPersist | null; log: string }> {
  if (opts.query.kind === "empty") {
    return {
      status: 400,
      html: cieloOauthHtml({
        title: "Autorização incompleta",
        body: "A Cielo não enviou o código de autorização. Feche esta janela e tente de novo pelo link da WDash.",
        ok: false,
      }),
      persist: null,
      log: "callback sem code nem error",
    };
  }

  if (opts.query.kind === "error") {
    const detail = opts.query.description || opts.query.error;
    return {
      status: 200,
      html: cieloOauthHtml({
        title: "Autorização recusada",
        body: `A Cielo não concluiu o acesso (${detail}). Feche esta janela e tente de novo.`,
        ok: false,
      }),
      persist: {
        state: opts.query.state,
        accessCiphertext: null,
        refreshCiphertext: null,
        expiresAt: null,
        error: detail.slice(0, 500),
      },
      log: `callback error=${opts.query.error}`,
    };
  }

  if (!opts.secrets) {
    return {
      status: 200,
      html: cieloOauthHtml({
        title: "Código recebido",
        body: "A Cielo redirecionou com sucesso. Falta cadastrar CIELO_OAUTH_CLIENT_ID e CIELO_OAUTH_CLIENT_SECRET no worker para trocar o código pelo acesso.",
        ok: true,
      }),
      persist: {
        state: opts.query.state,
        accessCiphertext: null,
        refreshCiphertext: null,
        expiresAt: null,
        error: "missing_partner_secrets",
      },
      log: "callback com code — sem credencial de parceiro",
    };
  }

  try {
    const tokens = await exchangeCieloAuthorizationCode({
      secrets: opts.secrets,
      code: opts.query.code,
      fetchImpl: opts.fetchImpl,
    });
    const accessCiphertext = await encryptSecret(tokens.accessToken, opts.erpSecret);
    const refreshCiphertext = await encryptSecret(tokens.refreshToken, opts.erpSecret);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
    return {
      status: 200,
      html: cieloOauthHtml({
        title: "Cielo conectada",
        body: "A autorização foi concluída. Já pode fechar esta janela e voltar à WDash.",
        ok: true,
      }),
      persist: {
        state: opts.query.state,
        accessCiphertext,
        refreshCiphertext,
        expiresAt,
        error: null,
      },
      log: "callback com code — token gravado",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      status: 200,
      html: cieloOauthHtml({
        title: "Não foi possível concluir",
        body: `${message} Feche esta janela e tente de novo.`,
        ok: false,
      }),
      persist: {
        state: opts.query.state,
        accessCiphertext: null,
        refreshCiphertext: null,
        expiresAt: null,
        error: message.slice(0, 500),
      },
      log: `callback com code — falha: ${message}`,
    };
  }
}
