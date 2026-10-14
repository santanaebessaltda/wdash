import type { SupabaseClient } from "@supabase/supabase-js";
import { groupComUnit } from "../../../src/data/wedash/groupCom.ts";
import { ALREADY_LAUNCHED, forceLaunchAllowed, shoppingNightDue, shoppingSendsSales, sumSoldByDay, type LaunchValue } from "../../../src/data/wedash/shoppingReport.ts";
import { allosBrowserCookies, chromePath } from "./allosBrowser.ts";
import { postAllosWeeks, readAllosWeeks } from "./allosFill.ts";
import { decryptPassword } from "./decrypt.ts";
import { postGroupCom, readGroupCom } from "./groupComFill.ts";
import { addDaysIso, CLOSE_WINDOW_HOURS, closeHour, dailyCloseEnabled, hourInTz, isCloseWindow, ymdInTz } from "./runSyncJob.ts";

const KEEP = "Não foi possível informar as vendas ao shopping. Os valores já informados foram mantidos.";
const LOGIN_FAIL = "Não foi possível acessar a Intranet Mall porque o painel solicitou uma verificação no navegador. Nada foi alterado.";

let tail: Promise<unknown> = Promise.resolve();

function todayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function remember(sb: SupabaseClient, tenantId: string, storeId: string, days: LaunchValue[]): Promise<void> {
  const rows = days.filter((day) => day.cents != null).map((day) => ({
    tenant_id: tenantId,
    store_id: storeId,
    day: day.date,
    launched_cents: day.cents,
  }));
  if (rows.length === 0) return;
  const { error } = await sb.from("shopping_day").upsert(rows, { onConflict: "store_id,day" });
  if (error) throw new Error(error.message);
}

