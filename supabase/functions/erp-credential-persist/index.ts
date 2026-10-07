/**
 * erp-credential-persist  -  OWNER onboarding: encrypt ERP password, upsert
 * erp_credential (+ optional stores). Username change wipes tenant sync data.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { logoutMillennium } from "../_shared/millennium.ts";

type StoreIn = {
  storeId: number;
  code?: string;
  name?: string;
  tradeName?: string;
  taxId?: string;
  openedAt?: string;
  hasWpink?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function encryptPassword(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return `${b64(iv)}.${b64(cipher)}`;
}

/** Apaga dados de sync do tenant (troca de usuario Millennium). */
async function wipeTenantErpSync(
  admin: SupabaseClient,
  tenantId: string,
  oldSession: string | null,
): Promise<void> {
  if (oldSession?.trim()) {
    try {
      await logoutMillennium(oldSession.trim());
    } catch {
      /* best-effort */
    }
  }

  await admin.from("sync_job").delete().eq("tenant_id", tenantId);
  await admin.from("sync_run").delete().eq("tenant_id", tenantId);
  await admin.from("sales_hour_agg").delete().eq("tenant_id", tenantId);
  await admin.from("sales_day_agg").delete().eq("tenant_id", tenantId);

  const { data: stores } = await admin.from("store").select("id").eq("tenant_id", tenantId);
  const storeIds = (stores ?? []).map((s) => s.id as string);
  if (storeIds.length > 0) {
    await admin.from("membership_store").delete().in("store_id", storeIds);
    await admin.from("store").delete().eq("tenant_id", tenantId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const erpSecret = Deno.env.get("ERP_SECRET_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey || !erpSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: {
    tenantId?: string;
    membershipId?: string;
    username?: string;
    password?: string;
    dedicated?: boolean;
    millenniumSession?: string;
    stores?: StoreIn[];
    /**
     * Troca de usuario ERP com lojas em comum (Configuracoes > Integracoes):
     * mantem dados/lojas e remove so as lojas que o usuario novo nao enxerga.
     * Ausente = comportamento antigo (troca de usuario apaga tudo).
     */
    userChange?: { mode?: string; removeMillenniumStoreIds?: number[] };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const tenantId = String(body.tenantId ?? "").trim();
  const membershipId = String(body.membershipId ?? "").trim();
  const username = String(body.username ?? "").trim().toUpperCase();
  const password = String(body.password ?? "");
  const dedicated = Boolean(body.dedicated);
  const millenniumSession = String(body.millenniumSession ?? "").trim();
  const stores = Array.isArray(body.stores) ? body.stores : [];

  // stores vazias = so credencial (Step2); com lojas = concluir onboarding.
  if (!tenantId || !membershipId || !username || !password) {
    return json({ error: "invalid_body" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: identity } = await admin
    .from("identity")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!identity) return json({ error: "identity_not_found" }, 403);

  const { data: membership } = await admin
    .from("membership")
    .select("id, tenant_id, role, status")
    .eq("id", membershipId)
    .eq("identity_id", identity.id)
    .eq("tenant_id", tenantId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role as string)) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: existing } = await admin
    .from("erp_credential")
    .select("id, username, millennium_session")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const prevUser = String((existing as { username?: string } | null)?.username ?? "")
    .trim()
    .toUpperCase();
  const usernameChanged = Boolean(prevUser && prevUser !== username);
  const keepOnChange = usernameChanged && body.userChange?.mode === "keep";
  // O teste de login ja gravou o token NOVO na credencial  -  nao deslogar ele.
  const oldSessionRaw = (existing as { millennium_session?: string | null })?.millennium_session ?? null;
  const oldSession = oldSessionRaw && oldSessionRaw !== millenniumSession ? oldSessionRaw : null;
  if (keepOnChange) {
    if (oldSession?.trim()) {
      try {
        await logoutMillennium(oldSession.trim());
      } catch {
        /* best-effort */
      }
    }
    const remove = (body.userChange?.removeMillenniumStoreIds ?? []).map(Number).filter(Number.isFinite);
    if (remove.length > 0) {
      const { data: gone } = await admin
        .from("store")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("millennium_store_id", remove);
      const goneIds = (gone ?? []).map((s) => s.id as string);
      if (goneIds.length > 0) {
        await admin.from("membership_store").delete().in("store_id", goneIds);
        // Agregados de venda/categoria/forma/vendedora/produto saem em cascata.
        await admin.from("store").delete().in("id", goneIds);
      }
    }
  } else if (usernameChanged) {
    await wipeTenantErpSync(admin, tenantId, oldSession);
  }

  const ciphertext = await encryptPassword(password, erpSecret);
  const lightInterval = 5; // alinhado ao cooldown do botao Atualizar (FORCE)

  const credRow: Record<string, unknown> = {
    tenant_id: tenantId,
    username,
    password_ciphertext: ciphertext,
    dedicated,
    status: "VALID",
    light_interval_min: lightInterval,
    updated_at: new Date().toISOString(),
    sync_paused: false,
  };
  if (millenniumSession) {
    credRow.millennium_session = millenniumSession;
    credRow.millennium_session_at = new Date().toISOString();
    credRow.millennium_session_by = "app";
  }

  const { data: cred, error: credErr } = await admin
    .from("erp_credential")
    .upsert(credRow, { onConflict: "tenant_id" })
    .select("id")
    .single();
  if (credErr || !cred) {
    console.error("erp_credential upsert", credErr);
    return json({ error: "credential_upsert_failed" }, 500);
  }

  const storeIds: string[] = [];
  for (const s of stores) {
    const milleniumId = Number(s.storeId);
    if (!Number.isFinite(milleniumId)) continue;
    const { data: row, error: storeErr } = await admin
      .from("store")
      .upsert(
        {
          tenant_id: tenantId,
          millennium_store_id: milleniumId,
          code: s.code ?? String(milleniumId),
          name: s.name ?? s.tradeName ?? String(milleniumId),
          trade_name: s.tradeName ?? s.name ?? String(milleniumId),
          tax_id: s.taxId?.trim() || null,
          timezone: "America/Campo_Grande",
          has_wpink: Boolean(s.hasWpink),
          ...(s.openedAt && /^\d{4}-\d{2}-\d{2}/.test(s.openedAt)
            ? { opened_at: s.openedAt.slice(0, 10) }
            : {}),
        },
        { onConflict: "tenant_id,millennium_store_id" },
      )
      .select("id")
      .single();
    if (storeErr || !row) {
      console.error("store upsert", storeErr);
      return json({ error: "store_upsert_failed" }, 500);
    }
    storeIds.push(row.id as string);
  }

  if (stores.length > 0) {
    await admin.from("membership_store").delete().eq("membership_id", membershipId);
    if (storeIds.length > 0) {
      const { error: msErr } = await admin.from("membership_store").insert(
        storeIds.map((store_id) => ({ membership_id: membershipId, store_id })),
      );
      if (msErr) {
        console.error("membership_store insert", msErr);
        return json({ error: "membership_store_failed" }, 500);
      }
    }
  }

  if (keepOnChange && stores.length === 0) {
    const { data: links } = await admin
      .from("membership_store")
      .select("store_id")
      .eq("membership_id", membershipId);
    for (const l of links ?? []) storeIds.push(l.store_id as string);
  }

  return json({
    ok: true,
    credentialId: cred.id,
    storeIds,
    lightIntervalMin: lightInterval,
    wiped: usernameChanged && !keepOnChange,
  });
});
