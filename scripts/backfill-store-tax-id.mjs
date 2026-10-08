/**
 * Atualiza store.tax_id (CNPJ) a partir do FILIAIS.Lista do Millennium.
 * Nao mexe em onboarding / vendas / jobs.
 *
 * Usage: node scripts/backfill-store-tax-id.mjs [email]
 * Default email: santanaebessaltda@gmail.com
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const EMAIL = process.argv[2] || "santanaebessaltda@gmail.com";

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

function pick(o, ...keys) {
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim() !== "") return o[k];
  }
  return null;
}

function asStr(v, fallback = "") {
  if (v == null) return fallback;
  return String(v).trim();
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const k of ["value", "Value", "data", "Data", "items", "Items", "filiais", "Filiais", "d"]) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  if (typeof payload.value === "string") {
    try {
      const inner = JSON.parse(payload.value);
      if (Array.isArray(inner)) return inner;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function mapStore(raw) {
  if (!raw || typeof raw !== "object") return null;
  const storeId = asNum(pick(raw, "FILIAL", "COD", "filial", "cod"));
  if (storeId == null) return null;
  return {
    storeId,
    taxId: asStr(pick(raw, "CGC", "CNPJ", "cgc", "cnpj")),
    tradeName: asStr(pick(raw, "FANTASIA", "fantasia")) || asStr(pick(raw, "NOME", "nome")),
  };
}

function extractSession(parsed) {
  if (!parsed) return null;
  if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  if (typeof parsed !== "object") return null;
  const o = parsed;
  for (const k of ["session", "Session", "wts_session", "WTS-Session", "token", "Token"]) {
    if (typeof o[k] === "string" && o[k].trim()) return o[k].trim();
  }
  return null;
}

async function decryptPassword(ciphertext, secret) {
  const [ivB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !dataB64) throw new Error("invalid_ciphertext_format");
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, ["decrypt"]);
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

async function loginMillennium(base, username, password) {
  const url = `${base}/login?$format=json&$dateformat=iso`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "WTS-Authorization": `${username}/${password}`,
      "WTS-AppName": "millenium",
      "WTS-LicenceType": "retag",
    },
    body: "{}",
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`login ${res.status}: ${raw.slice(0, 200)}`);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* texto */
  }
  const session =
    extractSession(parsed) ??
    (raw.trim() && !raw.trim().startsWith("{") ? raw.trim() : null);
  if (!session) throw new Error("login sem session");
  return session;
}

async function listStores(base, session) {
  const paths = ["millenium.filiais.lista", "millennium.filiais.lista", "Millennium.FILIAIS.Lista"];
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "WTS-Session": session,
  };
  let lastErr = "";

  for (const p of paths) {
    const q = new URLSearchParams({ $format: "json", $dateformat: "iso", $top: "0" });
    try {
      const res = await fetch(`${base}/${p}?${q}`, { method: "GET", headers });
      const raw = await res.text();
      if (!res.ok) {
        lastErr = `GET ${p} → ${res.status} ${raw.slice(0, 180)}`;
        continue;
      }
      const parsed = raw ? JSON.parse(raw) : [];
      const list = extractList(parsed).map(mapStore).filter(Boolean);
      if (list.length > 0) return list;
      lastErr = `GET ${p} → lista vazia`;
    } catch (e) {
      lastErr = `GET ${p} → ${e instanceof Error ? e.message : e}`;
    }
  }

  const headersPost = {
    ...headers,
    "X-HTTP-Method": "GET",
    "X-DateFormat": "ISOTZ",
    "X-IdentifierCase": "upper",
  };
  for (const p of paths) {
    try {
      const res = await fetch(`${base}/${p}`, {
        method: "POST",
        headers: headersPost,
        body: JSON.stringify({ $top: 0 }),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastErr = `POST ${p} → ${res.status} ${raw.slice(0, 180)}`;
        continue;
      }
      const parsed = raw ? JSON.parse(raw) : [];
      const list = extractList(parsed).map(mapStore).filter(Boolean);
      if (list.length > 0) return list;
      lastErr = `POST ${p} → lista vazia`;
    } catch (e) {
      lastErr = `POST ${p} → ${e instanceof Error ? e.message : e}`;
    }
  }

  throw new Error(lastErr || "FILIAIS.Lista falhou");
}


const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const env = {
  ...loadEnv(path.join(root, ".env")),
  ...loadEnv(path.join(root, "workers/millennium-sync/.env")),
};

