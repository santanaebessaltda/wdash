import {
  GROUP_COM_API,
  encryptGroupComField,
  fillGroupComPeriod,
  groupComAcceptsLaunch,
  groupComBillingObject,
  groupComDay,
  groupComSlug,
  type GroupComMovement,
  type GroupComUnit,
} from "../../../src/data/wedash/groupCom.ts";
import type { LaunchValue } from "../../../src/data/wedash/shoppingReport.ts";

const KEEP = "Não foi possível informar as vendas ao shopping. Os valores já informados foram mantidos.";
const MISSING = "O Group COM não recebeu os dias marcados. Os valores já informados foram mantidos.";
const READ_FAIL = "Não foi possível ler os valores informados no shopping. Nada foi alterado.";
const LOGIN_FAIL = "Não foi possível acessar o Group COM. Nada foi alterado.";
const CHECK_FAIL = "O Group COM pediu uma verificação extra. Nada foi alterado.";

type Result = { ok: true; days: LaunchValue[] } | { ok: false; message: string };
type SoldLookup = (from: string, to: string) => Promise<Record<string, number>>;

type Period = { idGIMCompetencia: number; dataInicio: number; dataFim: number; dataLimite: number };

/** Lê os dias já informados. Não envia venda. */
export function readGroupCom(baseUrl: string, email: string, password: string, unit: GroupComUnit, today: string, from: string, to: string): Promise<Result> {
  return syncGroupCom(baseUrl, email, password, unit, today, from, to, async () => ({}), true);
}

/** Preenche os dias passados vazios das competências que ainda aceitam lançamento. */
export function postGroupCom(
  baseUrl: string,
  email: string,
  password: string,
  unit: GroupComUnit,
  today: string,
  from: string,
  to: string,
  sold: SoldLookup,
  only?: ReadonlySet<string>,
): Promise<Result> {
  return syncGroupCom(baseUrl, email, password, unit, today, from, to, sold, false, only);
}

async function syncGroupCom(
  baseUrl: string,
  email: string,
  password: string,
  unit: GroupComUnit,
  today: string,
  from: string,
  to: string,
  sold: SoldLookup,
  read: boolean,
  only?: ReadonlySet<string>,
): Promise<Result> {
  const fail = read ? READ_FAIL : KEEP;
  const portal = groupComSlug(baseUrl);
  if (!portal) return { ok: false, message: LOGIN_FAIL };
  const origin = `https://${portal}.com21.com.br`;
  const session = await openSession(origin, email, password, unit);
  if (!session.ok) return { ok: false, message: session.challenge ? CHECK_FAIL : LOGIN_FAIL };
  const periods = await loadPeriods(session.headers, unit, today, read, read || only != null ? { from, to } : null);
  if (!periods) return { ok: false, message: fail };
  const remembered = new Map<string, number>();
  for (const period of periods) {
    const objectId = await billingObject(session.headers, unit, period.idGIMCompetencia);
    if (!objectId) return { ok: false, message: fail };
    const current = await movements(session.headers, unit, period.idGIMCompetencia, objectId);
    if (!current) return { ok: false, message: fail };
    const writable = !read && groupComAcceptsLaunch(period.dataLimite, today, unit.timeZone);
    if (!writable) {
      keepInformed(current, today, unit.timeZone, remembered);
      continue;
    }
    const start = groupComDay(period.dataInicio, unit.timeZone);
    const end = groupComDay(period.dataFim, unit.timeZone);
    const filled = fillGroupComPeriod(current, await sold(start, end), today, unit.timeZone, only, {
      startEpoch: period.dataInicio,
      endEpoch: period.dataFim,
    });
    keepInformed(filled.movimentos, today, unit.timeZone, remembered);
    if (!filled.changed) continue;
    const saved = await saveMovements(session.headers, unit, period.idGIMCompetencia, objectId, filled.movimentos);
    const echoed = saved ? await movements(session.headers, unit, period.idGIMCompetencia, objectId) : null;
    if (!echoed || !sameMovements(filled.movimentos, echoed)) return { ok: false, message: KEEP };
  }
  if (!read && only && [...only].some((day) => !remembered.has(day))) return { ok: false, message: MISSING };
  return { ok: true, days: [...remembered.entries()].map(([date, cents]) => ({ date, cents })) };
}

function keepInformed(rows: GroupComMovement[], today: string, timeZone: string, remembered: Map<string, number>) {
  for (const row of rows) {
    if (row.valorVenda == null || !Number.isFinite(row.valorVenda)) continue;
    const date = groupComDay(row.dataMovimento, timeZone);
    if (date < today) remembered.set(date, Math.round(row.valorVenda * 100));
  }
}

function sameMovements(sent: GroupComMovement[], echoed: GroupComMovement[]): boolean {
  const byEpoch = new Map(echoed.map((row) => [row.dataMovimento, row.valorVenda == null ? null : Math.round(row.valorVenda * 100)]));
  return sent.every((row) => {
    const left = row.valorVenda == null ? null : Math.round(row.valorVenda * 100);
    if (left == null) return true;
    return byEpoch.get(row.dataMovimento) === left;
  });
}

