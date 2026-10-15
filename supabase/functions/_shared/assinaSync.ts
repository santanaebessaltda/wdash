/** Atualiza um documento a partir do GET do envelope. O webhook só chama isto. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { applyEnvelopeStatus, type DocStatus } from "../../../src/data/wedash/documentSplit.ts";
import { assinaGetEnvelope, signedUrlOf } from "./assinaApi.ts";
import { decryptSecret } from "./secretBox.ts";

const BUCKET = "documents";

export async function loadCompanyToken(
  admin: SupabaseClient,
  tenantId: string,
  secret: string,
): Promise<string | null> {
  const { data } = await admin.from("assina_credential").select("token_cipher").eq("tenant_id", tenantId).maybeSingle();
  if (!data?.token_cipher) return null;
  return decryptSecret(data.token_cipher as string, secret);
}

export async function syncEnvelope(admin: SupabaseClient, token: string, envelopeId: string): Promise<boolean> {
  const { data: row } = await admin
    .from("employee_document")
    .select("id, tenant_id, status, signed_storage_path, removed_at")
    .eq("envelope_id", envelopeId)
    .maybeSingle();
  if (!row) return false;
  if (row.removed_at) return true;

  const remote = await assinaGetEnvelope(token, envelopeId);
  if (!remote?.status) return true;

  const next = applyEnvelopeStatus(row.status as DocStatus, remote.status);
  const patch: { status: string; signed_storage_path?: string } = { status: next };
  if (next === "SIGNED" && !row.signed_storage_path) {
    const url = signedUrlOf(remote);
    if (url) {
      try {
        const file = await fetch(url);
        if (file.ok) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const path = `${row.tenant_id}/${row.id}-signed.pdf`;
          const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
          if (!up.error) patch.signed_storage_path = path;
        }
      } catch {
        /* Assinado fica. A URL temporária não é gravada. */
      }
    }
  }
  await admin.from("employee_document").update(patch).eq("id", row.id);
  return true;
}
