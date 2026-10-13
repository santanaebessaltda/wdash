/**
 * Lista as unidades do Group COM. A cifra é a mesma de src/data/wedash/groupCom.ts.
 * O Deno desta função não importa o src.
 */
const API = "https://appc.com21.com.br";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(["app", "appc", "www"]);
const LOGIN_KEY = "eJ6KlgBPocFmDHEFsihkHlPbO3IBskqQwiG5xbMEhiI=";
const LOGIN_IV = "ygtHNJ+F13wXKoHo";

export type GroupComUnit = {
  contractId: number;
  companyId: number;
  clientId: number;
  clientCode: string;
  roleId: number;
  code: string;
  floor: string;
  mall: string;
  timeZone: string;
};

export function groupComBaseUrl(value: string): string | null {
  const slug = groupComSlug(value);
  return slug ? `https://${slug}.com21.com.br` : null;
}

export function groupComSlug(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (!raw.includes(".") && !raw.includes("://")) {
    const slug = raw.replace(/^\/+|\/+$/g, "").toLowerCase();
    return SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
  }
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(".com21.com.br")) return null;
  const slug = host.slice(0, -".com21.com.br".length);
  if (!SLUG.test(slug) || slug.includes(".") || RESERVED.has(slug)) return null;
  return slug;
}

export async function listGroupComUnits(portal: string, email: string, password: string): Promise<{ ok: true; units: GroupComUnit[] } | { ok: false; error: "login_failed" | "no_units" }> {
  const slug = groupComSlug(portal);
  if (!slug) return { ok: false, error: "login_failed" };
  const origin = `https://${slug}.com21.com.br`;
  const domain = await ask(headers(origin), `${API}/web/api/dominios/${slug}.com21.com.br`);
  const client = domain.ok && domain.body && typeof domain.body === "object" ? domain.body as Record<string, unknown> : null;
  const clientCode = typeof client?.guidClienteGroup === "string" ? client.guidClienteGroup : "";
  const clientId = typeof client?.idClienteGroup === "number" ? client.idClienteGroup : 0;
  if (!clientCode || !clientId) return { ok: false, error: "login_failed" };

  const loginHeaders = headers(origin);
  loginHeaders.set("ClientCode", clientCode);
  const login = await ask(loginHeaders, `${API}/web/api/login/v2`, {
    method: "POST",
    body: JSON.stringify({
      login: await encrypt(email),
      senha: await encrypt(password),
      identificador: 0,
    }),
  });
  const session = login.ok && login.body && typeof login.body === "object" ? login.body as Record<string, unknown> : null;
  const token = typeof session?.token === "string" ? session.token : "";
  const userId = typeof session?.id === "number" ? String(session.id) : "";
  if (!token || !userId) return { ok: false, error: "login_failed" };

  const sessionHeaders = headers(origin);
  sessionHeaders.set("ClientCode", clientCode);
  sessionHeaders.set("Authorization", token);
  sessionHeaders.set("Username", userId);
  sessionHeaders.set("Role", "Lojista");
  sessionHeaders.set("IdPapel", "21");
  const units: GroupComUnit[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const listed = await ask(sessionHeaders, `${API}/web/api/rest/simplificado/condominio?pagina=${page}&perfil=Lojista&registrosPorPagina=100&totalRegistros=true`);
    if (!listed.ok || !Array.isArray(listed.body)) return { ok: false, error: "login_failed" };
    for (const row of listed.body) units.push(...unitFrom(row, clientId, clientCode));
    if (listed.body.length < 100) break;
  }
  return units.length > 0 ? { ok: true, units } : { ok: false, error: "no_units" };
}

function unitFrom(value: unknown, clientId: number, clientCode: string): GroupComUnit[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const company = row.empresa && typeof row.empresa === "object" ? row.empresa as Record<string, unknown> : null;
  const contractId = positive(row.idContrato);
  const companyId = positive(company?.idEmpresa);
  const roleId = positive(row.identificadorPapelPessoa);
  const code = typeof row.objeto === "string" ? row.objeto.trim() : "";
  const mall = typeof company?.nome === "string" ? company.nome.trim() : "";
  if (!contractId || !companyId || !roleId || !code || !mall) return [];
  return [{
    contractId,
    companyId,
    clientId,
    clientCode,
    roleId,
    code,
    floor: typeof row.nomeSegmento === "string" ? row.nomeSegmento.trim() : "",
    mall,
    timeZone: typeof company?.timeZone === "string" && company.timeZone.trim() ? company.timeZone.trim() : "America/Sao_Paulo",
  }];
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function headers(origin: string): Headers {
  return new Headers({
    IdentificadorAplicacao: "0",
    ProdutoTipo: "4",
    Locale: "pt-br",
    Referer: `${origin}/`,
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/json;charset=UTF-8",
  });
}

async function ask(headers: Headers, url: string, init?: { method?: string; body?: string }): Promise<{ ok: boolean; body: unknown }> {
  const request = new Headers(headers);
  if (!init?.body) request.delete("Content-Type");
  try {
    const response = await fetch(url, { method: init?.method ?? "GET", headers: request, body: init?.body });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

async function encrypt(plain: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", bytes(LOGIN_KEY) as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytes(LOGIN_IV) as BufferSource }, key, new TextEncoder().encode(plain));
  let binary = "";
  for (const byte of new Uint8Array(encrypted)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}