async function openSession(
  origin: string,
  email: string,
  password: string,
  unit: GroupComUnit,
): Promise<{ ok: true; headers: Headers } | { ok: false; challenge: boolean }> {
  const host = new URL(origin).host;
  const domain = await ask(publicHeaders(origin), `${GROUP_COM_API}/web/api/dominios/${host}`);
  const client = domain.ok && domain.body && typeof domain.body === "object" ? domain.body as Record<string, unknown> : null;
  if (!client || String(client.guidClienteGroup ?? "") !== unit.clientCode || Number(client.idClienteGroup) !== unit.clientId) {
    return { ok: false, challenge: false };
  }
  const loginHeaders = publicHeaders(origin);
  loginHeaders.set("ClientCode", unit.clientCode);
  const login = await ask(loginHeaders, `${GROUP_COM_API}/web/api/login/v2`, {
    method: "POST",
    body: JSON.stringify({
      login: await encryptGroupComField(email),
      senha: await encryptGroupComField(password),
      identificador: 0,
    }),
  });
  const session = login.ok && login.body && typeof login.body === "object" ? login.body as Record<string, unknown> : null;
  if (!session) return { ok: false, challenge: Boolean(login.body && typeof login.body === "object" && (login.body as { requer2fa?: boolean }).requer2fa) };
  const token = typeof session.token === "string" ? session.token : "";
  const userId = typeof session.id === "number" ? String(session.id) : "";
  if (!token || !userId) return { ok: false, challenge: false };
  return { ok: true, headers: sessionHeaders(origin, unit, token, userId) };
}

async function loadPeriods(
  headers: Headers,
  unit: GroupComUnit,
  today: string,
  read: boolean,
  span: { from: string; to: string } | null,
): Promise<Period[] | null> {
  const open = await ask(headers, periodUrl(unit, true));
  const closed = read ? await ask(headers, periodUrl(unit, false)) : { ok: true, body: [] as unknown[] };
  if (!open.ok || !Array.isArray(open.body)) return null;
  const closedRows = closed.ok && Array.isArray(closed.body) ? closed.body : [];
  const seen = new Set<number>();
  const periods: Period[] = [];
  for (const row of [...open.body, ...closedRows]) {
    if (!row || typeof row !== "object") continue;
    const period = row as Period;
    if (!Number.isInteger(period.idGIMCompetencia) || seen.has(period.idGIMCompetencia)) continue;
    const start = groupComDay(period.dataInicio, unit.timeZone);
    const end = groupComDay(period.dataFim, unit.timeZone);
    if (span && (end < span.from || start > span.to)) continue;
    if (!read && !groupComAcceptsLaunch(period.dataLimite, today, unit.timeZone)) continue;
    if (start > today) continue;
    seen.add(period.idGIMCompetencia);
    periods.push(period);
  }
  return periods;
}

async function billingObject(headers: Headers, unit: GroupComUnit, periodId: number): Promise<number | null> {
  const listed = await ask(headers, `${GROUP_COM_API}/web/api/rest/clientes/${unit.clientId}/empresas/${unit.companyId}/contratos/${unit.contractId}/objetosFaturamento?idCompetencia=${periodId}`);
  if (!listed.ok || !Array.isArray(listed.body)) return null;
  return groupComBillingObject(listed.body as Array<{ idObjetoFaturamento: number; nome?: string; objetoAtivo?: number }>);
}

async function movements(headers: Headers, unit: GroupComUnit, periodId: number, objectId: number): Promise<GroupComMovement[] | null> {
  const listed = await ask(headers, movementUrl(unit, periodId, objectId, false));
  if (!listed.ok || !Array.isArray(listed.body)) return null;
  return listed.body.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as GroupComMovement;
    if (!Number.isFinite(item.dataMovimento)) return [];
    return [{
      dataMovimento: item.dataMovimento,
      valorVenda: item.valorVenda == null ? null : Number(item.valorVenda),
      valorDevolucao: item.valorDevolucao == null ? null : Number(item.valorDevolucao),
      quantidadeVendas: item.quantidadeVendas == null ? null : Number(item.quantidadeVendas),
    }];
  });
}

async function saveMovements(headers: Headers, unit: GroupComUnit, periodId: number, objectId: number, rows: GroupComMovement[]): Promise<boolean> {
  const saved = await ask(headers, movementUrl(unit, periodId, objectId, true), {
    method: "POST",
    body: JSON.stringify({
      movimentos: rows.map((row) => ({
        dataMovimento: row.dataMovimento,
        valorVenda: row.valorVenda,
        valorDevolucao: row.valorDevolucao,
        quantidadeVendas: row.quantidadeVendas,
      })),
    }),
  });
  return saved.ok;
}

function periodUrl(unit: GroupComUnit, open: boolean): string {
  return `${GROUP_COM_API}/web/api/rest/clientes/${unit.clientId}/empresas/${unit.companyId}/gim/competencias?statusAberto=${open ? "true" : "false"}`;
}

function movementUrl(unit: GroupComUnit, periodId: number, objectId: number, write: boolean): string {
  const root = write ? `${GROUP_COM_API}/web/api/v1/rest` : `${GROUP_COM_API}/web/api/rest`;
  return `${root}/clientes/${unit.clientId}/empresas/${unit.companyId}/gim/competencias/${periodId}/contratos/${unit.contractId}/objetosFaturamento/${objectId}/movimentos`;
}

function publicHeaders(origin: string): Headers {
  return new Headers({
    IdentificadorAplicacao: "0",
    ProdutoTipo: "4",
    Locale: "pt-br",
    Referer: `${origin}/`,
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/json;charset=UTF-8",
  });
}

function sessionHeaders(origin: string, unit: GroupComUnit, token: string, userId: string): Headers {
  const headers = publicHeaders(origin);
  headers.set("ClientCode", unit.clientCode);
  headers.set("Authorization", token);
  headers.set("Username", userId);
  headers.set("Role", "Lojista");
  headers.set("IdPapel", String(unit.roleId));
  headers.set("IdEmpresa", String(unit.companyId));
  return headers;
}

async function ask(headers: Headers, url: string, init?: { method?: string; body?: string }): Promise<{ ok: boolean; body: unknown }> {
  const request = new Headers(headers);
  if (url.includes("/dominios/")) request.delete("Content-Type");
  try {
    const response = await fetch(url, { method: init?.method ?? "GET", headers: request, body: init?.body });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}
