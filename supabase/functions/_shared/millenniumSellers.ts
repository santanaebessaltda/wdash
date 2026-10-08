/**
 * Vendedoras da loja (espelho de workers/millennium-sync/src/millenniumSellers.ts  -  manter iguais).
 * FUNCIONARIOS.Lista (sem cargo) + FUNCIONARIOS.Consulta por funcionaria (flags de status).
 * Todos entram com o cargo; equipe de vendas = ativa com cargo VENDEDOR ou inativa de qualquer cargo
 * (desativar troca VENDEDOR  ->  INDEFINIDO). Ativos com outro cargo (gerencia) ficam fora da equipe e do ranking.
 */
import { baseUrl } from "./millennium.ts";
import { titleName } from "./text.ts";

export type ErpSellerFlags = {
  desativado: boolean;
  inativo: boolean;
  afastado: boolean;
  naoMostrarNoEvento: boolean;
};

export type ErpSeller = {
  employeeId: number;
  code: string;
  name: string;
  login: string | null;
  /** CARGO da Lista (upper). */
  role: string;
  active: boolean;
  flags: ErpSellerFlags;
  /** GERADORES[0].GERADOR do Consulta  -  codigo que vem nas vendas do relatorio de cupom. */
  geradorId: number | null;
};

type ListaRow = { employeeId: number; code: string; name: string; login: string | null; role: string };

const CONSULTA_CONCURRENCY = 5;

export class MillenniumHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Espelho de `sellerKeyFromName` (src/data/wedash/salesAggregate.ts): trim, sem acento, upper, espacos colapsados. */
export function sellerKeyFromName(raw: string | null | undefined): string | null {
  const key = (raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return key || null;
}

export function mergeNameKeys(prev: readonly string[] | null | undefined, name: string): string[] {
  const out = [...(prev ?? [])];
  const key = sellerKeyFromName(name);
  if (key && !out.includes(key)) out.push(key);
  return out;
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || (typeof v === "string" && v.toLowerCase() === "true");
}

function parseLista(payload: unknown): ListaRow[] {
  const out: ListaRow[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const employeeId = asNum(o.FUNCIONARIO);
    const name = titleName(asStr(o.NOME));
    if (employeeId == null || !name) continue;
    out.push({
      employeeId,
      code: asStr(o.COD_FUNCIONARIO),
      name,
      login: asStr(o.LOGIN) || null,
      role: asStr(o.CARGO).toUpperCase(),
    });
  }
  return out;
}

function consultaRecord(payload: unknown): { o: Record<string, unknown>; gerador: Record<string, unknown> | undefined } {
  const list = extractList(payload);
  const o = (list[0] ?? payload ?? {}) as Record<string, unknown>;
  const geradores = Array.isArray(o.GERADORES) ? (o.GERADORES as Record<string, unknown>[]) : [];
  return { o, gerador: geradores[0] };
}

function parseFlags(payload: unknown): ErpSellerFlags {
  const { o, gerador } = consultaRecord(payload);
  return {
    desativado: asBool(gerador?.DESATIVADO),
    inativo: asBool(o.INATIVO),
    afastado: asBool(o.AFASTADO),
    naoMostrarNoEvento: asBool(o.NAO_MOSTRAR_NO_EVENTO),
  };
}

function parseGerador(payload: unknown): number | null {
  const id = asNum(consultaRecord(payload).gerador?.GERADOR);
  return id != null && id > 0 ? id : null;
}

async function post(path: string, session: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/${path}`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (!res.ok) throw new MillenniumHttpError(`${path} → ${res.status} ${text.slice(0, 200)}`, res.status);
  try {
    return text ? (JSON.parse(text) as unknown) : [];
  } catch {
    throw new Error(`${path} JSON inválido: ${text.slice(0, 200)}`);
  }
}

export async function fetchStoreSellers(session: string, millenniumStoreId: number): Promise<ErpSeller[]> {
  const lista = parseLista(
    await post("millenium.FUNCIONARIOS.Lista?$top=500", session, {
      ORDEM: 1,
      CAMPO: 1,
      FILTRO: 2,
      VALOR_FILTRO: null,
      VALOR_1: null,
      VALOR_2: null,
      FILIAL: millenniumStoreId,
      CARGO: null,
      RESPONSAVEL: null,
    }),
  );

  const out: (ErpSeller | null)[] = new Array(lista.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < lista.length) {
      const i = next++;
      const row = lista[i]!;
      const consulta = await post("millenium.FUNCIONARIOS.Consulta", session, { FUNCIONARIO: row.employeeId });
      const flags = parseFlags(consulta);
      const active = !(flags.desativado || flags.inativo || flags.afastado || flags.naoMostrarNoEvento);
      out[i] = { ...row, flags, active, geradorId: parseGerador(consulta) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONSULTA_CONCURRENCY, lista.length) }, worker));
  return out.filter((s): s is ErpSeller => s != null);
}
