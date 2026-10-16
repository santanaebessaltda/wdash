/**
 * API de link do extrato Cielo. O certificado entra na conexão.
 * client_id e client_secret viram Bearer. A chave HMAC vai no header X-Signature.
 */
import https from "node:https";
import { gunzipSync } from "node:zlib";

const TOKEN_URL =
  "https://api-internet.cielo.com.br/cielo-security-sys-web/oauth/v2/MulesoftPRD/protocol/openid-connect/token";
const LINK_URL =
  "https://api-internet.cielo.com.br/cielo-extc-serv-edi-link-exp-external/extc-serv-edi-link-external/v1/link/generate";

export type CieloSecrets = {
  clientId: string;
  clientSecret: string;
  hmac: string;
  cert: string;
  key: string;
  merchantCode: string;
};

export type CieloHttp = (req: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  mtls: boolean;
}) => Promise<{ status: number; body: string }>;

type TokenCache = { token: string; until: number };

let tokenCache: TokenCache | null = null;

function pem(raw: string, kind: "CERTIFICATE" | "PRIVATE KEY"): string {
  const text = raw.replace(/\\n/g, "\n").trim();
  if (text.includes("BEGIN")) return text;
  const body = text.replace(/\s/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${kind}-----\n${lines}\n-----END ${kind}-----`;
}

/** Monta o acesso de uma empresa. Certificado e chave privada aceitam PEM ou base64. */
export function buildCieloSecrets(input: {
  clientId: string;
  clientSecret: string;
  hmac: string;
  cert: string;
  key: string;
  merchantCode: string;
}): CieloSecrets | null {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  const hmac = input.hmac.trim();
  const cert = input.cert.trim();
  const key = input.key.trim();
  const merchant = input.merchantCode.replace(/\D/g, "");
  if (!clientId || !clientSecret || !hmac || !cert || !key || !merchant) return null;
  return {
    clientId,
    clientSecret,
    hmac,
    cert: pem(cert, "CERTIFICATE"),
    key: pem(key, "PRIVATE KEY"),
    merchantCode: merchant.padStart(10, "0").slice(-10),
  };
}

/** Lê variáveis de ambiente. O fechamento não usa isto: cada empresa grava o acesso em tenant_cielo. */
export function readCieloSecrets(env: NodeJS.ProcessEnv = process.env): CieloSecrets | null {
  return buildCieloSecrets({
    clientId: env.CIELO_CLIENT_ID ?? "",
    clientSecret: env.CIELO_CLIENT_SECRET ?? "",
    hmac: env.CIELO_HMAC ?? "",
    cert: env.CIELO_CERT ?? "",
    key: env.CIELO_KEY ?? "",
    merchantCode: env.CIELO_MERCHANT_CODE?.trim() || "2898168445",
  });
}

function httpsText(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; cert?: string; key?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers: init.headers,
        cert: init.cert,
        key: init.key,
        timeout: 120_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const location = res.headers.location;
          if (location && res.statusCode && [301, 302, 307, 308].includes(res.statusCode)) {
            const next = new URL(location, url).toString();
            httpsText(next, { method: "GET", headers: { Accept: "*/*" } }).then(resolve, reject);
            return;
          }
          const raw = Buffer.concat(chunks);
          const text =
            raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("A Cielo não respondeu a tempo."));
    });
    if (init.body) req.write(init.body);
    req.end();
  });
}

function defaultHttp(secrets: CieloSecrets): CieloHttp {
  return (req) =>
    httpsText(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      cert: req.mtls ? secrets.cert : undefined,
      key: req.mtls ? secrets.key : undefined,
    });
}

function reasonOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { reason?: unknown; error?: unknown; errorMessage?: unknown };
    const reason = parsed.reason ?? parsed.errorMessage ?? parsed.error;
    return typeof reason === "string" ? reason.slice(0, 180) : "";
  } catch {
    return "";
  }
}

function fail(status: number, body: string, hmac: boolean): never {
  const reason = reasonOf(body);
  if (hmac && /hmac/i.test(reason)) throw new Error("A Cielo recusou a chave.");
  if (status === 401) throw new Error("A Cielo recusou o certificado ou as credenciais da aplicação.");
  throw new Error(`A Cielo respondeu ${status}${reason ? `: ${reason}` : ""}.`);
}

async function accessToken(secrets: CieloSecrets, http: CieloHttp, now: number): Promise<string> {
  if (tokenCache && tokenCache.until > now) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    grant_type: "client_credentials",
  }).toString();
  const res = await http({
    url: TOKEN_URL,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    mtls: true,
  });
  if (res.status < 200 || res.status >= 300) fail(res.status, res.body, false);
  let parsed: { access_token?: unknown; expires_in?: unknown };
  try {
    parsed = JSON.parse(res.body) as { access_token?: unknown; expires_in?: unknown };
  } catch {
    throw new Error("A Cielo não devolveu o acesso.");
  }
  const token = typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!token) throw new Error("A Cielo não devolveu o acesso.");
  const expires = Number(parsed.expires_in);
  const ttl = Number.isFinite(expires) && expires > 60 ? expires - 30 : 60;
  tokenCache = { token, until: now + ttl * 1000 };
  return token;
}

type CieloLink = { url: string; fileType: number; generationDate: string };

function linksOf(body: string): CieloLink[] {
  let parsed: { links?: unknown };
  try {
    parsed = JSON.parse(body) as { links?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.links)) return [];
  const out: CieloLink[] = [];
  for (const row of parsed.links) {
    if (!row || typeof row !== "object") continue;
    const url = "url" in row && typeof row.url === "string" ? row.url : "";
    const fileType = "fileType" in row ? Number(row.fileType) : NaN;
    const generationDate = "generationDate" in row && typeof row.generationDate === "string" ? row.generationDate : "";
    if (!url.startsWith("https://") || !Number.isFinite(fileType)) continue;
    out.push({ url, fileType, generationDate });
  }
  return out;
}

/** Textos dos arquivos daquele dia. Lista vazia = a Cielo ainda não publicou. */
export async function fetchCieloFiles(opts: {
  secrets: CieloSecrets;
  day: string;
  fileType: 3 | 16;
  http?: CieloHttp;
  now?: number;
}): Promise<string[]> {
  const http = opts.http ?? defaultHttp(opts.secrets);
  const token = await accessToken(opts.secrets, http, opts.now ?? Date.now());
  const res = await http({
    url: LINK_URL,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Signature": opts.secrets.hmac,
    },
    body: JSON.stringify({
      merchantCode: opts.secrets.merchantCode,
      fileType: [opts.fileType],
      processType: ["D", "R"],
      startDate: opts.day,
      endDate: opts.day,
    }),
    mtls: true,
  });
  if (res.status < 200 || res.status >= 300) fail(res.status, res.body, true);
  const links = linksOf(res.body).filter((link) => link.fileType === opts.fileType);
  const texts: string[] = [];
  for (const link of links) {
    const host = new URL(link.url).hostname;
    const file = await http({
      url: link.url,
      method: "GET",
      headers: { Accept: "*/*" },
      mtls: host === "api-internet.cielo.com.br",
    });
    if (file.status < 200 || file.status >= 300) fail(file.status, file.body, false);
    if (file.body.trim()) texts.push(file.body);
  }
  return texts;
}

/** Testes trocam o relógio do token. */
export function resetCieloTokenCache(): void {
  tokenCache = null;
}
