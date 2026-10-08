/**
 * Diag CMV filial 010 vs RELATORIOMARGEM (range / day-by-day / formatos DATAF).
 *   cd workers/millennium-sync && npx tsx scripts/diag-cmv-010.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { milleniumDataRange } from "../src/millenniumSales.ts";
import {
  fetchRelatorioMargem,
  cmvCentsFromMargemLines,
  parseRelatorioMargemPayload,
  RELATORIO_MARGEM_PATH,
} from "../src/millenniumMargem.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  for (const path of [resolve(__dirname, "../.env"), resolve(__dirname, "../../../.env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    }
  }
}

async function rawCall(
  session: string,
  label: string,
  body: Record<string, unknown>,
) {
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/${RELATORIO_MARGEM_PATH}`, {
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
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    console.log(label, "bad json", text.slice(0, 200));
    return;
  }
  const lines = parseRelatorioMargemPayload(parsed);
  const cmv = cmvCentsFromMargemLines(lines) / 100;
  const fat = lines.reduce((s, l) => s + l.totalVenda, 0);
  const noCod = lines.filter((l) => !l.codProduto);
  console.log(
    `${label}: status=${res.status} lines=${lines.length} CMV=${cmv.toFixed(2)} TOTALVENDA=${fat.toFixed(2)} noCod=${noCod.length}`,
  );
  if (noCod.length) console.log("  noCod sample", noCod.slice(0, 2));
}

async function main() {
  loadDotEnv();
  const secret = process.env.ERP_SECRET_KEY!;
  const sb = createAdminClient();
  const deps = buildDeps(sb, secret);

  const { data: stores } = await sb
    .from("store")
    .select("id, code, millennium_store_id, trade_name, tenant_id")
    .or("code.ilike.%010%,code.eq.10,code.eq.010");
  console.log("stores:", JSON.stringify(stores, null, 2));

  const store =
    (stores ?? []).find((s) => String(s.code).replace(/^0+/, "") === "10") ??
    (stores ?? [])[0];
  if (!store) throw new Error("store 010 not found");

  const { data: days } = await sb
    .from("sales_day_agg")
    .select("day, brand, cmv_cents, revenue_cents")
    .eq("store_id", store.id)
    .gte("day", "2026-09-01")
    .lte("day", "2026-09-22")
    .order("day");

  const byBrand: Record<string, number> = {};
  for (const d of days ?? []) {
    byBrand[d.brand] = (byBrand[d.brand] ?? 0) + Number(d.cmv_cents || 0);
  }
  const allDays = (days ?? []).filter((d) => d.brand === "ALL");
  const sumAll = allDays.reduce((s, d) => s + Number(d.cmv_cents || 0), 0);
  const sumRev = allDays.reduce((s, d) => s + Number(d.revenue_cents || 0), 0);
  console.log("DB CMV by brand (cents):", byBrand);
  console.log(
    `DB ALL CMV=${(sumAll / 100).toFixed(2)} fat=${(sumRev / 100).toFixed(2)} days=${allDays.length}`,
  );

  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, tenant_id")
    .eq("tenant_id", store.tenant_id)
    .eq("status", "VALID")
    .maybeSingle();
  if (!cred) throw new Error("no cred");

  let session =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;
  if (!session) {
    const full = await deps.loadCredential(cred.id as string);
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) throw new Error(login.reason);
    session = login.session;
  }

  const mid = Number(store.millennium_store_id);
  console.log(`FILIAL millennium=${mid} code=${store.code}`);

  const linesRange = await fetchRelatorioMargem({
    session,
    millenniumStoreId: mid,
    from: "2026-09-01",
    to: "2026-09-22",
  });
  console.log(
    `A fetchRelatorioMargem 01→22: lines=${linesRange.length} CMV=${(cmvCentsFromMargemLines(linesRange) / 100).toFixed(2)}`,
  );

  const { datai, dataf } = milleniumDataRange("2026-09-01", "2026-09-22");
  await rawCall(session, "B exclusive DATAF (Lista-style)", {
    FILIAL: mid,
    DESC: null,
    DATAI: datai,
    DATAF: dataf,
    TIPO: null,
  });
  await rawCall(session, "C DATAF=day22 midnight (inclusive trap?)", {
    FILIAL: mid,
    DESC: null,
    DATAI: "2026-09-01T04:00:00.000Z",
    DATAF: "2026-09-22T04:00:00.000Z",
    TIPO: null,
  });
  await rawCall(session, "D date-only strings 01..22", {
    FILIAL: mid,
    DESC: null,
    DATAI: "2026-09-01",
    DATAF: "2026-09-22",
    TIPO: null,
  });

  let sumDay = 0;
  const perDay: Array<{ day: string; cmv: number }> = [];
  for (let i = 1; i <= 22; i++) {
    const day = `2026-09-${String(i).padStart(2, "0")}`;
    const lines = await fetchRelatorioMargem({
      session,
      millenniumStoreId: mid,
      from: day,
      to: day,
    });
    const cmv = cmvCentsFromMargemLines(lines);
    sumDay += cmv;
    perDay.push({ day, cmv: cmv / 100 });
  }
  console.log(`E day-by-day sum CMV=${(sumDay / 100).toFixed(2)}`);
  console.log("E per-day:", perDay.map((p) => `${p.day.slice(8)}=${p.cmv.toFixed(0)}`).join(" "));

  // Overlap check: day01 + day02 vs range 01-02
  const d1 = await fetchRelatorioMargem({
    session,
    millenniumStoreId: mid,
    from: "2026-09-01",
    to: "2026-09-01",
  });
  const d2 = await fetchRelatorioMargem({
    session,
    millenniumStoreId: mid,
    from: "2026-09-02",
    to: "2026-09-02",
  });
  const r12 = await fetchRelatorioMargem({
    session,
    millenniumStoreId: mid,
    from: "2026-09-01",
    to: "2026-09-02",
  });
  const c1 = cmvCentsFromMargemLines(d1) / 100;
  const c2 = cmvCentsFromMargemLines(d2) / 100;
  const c12 = cmvCentsFromMargemLines(r12) / 100;
  console.log(
    `F overlap: day01=${c1.toFixed(2)} day02=${c2.toFixed(2)} sum=${(c1 + c2).toFixed(2)} range01-02=${c12.toFixed(2)} ratio=${((c1 + c2) / c12).toFixed(3)}`,
  );
  console.log("F sample keys day01:", Object.keys(d1[0] ?? {}).join(","));

  // Try inclusive calendar DATAF = same day (no +1) for single day
  await rawCall(session, "G day01 DATAF=same calendar (no +1)", {
    FILIAL: mid,
    DESC: null,
    DATAI: "2026-09-01T04:00:00.000Z",
    DATAF: "2026-09-01T04:00:00.000Z",
    TIPO: null,
  });
  await rawCall(session, "H day01 DATAF=end of day local", {
    FILIAL: mid,
    DESC: null,
    DATAI: "2026-09-01T04:00:00.000Z",
    DATAF: "2026-09-02T03:59:59.999Z",
    TIPO: null,
  });

  // UI-style date-only inclusive (single day + sum days)
  await rawCall(session, "I day01 date-only inclusive", {
    FILIAL: mid,
    DESC: null,
    DATAI: "2026-09-01",
    DATAF: "2026-09-01",
    TIPO: null,
  });
  let sumDateOnly = 0;
  let sumFatDateOnly = 0;
  for (let i = 1; i <= 22; i++) {
    const day = `2026-09-${String(i).padStart(2, "0")}`;
    const base = millenniumBaseUrl().replace(/\/$/, "");
    const res = await fetch(`${base}/${RELATORIO_MARGEM_PATH}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({ FILIAL: mid, DESC: null, DATAI: day, DATAF: day, TIPO: null }),
      signal: AbortSignal.timeout(180_000),
    });
    const lines = parseRelatorioMargemPayload(JSON.parse(await res.text()));
    sumDateOnly += cmvCentsFromMargemLines(lines);
    sumFatDateOnly += lines.reduce((s, l) => s + l.totalVenda, 0);
  }
  console.log(
    `J date-only day-by-day CMV=${(sumDateOnly / 100).toFixed(2)} TOTALVENDA=${sumFatDateOnly.toFixed(2)} (target CMV=120174.82 fat=285751.23)`,
  );

  // Same but DATAF = next calendar day as date-only (Lista exclusive as YMD)
  let sumYmdExcl = 0;
  for (let i = 1; i <= 22; i++) {
    const day = `2026-09-${String(i).padStart(2, "0")}`;
    const next = `2026-09-${String(i + 1).padStart(2, "0")}`;
    const base = millenniumBaseUrl().replace(/\/$/, "");
    const res = await fetch(`${base}/${RELATORIO_MARGEM_PATH}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({ FILIAL: mid, DESC: null, DATAI: day, DATAF: next, TIPO: null }),
      signal: AbortSignal.timeout(180_000),
    });
    const lines = parseRelatorioMargemPayload(JSON.parse(await res.text()));
    sumYmdExcl += cmvCentsFromMargemLines(lines);
  }
  console.log(`K date-only DATAF=+1 day-by-day CMV=${(sumYmdExcl / 100).toFixed(2)}`);

  // L: ISO same-day bounds (DATAI=DATAF=dayT04)  -  hipotese inclusiva
  let sumSame = 0;
  let sumSameFat = 0;
  for (let i = 1; i <= 22; i++) {
    const day = `2026-09-${String(i).padStart(2, "0")}`;
    const bound = `${day}T04:00:00.000Z`;
    const base = millenniumBaseUrl().replace(/\/$/, "");
    const res = await fetch(`${base}/${RELATORIO_MARGEM_PATH}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({ FILIAL: mid, DESC: null, DATAI: bound, DATAF: bound, TIPO: null }),
      signal: AbortSignal.timeout(180_000),
    });
    const lines = parseRelatorioMargemPayload(JSON.parse(await res.text()));
    sumSame += cmvCentsFromMargemLines(lines);
    sumSameFat += lines.reduce((s, l) => s + l.totalVenda, 0);
  }
  console.log(
    `L ISO DATAI=DATAF=dayT04 day-by-day CMV=${(sumSame / 100).toFixed(2)} TOTALVENDA=${sumSameFat.toFixed(2)}`,
  );

  // M: ISO inclusive end = end day T04 (no +1) for range  -  already tested as C
  // N: per-day with DATAF = end of local day as next day T03:59:59  -  same as exclusive date?
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
