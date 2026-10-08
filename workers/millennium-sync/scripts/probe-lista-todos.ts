/**
 * Probe minimalista: Lista vs ListaTodos  |  com/sem FILIAL  |  1d vs 30d.
 *   cd workers/millennium-sync && npx tsx scripts/probe-lista-todos.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, logoutMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { milleniumDataRange } from "../src/millenniumSales.ts";
import { fetchEventosListaTodos, resolveSalesEventIds } from "../src/millenniumEvents.ts";

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
    return;
  }
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

function fullBody(opts: {
  from: string;
  to: string;
  eventoIds: number[];
  filial: number | null;
}) {
  const { datai, dataf } = milleniumDataRange(opts.from, opts.to);
  return {
    EVENTO: `(${opts.eventoIds.join(",")})`,
    DATAI: datai,
    DATAF: dataf,
    ...(opts.filial != null ? { FILIAL: opts.filial } : { FILIAL: null }),
    DOCUMENTO: null,
    CANCELADA: false,
    GERADOR: "C",
    COD: null,
    ORDEM: 0,
    CONTA: null,
    NOTAI: null,
    NOTAF: null,
    TIPO_PAGTO: null,
    CONDICAO: null,
    EMBARQUE: null,
    N_DOCEXTERNO: null,
    VENDEDOR: null,
    PEDIDOREF: null,
    FILIAL_DESTINO: null,
    PRODUCAO: null,
    CONFERIDO: null,
    TIPO_PEDIDO: null,
    COD_PEDIDO: null,
    PEDIDO: false,
    GRUPO_LOJA: null,
    NUMERO_CARTAO: null,
    GERADOR_COM: "V",
    COD_COM: null,
    LIM_CRED_MOV_EXCEDEU: null,
    LIM_CRED_EX_VLR_INI: null,
    LIM_CRED_EX_VLR_FIM: null,
    NUMERO_PREFAT: null,
    PREFATURAMENTO: false,
    COD_VOLUME: null,
    ENTREGA_CONFIRMADA: null,
    VOID: null,
  };
}

async function call(opts: {
  path: string;
  session: string;
  from: string;
  to: string;
  eventoIds: number[];
  filial: number | null;
}) {
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const origin = base.replace(/\/api\/?$/, "");
  const body = fullBody(opts);
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/${opts.path}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/files/web-apps/millennium.html`,
        "X-DateFormat": "ISOTZ",
        "X-IdentifierCase": "upper",
        "WTS-Session": opts.session,
        "X-HTTP-Method": "GET",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const raw = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) {
      return { ms, rows: 0, kb: 0, err: `HTTP ${res.status}: ${raw.slice(0, 160)}`, filiais: "" };
    }
    let list: unknown[] = [];
    try {
      list = extractList(JSON.parse(raw));
    } catch {
      return { ms, rows: 0, kb: raw.length / 1024, err: "JSON inválido", filiais: "" };
    }
    const counts = new Map<string, number>();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const f = String(o.FILIAL ?? o.COD ?? "?");
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const filiais = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    return { ms, rows: list.length, kb: raw.length / 1024, filiais, err: undefined as string | undefined };
  } catch (e) {
    return {
      ms: Date.now() - t0,
      rows: 0,
      kb: 0,
      filiais: "",
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  loadDotEnv();
  const erpSecret = process.env.ERP_SECRET_KEY?.trim();
  if (!erpSecret) throw new Error("ERP_SECRET_KEY missing");

  const sb = createAdminClient();
  const deps = buildDeps(sb, erpSecret);
  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, username, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no VALID erp_credential");

  const full = await deps.loadCredential(cred.id as string);
  const stores = await deps.listStores(cred.tenant_id as string);
  console.log(`Lojas: ${stores.map((s) => `${s.code}=${s.millenniumStoreId}`).join(", ")}`);

  const login = await loginMillennium(full.username, full.password);
  if (!login.ok) {
    console.error("Login:", login.reason, login.raw.slice(0, 200));
    process.exit(1);
  }

  try {
    const events = await fetchEventosListaTodos({
      session: login.session,
      baseUrl: millenniumBaseUrl(),
    });
    const allIds = new Set<number>();
    for (const s of stores) {
      for (const id of resolveSalesEventIds(events, s.code)) allIds.add(id);
    }
    const eventoIds = [...allIds].sort((a, b) => a - b);
    console.log(`EVENTOs: ${eventoIds.join(",")}\n`);

    const cases = [
      { path: "millenium.VENDAS.Lista", label: "Lista", from: "2026-09-20", to: "2026-09-20", filial: null as number | null },
      { path: "millenium.VENDAS.ListaTodos", label: "ListaTodos", from: "2026-09-20", to: "2026-09-20", filial: null },
      { path: "millenium.VENDAS.Lista", label: "Lista", from: "2026-08-22", to: "2026-09-20", filial: null },
      { path: "millenium.VENDAS.ListaTodos", label: "ListaTodos", from: "2026-08-22", to: "2026-09-20", filial: null },
      {
        path: "millenium.VENDAS.Lista",
        label: "Lista+FILIAL",
        from: "2026-08-22",
        to: "2026-09-20",
        filial: stores[0]?.millenniumStoreId ?? 8,
      },
    ];

    for (const c of cases) {
      const tag = `${c.label} ${c.from}→${c.to} filial=${c.filial ?? "null"}`;
      process.stdout.write(`${tag} … `);
      const r = await call({
        path: c.path,
        session: login.session,
        from: c.from,
        to: c.to,
        eventoIds,
        filial: c.filial,
      });
      if (r.err) console.log(`FAIL ${r.ms}ms · ${r.err}`);
      else console.log(`OK ${r.ms}ms · ${r.rows} rows · ${r.kb.toFixed(0)}KB · ${r.filiais || "(sem FILIAL na linha)"}`);
    }
  } finally {
    await logoutMillennium(login.session);
    console.log("\nLogout OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
