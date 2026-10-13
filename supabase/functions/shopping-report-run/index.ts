/**
 * shopping-report-run — o Gestor ou o Gerente pede o lançamento.
 * A entrada na Allos abre a página num navegador no worker. Este função só autoriza e encaminha.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { canAccessStore, loadStaffCaller } from "../_shared/staffAuth.ts";
import { forceLaunchAllowed } from "../_shared/shoppingFill.ts";

const KEEP = "Não foi possível informar as vendas ao shopping. Os valores já informados foram mantidos.";
const OFF = "O lançamento no shopping ainda não está ligado neste ambiente. Nada foi alterado.";

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
  if (!supabaseUrl || !supabaseAnon || !serviceKey) return json({ ok: false, message: KEEP }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id);
  if (!caller) return json({ error: "forbidden" }, 403);

  let body: { storeId?: unknown; read?: unknown; from?: unknown; to?: unknown; days?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: KEEP });
  }
  const readOnly = body.read === true;
  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  if (!storeId || !canAccessStore(caller.role, caller.memberStoreIds, storeId)) return json({ error: "forbidden" }, 403);

  const { data: store } = await admin.from("store").select("id, point_type").eq("id", storeId).eq("tenant_id", caller.tenantId).maybeSingle();
  if (!store) return json({ ok: false, message: KEEP });

  const { data: account } = await admin.from("store_shopping").select("administrator").eq("store_id", storeId).maybeSingle();
  const administrator = account?.administrator === "allos" || account?.administrator === "argo" ? account.administrator : null;
  const gate = forceLaunchAllowed({ kiosk: store.point_type === "MALL", administrator });
  if (!gate.ok) return json({ ok: false, message: gate.message });

  const runUrl = Deno.env.get("ALLOS_RUN_URL")?.trim() ?? "";
  const runToken = Deno.env.get("ALLOS_RUN_TOKEN")?.trim() ?? "";
  if (!runUrl || !runToken) return json({ ok: false, message: OFF });

  try {
    const remote = await fetch(runUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${runToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        read: readOnly,
        from: typeof body.from === "string" ? body.from : "",
        to: typeof body.to === "string" ? body.to : "",
        days: Array.isArray(body.days) ? body.days.filter((day): day is string => typeof day === "string") : [],
      }),
    });
    const data = await remote.json().catch(() => null);
    if (!data || typeof data !== "object") return json({ ok: false, message: KEEP });
    return json(data);
  } catch {
    return json({ ok: false, message: KEEP });
  }
});
