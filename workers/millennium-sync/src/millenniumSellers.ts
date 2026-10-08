/**
 * Funcionarios da loja: millenium.FUNCIONARIOS.Lista (sem filtro de cargo) + FUNCIONARIOS.Consulta por funcionaria.
 * Todos entram com o cargo (`role`); quem e da equipe de vendas decide a leitura: ativa com cargo VENDEDOR
 * ou inativa de qualquer cargo (ao desativar, o ERP troca VENDEDOR  ->  INDEFINIDO). Ativos com outro cargo
 * (gerencia, conta usada por freelancer) ficam fora da equipe e do ranking.
 * A Lista nao traz status  -  flags so vem no Consulta.
 * Inativa = OR de DESATIVADO (GERADORES[0])  |  INATIVO  |  AFASTADO  |  NAO_MOSTRAR_NO_EVENTO (ERP marca de formas diferentes).
 */
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { titleName } from "../../../src/lib/format.ts";

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
  /** null = nao consultada neste sync (ja tinha gerador e o cargo nao mudou)  -  status fica o do banco. */
  active: boolean | null;
  flags: ErpSellerFlags | null;
  /** GERADORES[0].GERADOR do Consulta  -  codigo que vem nas vendas do relatorio de cupom. */
  geradorId: number | null;
};

type ListaRow = { employeeId: number; code: string; name: string; login: string | null; role: string };

const SELLER_ROLE = "VENDEDOR";

const CONSULTA_CONCURRENCY = 5;

function headers(session: string): Record<string, string> {
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "GET",
    "X-IdentifierCase": "upper",
  };
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

export function parseFuncionariosLista(payload: unknown): ListaRow[] {
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

export function parseFuncionarioFlags(payload: unknown): ErpSellerFlags {
  const { o, gerador } = consultaRecord(payload);
  return {
    desativado: asBool(gerador?.DESATIVADO),
    inativo: asBool(o.INATIVO),
    afastado: asBool(o.AFASTADO),
    naoMostrarNoEvento: asBool(o.NAO_MOSTRAR_NO_EVENTO),
  };
}

export function parseFuncionarioGerador(payload: unknown): number | null {
  const id = asNum(consultaRecord(payload).gerador?.GERADOR);
  return id != null && id > 0 ? id : null;
}

export function isSellerActive(f: ErpSellerFlags): boolean {
  return !(f.desativado || f.inativo || f.afastado || f.naoMostrarNoEvento);
}

async function post(base: string, path: string, session: string, body: unknown, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${base}/${path}`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 240)}`);
  try {
    return text ? (JSON.parse(text) as unknown) : [];
  } catch {
    throw new Error(`${path} JSON inválido: ${text.slice(0, 200)}`);
  }
}

/** E da equipe de vendas: ativa com cargo VENDEDOR ou inativa de qualquer cargo. */
export function isStoreSeller(role: string, active: boolean): boolean {
  return !active || role === SELLER_ROLE;
}

/**
 * Lista + Consulta de cada funcionaria. Quem ja tem gerador salvo e o mesmo cargo de antes (`known`)
 * entra so pela Lista; cargo mudou (ex.: desativada  ->  INDEFINIDO, virou gerencia)  ->  consulta de novo.
 * Qualquer Consulta falhando derruba a loja (dados anteriores ficam).
 */
export async function fetchStoreSellers(params: {
  session: string;
  millenniumStoreId: number;
  /** Consultas em paralelo (default 5; carga inicial usa 1). */
  concurrency?: number;
  /** Cadastradas com gerador  ->  cargo salvo (null = sem cargo salvo, consulta). */
  known?: ReadonlyMap<number, string | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<ErpSeller[]> {
  const base = (params.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = params.fetchImpl ?? fetch;
  const lista = parseFuncionariosLista(
    await post(
      base,
      "millenium.FUNCIONARIOS.Lista?$top=500",
      params.session,
      {
        ORDEM: 1,
        CAMPO: 1,
        FILTRO: 2,
        VALOR_FILTRO: null,
        VALOR_1: null,
        VALOR_2: null,
        FILIAL: params.millenniumStoreId,
        CARGO: null,
        RESPONSAVEL: null,
      },
      fetchImpl,
    ),
  );

  const out: (ErpSeller | null)[] = new Array(lista.length).fill(null);
  const toConsult: number[] = [];
  lista.forEach((row, i) => {
    const savedRole = params.known?.get(row.employeeId);
    if (savedRole != null && savedRole === row.role) out[i] = { ...row, active: null, flags: null, geradorId: null };
    else toConsult.push(i);
  });
  let next = 0;
  const worker = async () => {
    while (next < toConsult.length) {
      const i = toConsult[next++]!;
      const row = lista[i]!;
      const consulta = await post(
        base,
        "millenium.FUNCIONARIOS.Consulta",
        params.session,
        { FUNCIONARIO: row.employeeId },
        fetchImpl,
      );
      const flags = parseFuncionarioFlags(consulta);
      out[i] = { ...row, flags, active: isSellerActive(flags), geradorId: parseFuncionarioGerador(consulta) };
    }
  };
  const limit = Math.max(1, params.concurrency ?? CONSULTA_CONCURRENCY);
  await Promise.all(Array.from({ length: Math.min(limit, toConsult.length) }, worker));
  return out.filter((s): s is ErpSeller => s != null);
}
