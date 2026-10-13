/** Group COM. O slug é o portal, como treslagoasapp em https://treslagoasapp.com21.com.br/. */

export const GROUP_COM_API = "https://appc.com21.com.br";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST_SUFFIX = ".com21.com.br";
const RESERVED = new Set(["app", "appc", "www"]);

/** Chave pública da página de login. O e-mail e a senha saem cifrados. */
const LOGIN_KEY = "eJ6KlgBPocFmDHEFsihkHlPbO3IBskqQwiG5xbMEhiI=";
const LOGIN_IV = "ygtHNJ+F13wXKoHo";

export type GroupComUnit = {
  contractId: number;
  companyId: number;
  clientId: number;
  clientCode: string;
  roleId: number;
  /** Código da loja, como 74376-Q0024. */
  code: string;
  floor: string;
  mall: string;
  timeZone: string;
};

export type GroupComMovement = {
  dataMovimento: number;
  valorVenda: number | null;
  valorDevolucao: number | null;
  quantidadeVendas: number | null;
};

/** Aceita o slug ou o endereço do portal. */
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
  if (!host.endsWith(HOST_SUFFIX)) return null;
  const slug = host.slice(0, -HOST_SUFFIX.length);
  if (!SLUG.test(slug) || slug.includes(".") || RESERVED.has(slug)) return null;
  return slug;
}

/** Portal gravado, sem barra no final. */
export function groupComBaseUrl(value: string): string | null {
  const slug = groupComSlug(value);
  return slug ? `https://${slug}${HOST_SUFFIX}` : null;
}

export function groupComUnit(value: unknown): GroupComUnit | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const contractId = positiveId(row.contractId);
  const companyId = positiveId(row.companyId);
  const clientId = positiveId(row.clientId);
  const roleId = positiveId(row.roleId);
  const clientCode = typeof row.clientCode === "string" ? row.clientCode.trim() : "";
  const code = typeof row.code === "string" ? row.code.trim() : "";
  const floor = typeof row.floor === "string" ? row.floor.trim() : "";
  const mall = typeof row.mall === "string" ? row.mall.trim() : "";
  const timeZone = typeof row.timeZone === "string" && row.timeZone.trim() ? row.timeZone.trim() : "America/Sao_Paulo";
  if (!contractId || !companyId || !clientId || !roleId || !clientCode || !code || !mall) return null;
  return { contractId, companyId, clientId, clientCode, roleId, code, floor, mall, timeZone };
}

/** Objeto de faturamento ativo. VENDAS ganha de um objeto genérico. */
export function groupComBillingObject(rows: Array<{ idObjetoFaturamento: number; nome?: string; objetoAtivo?: number }>): number | null {
  const active = rows.filter((row) => row.objetoAtivo !== 0 && positiveId(row.idObjetoFaturamento));
  const sales = active.find((row) => /venda/i.test(row.nome ?? ""));
  return (sales ?? active[0])?.idObjetoFaturamento ?? null;
}

/** Dia civil no fuso do shopping. O instante do painel não é meia-noite. */
export function groupComDay(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochMs));
}

/** A competência ainda aceita lançamento quando o limite é hoje ou depois. */
export function groupComAcceptsLaunch(limitEpoch: number, today: string, timeZone: string): boolean {
  return groupComDay(limitEpoch, timeZone) >= today;
}

/**
 * Preenche só o dia passado vazio. Dia com valor permanece. Hoje e o futuro seguem como estão.
 * O corpo reenvia o período inteiro para não apagar o que já estava lançado.
 */
export function fillGroupComPeriod(
  movements: GroupComMovement[],
  soldCentsByDay: Record<string, number>,
  today: string,
  timeZone: string,
  only?: ReadonlySet<string>,
): { changed: boolean; movimentos: GroupComMovement[]; days: Array<{ date: string; cents: number | null }> } {
  let changed = false;
  const movimentos = movements.map((movement) => {
    const date = groupComDay(movement.dataMovimento, timeZone);
    const existing = moneyCents(movement.valorVenda);
    const next = { ...movement };
    if (date < today && existing == null && (!only || only.has(date))) {
      next.valorVenda = (soldCentsByDay[date] ?? 0) / 100;
      changed = true;
    }
    return next;
  });
  const days = movimentos.flatMap((movement) => {
    const date = groupComDay(movement.dataMovimento, timeZone);
    const cents = moneyCents(movement.valorVenda);
    if (date >= today || cents == null) return [];
    return [{ date, cents }];
  });
  return { changed, movimentos, days };
}

export function groupComMovementsMatch(sent: GroupComMovement[], echoed: GroupComMovement[], timeZone: string): boolean {
  if (sent.length !== echoed.length) return false;
  return sent.every((movement, index) => {
    const other = echoed[index];
    return other != null && movement.dataMovimento === other.dataMovimento && moneyCents(movement.valorVenda) === moneyCents(other.valorVenda);
  }) && sent.every((movement) => groupComDay(movement.dataMovimento, timeZone).length === 10);
}

export async function encryptGroupComField(plain: string): Promise<string> {
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: loginIv() }, await loginKey(), new TextEncoder().encode(plain));
  return base64FromBytes(new Uint8Array(encrypted));
}

export async function decryptGroupComField(payload: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: loginIv() }, await loginKey(), bytesFromBase64(payload) as BufferSource);
  return new TextDecoder().decode(decrypted);
}

function positiveId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function moneyCents(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

async function loginKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytesFromBase64(LOGIN_KEY) as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function loginIv(): BufferSource {
  return bytesFromBase64(LOGIN_IV) as BufferSource;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
