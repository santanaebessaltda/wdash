/**
 * assina-credential-persist — um token da empresa. A resposta não devolve o token.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";
import { assinaTokenWorks } from "../_shared/assinaApi.ts";
import { encryptSecret } from "../_shared/secretBox.ts";
import { DOCUMENT_COPY } from "../../../src/data/wedash/documentSplit.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const erpSecret = Deno.env.get("ERP_SECRET_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey || !erpSecret) return json({ error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id, OWNER_ROLES);
  if (!caller) return json({ error: "forbidden" }, 403);

  let body: { token?: unknown; clear?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.clear === true) {
    await admin.from("assina_credential").delete().eq("tenant_id", caller.tenantId);
    return json({ status: "not_configured" });
  }

  if (typeof body.token === "string" && body.token.trim()) {
    const token = body.token.trim();
    const works = await assinaTokenWorks(token);
    if (!works) return json({ status: "invalid", message: DOCUMENT_COPY.badToken }, 422);
    const tokenCipher = await encryptSecret(token, erpSecret);
    const { error } = await admin.from("assina_credential").upsert({
      tenant_id: caller.tenantId,
      token_cipher: tokenCipher,
      updated_at: new Date().toISOString(),
    });
    if (error) return json({ error: "persist" }, 500);
    return json({ status: "connected" });
  }

  const { data } = await admin.from("assina_credential").select("tenant_id").eq("tenant_id", caller.tenantId).maybeSingle();
  return json({ status: data ? "connected" : "not_configured" });
});