/** Uma Allos por vez, para não abrir dois navegadores em cima do sync. */
export function runShoppingStore(
  sb: SupabaseClient,
  erpSecret: string,
  storeId: string,
  read: boolean,
  month?: { from: string; to: string; days?: string[] },
): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
  const run = tail.then(() => runShoppingNow(sb, erpSecret, storeId, read, month), () => runShoppingNow(sb, erpSecret, storeId, read, month));
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function monthAround(today: string): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}${String(last).padStart(2, "0")}` };
}

function chosenDays(days: string[] | undefined): string[] {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return [...new Set((days ?? []).filter((day) => iso.test(day)))].sort();
}

function chosenMonth(today: string, month?: { from: string; to: string }): { from: string; to: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (month && iso.test(month.from) && iso.test(month.to) && month.from <= month.to) return month;
  return monthAround(today);
}

async function runShoppingNow(
  sb: SupabaseClient,
  erpSecret: string,
  storeId: string,
  read: boolean,
  month?: { from: string; to: string; days?: string[] },
): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
  const { data: store } = await sb.from("store").select("id, tenant_id, point_type, timezone").eq("id", storeId).maybeSingle();
  if (!store) return { ok: false, message: KEEP };
  const { data: account } = await sb
    .from("store_shopping")
    .select("administrator, base_url, username, secret_ciphertext, unit")
    .eq("store_id", storeId)
    .maybeSingle();
  const administrator = account?.administrator === "allos" || account?.administrator === "argo" || account?.administrator === "groupcom" ? account.administrator : null;
  const gate = forceLaunchAllowed({ kiosk: store.point_type === "MALL", administrator });
  if (!gate.ok) return gate;

  const today = todayIn((store.timezone as string | null) || "America/Campo_Grande");
  const span = chosenMonth(today, month);
  const selected = chosenDays(month?.days);
  let only: ReadonlySet<string> | undefined;
  if (!read && selected.length > 0) {
    const pending = selected.filter((day) => day >= span.from && day <= span.to && day < today);
    if (pending.length === 0) return { ok: true, message: ALREADY_LAUNCHED };
    only = new Set(pending);
  }
  let message = read ? "Não foi possível ler os valores informados no shopping. Nada foi alterado." : KEEP;
  try {
    const password = await decryptPassword(String(account?.secret_ciphertext ?? ""), erpSecret);
    const baseUrl = String(account?.base_url ?? "");
    const username = String(account?.username ?? "");
    const sold = async (from: string, to: string) => {
      const { data, error } = await sb
        .from("sales_day_agg")
        .select("day, brand, revenue_cents")
        .eq("tenant_id", store.tenant_id)
        .eq("store_id", storeId)
        .gte("day", from)
        .lte("day", to);
      if (error) throw new Error(error.message);
      return sumSoldByDay(
        (data ?? []).map((row) => ({
          day: String(row.day),
          brand: typeof row.brand === "string" ? row.brand : null,
          revenueCents: Number(row.revenue_cents) || 0,
        })),
      );
    };
    if (administrator === "groupcom") {
      const unit = groupComUnit(account?.unit);
      if (!unit) {
        message = "A unidade do Group COM não está salva. Nada foi alterado.";
      } else {
        const posted = read
          ? await readGroupCom(baseUrl, username, password, unit, today, span.from, span.to)
          : await postGroupCom(baseUrl, username, password, unit, today, span.from, span.to, sold, only);
        if (posted.ok) {
          await remember(sb, store.tenant_id as string, storeId, posted.days);
          await sb.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: "" }).eq("store_id", storeId);
          return { ok: true };
        }
        message = posted.message;
      }
    } else {
      const session = await allosBrowserCookies({ baseUrl, username, password, executablePath: chromePath() });
      if (!session.ok) {
        message = LOGIN_FAIL;
      } else {
        const posted = read
          ? await readAllosWeeks(baseUrl, session.cookie, session.userAgent, today)
          : await postAllosWeeks(baseUrl, session.cookie, session.userAgent, today, sold, only);
        if (posted.ok) {
          await remember(sb, store.tenant_id as string, storeId, posted.days);
          await sb.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: "" }).eq("store_id", storeId);
          return { ok: true };
        }
        message = posted.message;
      }
    }
  } catch (error) {
    console.warn(`Allos: ${error instanceof Error ? error.message : "falha"}`);
    message = read ? "Não foi possível ler os valores informados no shopping. Nada foi alterado." : KEEP;
  }
  await sb.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: message }).eq("store_id", storeId);
  return { ok: false, message };
}

/**
 * Uma vez por filial, na janela do fechamento, depois que o dia anterior fechou.
 * Sem dias marcados: preenche só o passado vazio, inclusive janelas anteriores.
 */
export async function runDueShoppingLaunches(sb: SupabaseClient, erpSecret: string, now = new Date()): Promise<number> {
  if (!dailyCloseEnabled()) return 0;
  const { data: accounts, error } = await sb
    .from("store_shopping")
    .select("store_id, administrator, last_run_at")
    .in("administrator", ["allos", "groupcom"]);
  if (error) throw error;
  const rows = (accounts ?? []).filter((row) => shoppingSendsSales(row.administrator as string));
  if (rows.length === 0) return 0;
  const { data: stores, error: storeError } = await sb
    .from("store")
    .select("id, code, timezone, last_closed_day, point_type, active")
    .in("id", rows.map((row) => row.store_id as string));
  if (storeError) throw storeError;
  const byId = new Map((stores ?? []).map((store) => [store.id as string, store]));
  const startHour = closeHour();
  let ran = 0;
  for (const account of rows) {
    const store = byId.get(account.store_id as string);
    if (!store || store.active === false || store.point_type !== "MALL") continue;
    const timeZone = (store.timezone as string | null) || "America/Campo_Grande";
    const today = ymdInTz(now, timeZone);
    const yesterday = addDaysIso(today, -1);
    const lastClosed = store.last_closed_day ? String(store.last_closed_day).slice(0, 10) : null;
    const lastRun = account.last_run_at ? new Date(String(account.last_run_at)) : null;
    const lastRunOk = lastRun != null && !Number.isNaN(lastRun.getTime());
    const due = shoppingNightDue({
      sendsSales: true,
      yesterdayClosed: lastClosed != null && lastClosed >= yesterday,
      inCloseWindow: isCloseWindow(hourInTz(now, timeZone), startHour),
      lastRunDay: lastRunOk ? ymdInTz(lastRun, timeZone) : null,
      lastRunHour: lastRunOk ? hourInTz(lastRun, timeZone) : null,
      today,
      windowStartHour: startHour,
      windowHours: CLOSE_WINDOW_HOURS,
    });
    if (!due) continue;
    ran += 1;
    const result = await runShoppingStore(sb, erpSecret, account.store_id as string, false);
    if (!result.ok) console.warn(`Informe de vendas [${String(store.code ?? account.store_id)}]: ${result.message}`);
  }
  if (ran > 0) console.log(`Informe de vendas: ${ran} filial(is) na madrugada`);
  return ran;
}