const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
const millBase = (env.MILLENNIUM_API_BASE || "http://177.85.160.35:6017/api").replace(/\/$/, "");
const erpSecret = (env.ERP_SECRET_KEY || "").trim();

if (!url || !key) {
  console.error("FAIL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: identity, error: idErr } = await sb
  .from("identity")
  .select("id, email")
  .ilike("email", EMAIL)
  .maybeSingle();
if (idErr || !identity) {
  console.error("identity:", idErr?.message ?? "not found");
  process.exit(1);
}

const { data: membership, error: memErr } = await sb
  .from("membership")
  .select("id, tenant_id")
  .eq("identity_id", identity.id)
  .maybeSingle();
if (memErr || !membership) {
  console.error("membership:", memErr?.message ?? "not found");
  process.exit(1);
}

const tenantId = membership.tenant_id;
console.log("tenant", tenantId, "|", identity.email);

const { data: cred, error: credErr } = await sb
  .from("erp_credential")
  .select("id, username, password_ciphertext, millennium_session")
  .eq("tenant_id", tenantId)
  .maybeSingle();
if (credErr || !cred) {
  console.error("erp_credential:", credErr?.message ?? "not found");
  process.exit(1);
}

let session = "";
const sessionFile = path.join(root, "workers/millennium-sync/.millennium-sessions.json");
if (fs.existsSync(sessionFile)) {
  try {
    const remembered = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    if (remembered[cred.id]) {
      session = remembered[cred.id];
      console.log("sessão do worker (.millennium-sessions.json)");
    }
  } catch {
    /* ignore */
  }
}
if (!session) session = cred.millennium_session || "";
let usedLogin = false;

async function tryList(s) {
  return listStores(millBase, s);
}

let millStores = [];
const sessionCandidates = [];
if (session) sessionCandidates.push(session);
if (fs.existsSync(sessionFile)) {
  try {
    const remembered = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    for (const v of Object.values(remembered)) {
      if (typeof v === "string" && v && !sessionCandidates.includes(v)) {
        sessionCandidates.push(v);
      }
    }
  } catch {
    /* ignore */
  }
}

let workingSession = "";
for (const s of sessionCandidates) {
  try {
    millStores = await tryList(s);
    workingSession = s;
    console.log("FILIAIS ok ·", millStores.length, "loja(s)");
    break;
  } catch (e) {
    console.warn("sessão falhou:", e instanceof Error ? e.message : e);
  }
}
session = workingSession;

if (!session) {
  if (!erpSecret) {
    console.error("FAIL: precisa ERP_SECRET_KEY p/ login (sessão salva inválida)");
    process.exit(1);
  }
  const password = await decryptPassword(cred.password_ciphertext, erpSecret);
  session = await loginMillennium(millBase, cred.username, password);
  usedLogin = true;
  millStores = await tryList(session);
  console.log("FILIAIS via login novo:", millStores.length);
  await sb
    .from("erp_credential")
    .update({
      millennium_session: session,
      millennium_session_at: new Date().toISOString(),
      millennium_session_by: "script",
    })
    .eq("id", cred.id);
}

const withCnpj = millStores.filter((s) => s.taxId);
console.log("com CNPJ:", withCnpj.length, "/", millStores.length);
if (withCnpj.length === 0) {
  console.error("FAIL: Millennium não devolveu CGC/CNPJ");
  process.exit(1);
}

const { data: dbStores, error: stErr } = await sb
  .from("store")
  .select("id, millennium_store_id, trade_name, tax_id")
  .eq("tenant_id", tenantId);
if (stErr) {
  console.error("store:", stErr.message);
  process.exit(1);
}

const byMill = new Map(withCnpj.map((s) => [s.storeId, s]));
let updated = 0;
let skipped = 0;
for (const row of dbStores ?? []) {
  const hit = byMill.get(row.millennium_store_id);
  if (!hit?.taxId) {
    skipped += 1;
    continue;
  }
  if (row.tax_id === hit.taxId) {
    skipped += 1;
    continue;
  }
  const { error } = await sb.from("store").update({ tax_id: hit.taxId }).eq("id", row.id);
  if (error) {
    console.warn("update fail", row.trade_name, error.message);
    continue;
  }
  updated += 1;
  console.log("OK", row.millennium_store_id, row.trade_name, "→", hit.taxId);
}

console.log(
  `done: updated=${updated} skipped=${skipped} login=${usedLogin ? "yes" : "no"}`,
);
console.log("F5 no app — o StorePicker puxa tax_id no hydrate.");
