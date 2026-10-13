import type { SupabaseClient } from "@supabase/supabase-js";
import { ALREADY_LAUNCHED, forceLaunchAllowed, sumSoldByDay, unlaunchedDays, type LaunchValue } from "../../../src/data/wedash/shoppingReport.ts";
import { allosBrowserCookies, chromePath } from "./allosBrowser.ts";
import { postAllosWeeks, readAllosWeeks } from "./allosFill.ts";
import { decryptPassword } from "./decrypt.ts";

const KEEP = "Não foi possível lançar no shopping. Os valores já informados foram mantidos.";
const LOGIN_FAIL = "A Allos não deixou a WDash entrar. O painel exige uma verificação que só acontece no navegador. Nada foi alterado no shopping.";

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
  month?: { from: string; to: string },
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
  month?: { from: string; to: string },
): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
  const { data: store } = await sb.from("store").select("id, tenant_id, point_type, timezone").eq("id", storeId).maybeSingle();
  if (!store) return { ok: false, message: KEEP };
  const { data: account } = await sb
    .from("store_shopping")
    .select("administrator, base_url, username, secret_ciphertext")
    .eq("store_id", storeId)
    .maybeSingle();
  const administrator = account?.administrator === "allos" || account?.administrator === "argo" ? account.administrator : null;
  const gate = forceLaunchAllowed({ kiosk: store.point_type === "MALL", administrator });
  if (!gate.ok) return gate;

  const today = todayIn((store.timezone as string | null) || "America/Campo_Grande");
  const span = chosenMonth(today, month);
  if (!read) {
    const { data: stored, error: storedError } = await sb.from("shopping_day").select("day").eq("store_id", storeId).gte("day", span.from).lte("day", span.to);
    if (storedError) return { ok: false, message: KEEP };
    const launched = new Set((stored ?? []).map((row) => String(row.day).slice(0, 10)));
    if (unlaunchedDays(span.from, span.to, today, launched).length === 0) return { ok: true, message: ALREADY_LAUNCHED };
  }
  let message = read ? "Não foi possível ler o que já está no shopping. Nada foi alterado." : KEEP;
  try {
    const password = await decryptPassword(String(account?.secret_ciphertext ?? ""), erpSecret);
    const baseUrl = String(account?.base_url ?? "");
    const username = String(account?.username ?? "");
    const session = await allosBrowserCookies({ baseUrl, username, password, executablePath: chromePath() });
    if (!session.ok) {
      message = LOGIN_FAIL;
    } else {
      const posted = read
        ? await readAllosWeeks(baseUrl, session.cookie, session.userAgent, today)
        : await postAllosWeeks(baseUrl, session.cookie, session.userAgent, today, async (from, to) => {
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
          });
      if (posted.ok) {
        await remember(sb, store.tenant_id as string, storeId, posted.days);
        await sb.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: "" }).eq("store_id", storeId);
        return { ok: true };
      }
      message = posted.message;
    }
  } catch (error) {
    console.warn(`Allos: ${error instanceof Error ? error.message : "falha"}`);
    message = read ? "Não foi possível ler o que já está no shopping. Nada foi alterado." : KEEP;
  }
  await sb.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: message }).eq("store_id", storeId);
  return { ok: false, message };
}
