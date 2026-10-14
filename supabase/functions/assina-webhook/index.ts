/**
 * assina-webhook — o POST só acorda. O status sai do GET do envelope.
 * verify_jwt = false: o Assina AI não manda JWT do Supabase.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "../_shared/cors.ts";
import { loadCompanyToken, syncEnvelope } from "../_shared/assinaSync.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const erpSecret = Deno.env.get("ERP_SECRET_KEY");
  if (!supabaseUrl || !serviceKey || !erpSecret) return new Response("server_misconfigured", { status: 500 });

  let body: { eventId?: string; envelopeId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid_json", { status: 400 });
  }
  const eventId = body.eventId?.trim();
  const envelopeId = body.envelopeId?.trim();
  if (!eventId || !envelopeId) return new Response("ok", { status: 200 });

  const admin = createClient(supabaseUrl, serviceKey);
  const inserted = await admin.from("document_event").insert({ event_id: eventId, envelope_id: envelopeId });
  if (inserted.error) return new Response("ok", { status: 200 });

  const { data: doc } = await admin.from("employee_document").select("tenant_id").eq("envelope_id", envelopeId).maybeSingle();
  if (!doc) return new Response("ok", { status: 200 });

  const token = await loadCompanyToken(admin, doc.tenant_id as string, erpSecret);
  if (token) await syncEnvelope(admin, token, envelopeId);
  return new Response("ok", { status: 200 });
});
