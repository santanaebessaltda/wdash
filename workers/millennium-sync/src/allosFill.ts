import {
  fillAllosWeek,
  informedStoredValues,
  informedWeekIds,
  parseAllosForm,
  type LaunchValue,
} from "../../../src/data/wedash/shoppingReport.ts";
import { seedCookieJar } from "./allosAuth.ts";

const KEEP = "Não foi possível lançar no shopping. Os valores já informados foram mantidos.";
const READ_FAIL = "Não foi possível ler o que já está no shopping. Nada foi alterado.";
const LOGIN_FAIL = "A Allos não deixou a WDash entrar. O painel exige uma verificação que só acontece no navegador. Nada foi alterado no shopping.";

export type AllosResult = { ok: true; days: LaunchValue[] } | { ok: false; message: string };

type SoldLookup = (from: string, to: string) => Promise<Record<string, number>>;

function challenge(html: string): boolean {
  const text = html.toLowerCase();
  return text.includes("cf-challenge") || text.includes("just a moment") || text.includes("cf_chl");
}

function sameDays(sent: LaunchValue[], echoed: Array<{ date: string; fieldCents: number | null }>): boolean {
  return sent.length === echoed.length && sent.every((day, index) => day.date === echoed[index]?.date && day.cents === echoed[index]?.fieldCents);
}

async function browse(jar: Map<string, string>, url: string, userAgent: string, init?: RequestInit, hops = 0): Promise<string | null> {
  if (hops > 4) return null;
  const headers = new Headers(init?.headers);
  const cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  headers.set("user-agent", userAgent);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  const setCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const lines = setCookie.length > 0 ? setCookie : res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : [];
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    const cut = pair.indexOf("=");
    if (cut > 0) jar.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim());
  }
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location");
    if (!next) return null;
    return browse(jar, new URL(next, url).toString(), userAgent, undefined, hops + 1);
  }
  if (!res.ok) return null;
  return res.text();
}

async function weekIds(jar: Map<string, string>, base: string, userAgent: string, fail: string): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const list = await browse(jar, `${base}/loja/vendas-s4/vendas.asp`, userAgent);
  if (!list || challenge(list)) return { ok: false, message: fail };
  if (/type="password"/i.test(list)) return { ok: false, message: LOGIN_FAIL };
  const ids = informedWeekIds(list);
  if (ids.length === 0) return { ok: false, message: fail };
  return { ok: true, ids };
}

/** Lê a linha Informada com a sessão que o navegador acabou de abrir. Não envia venda. */
export async function readAllosWeeks(baseUrl: string, cookie: string, userAgent: string, today: string): Promise<AllosResult> {
  const base = baseUrl.replace(/\/$/, "");
  const jar = seedCookieJar(cookie);
  const opened = await weekIds(jar, base, userAgent, READ_FAIL);
  if (!opened.ok) return opened;
  const accepted: LaunchValue[] = [];
  for (const weekId of opened.ids) {
    const formHtml = await browse(jar, `${base}/loja/vendas-s4/vendas_alterar.asp?IDSEMANA=${weekId}`, userAgent);
    const parsed = formHtml ? parseAllosForm(formHtml) : null;
    if (!formHtml || !parsed || parsed.weekId !== weekId) return { ok: false, message: READ_FAIL };
    accepted.push(...informedStoredValues(parsed.fields, today));
  }
  await browse(jar, `${base}/logout.asp`, userAgent);
  return { ok: true, days: accepted };
}

/** Preenche os dias passados vazios e só grava o que a Allos devolveu igual. */
export async function postAllosWeeks(
  baseUrl: string,
  cookie: string,
  userAgent: string,
  today: string,
  sold: SoldLookup,
  only?: ReadonlySet<string>,
): Promise<AllosResult> {
  const base = baseUrl.replace(/\/$/, "");
  const jar = seedCookieJar(cookie);
  const opened = await weekIds(jar, base, userAgent, KEEP);
  if (!opened.ok) return opened;
  const accepted: LaunchValue[] = [];
  for (const weekId of opened.ids) {
    const formHtml = await browse(jar, `${base}/loja/vendas-s4/vendas_alterar.asp?IDSEMANA=${weekId}`, userAgent);
    const parsed = formHtml ? parseAllosForm(formHtml) : null;
    if (!formHtml || !parsed || parsed.weekId !== weekId) return { ok: false, message: KEEP };
    if (only && !parsed.fields.some((field) => only.has(field.date))) continue;
    const from = parsed.fields[0]?.date ?? today;
    const to = parsed.fields[parsed.fields.length - 1]?.date ?? today;
    const filled = fillAllosWeek(parsed, await sold(from, to), today, only);
    const saved = await browse(jar, `${base}/loja/vendas-s4/vendas_atualizar.asp`, userAgent, {
      method: "POST",
      body: filled.body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!saved || challenge(saved)) return { ok: false, message: KEEP };
    const echoed = parseAllosForm((await browse(jar, `${base}/loja/vendas-s4/vendas_alterar.asp?IDSEMANA=${weekId}`, userAgent)) ?? "");
    if (!echoed || !sameDays(filled.days, echoed.fields)) return { ok: false, message: KEEP };
    accepted.push(...filled.days);
  }
  await browse(jar, `${base}/logout.asp`, userAgent);
  return { ok: true, days: accepted };
}
