/**
 * documents — corte, revisão, envio, reenvio e abertura. Só o Gestor.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";
import { buildPdf, readPdfPages } from "../_shared/pdfPages.ts";
import { assinaCreateEnvelope, assinaResend, recipientIdOf } from "../_shared/assinaApi.ts";
import { loadCompanyToken } from "../_shared/assinaSync.ts";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  assignSeller,
  channelBlock,
  confirmBlock,
  customDocumentName,
  deliveryFileName,
  fileName,
  groupPages,
  resendVisible,
  saveCpf,
  saveEmail,
  saveWhatsapp,
  shouldSend,
  signaturePositions,
  sourceRefusal,
  type DocStatus,
} from "../../../src/data/wedash/documentSplit.ts";

const BUCKET = "documents";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskCpf(digits: string): string {
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

type Body = Record<string, unknown>;

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

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = String(body.action ?? "");
  if (action === "upload") return uploadSlot(admin, caller.tenantId, body);
  if (action === "prepare") return prepare(admin, caller.tenantId, body);
  if (action === "assign") return assign(admin, caller.tenantId, body);
  if (action === "save-contact") return saveContact(admin, caller.tenantId, body);
  if (action === "confirm") return confirm(admin, caller.tenantId, erpSecret, body);
  if (action === "resend") return resend(admin, caller.tenantId, erpSecret, body);
  if (action === "open") return openFile(admin, caller.tenantId, erpSecret, body);
  return json({ error: "unknown_action" }, 400);
});

async function ownedBatch(admin: SupabaseClient, tenantId: string, batchId: string) {
  const { data } = await admin.from("document_batch").select("*").eq("id", batchId).eq("tenant_id", tenantId).maybeSingle();
  return data;
}

async function uploadSlot(admin: SupabaseClient, tenantId: string, body: Body) {
  const month = Number(body.month);
  const year = Number(body.year);
  const category = String(body.category ?? "");
  if (!DOCUMENT_CATEGORIES.includes(category as (typeof DOCUMENT_CATEGORIES)[number]) || month < 1 || month > 12 || !year) {
    return json({ error: "invalid_batch" }, 400);
  }
  let batchId = typeof body.batchId === "string" ? body.batchId : "";
  if (!batchId) {
    const storeId = typeof body.storeId === "string" && body.storeId ? body.storeId : null;
    const { data, error } = await admin
      .from("document_batch")
      .insert({
        tenant_id: tenantId,
        store_id: storeId,
        month,
        year,
        category,
        unify: body.unify !== false,
      })
      .select("id")
      .single();
    if (error || !data) return json({ error: "persist" }, 500);
    batchId = data.id as string;
  } else if (!(await ownedBatch(admin, tenantId, batchId))) return json({ error: "not_found" }, 404);

  const path = `${tenantId}/${batchId}/source/${crypto.randomUUID()}.pdf`;
  const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) return json({ error: "upload" }, 500);
  return json({ batchId, path, token: signed.data.token });
}

async function prepare(admin: SupabaseClient, tenantId: string, body: Body) {
  const batchId = String(body.batchId ?? "");
  const batch = await ownedBatch(admin, tenantId, batchId);
  if (!batch) return json({ error: "not_found" }, 404);
  const sources = Array.isArray(body.sources) ? body.sources : [];
  const { count } = await admin.from("employee_document").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
  const refused: { name: string; message: string }[] = [];
  const created: string[] = [];
  let accepted = count ?? 0;

  const sellerQuery = admin.from("store_seller").select("id, store_id, cpf").eq("tenant_id", tenantId).eq("in_erp", true);
  const { data: sellers } = batch.store_id ? await sellerQuery.eq("store_id", batch.store_id) : await sellerQuery;
  const byCpf = new Map<string, { id: string; storeId: string }[]>();
  for (const seller of sellers ?? []) {
    if (!seller.cpf) continue;
    const list = byCpf.get(seller.cpf as string) ?? [];
    list.push({ id: seller.id as string, storeId: seller.store_id as string });
    byCpf.set(seller.cpf as string, list);
  }

  const held: { bytes: Uint8Array; texts: string[] }[] = [];
  for (const source of sources as { path?: string; name?: string }[]) {
    const path = String(source.path ?? "");
    const name = String(source.name ?? "arquivo.pdf");
    if (!path.startsWith(`${tenantId}/${batchId}/`)) {
      refused.push({ name, message: DOCUMENT_COPY.notPdf });
      continue;
    }
    const downloaded = await admin.storage.from(BUCKET).download(path);
    if (downloaded.error || !downloaded.data) {
      refused.push({ name, message: DOCUMENT_COPY.notPdf });
      continue;
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    let read;
    try {
      read = await readPdfPages(bytes);
    } catch {
      refused.push({ name, message: DOCUMENT_COPY.notPdf });
      continue;
    }
    const reason = sourceRefusal({
      mime: "application/pdf",
      bytes: bytes.byteLength,
      pages: read.pageCount,
      hasText: read.hasText,
      alreadyAccepted: accepted,
    });
    if (reason) {
      refused.push({ name, message: reason });
      continue;
    }
    accepted += 1;
    held.push({ bytes, texts: read.texts });
  }

  const pages = held.flatMap((file, sourceIndex) => file.texts.map((text, index) => ({ sourceIndex, pageNumber: index + 1, text })));
  const groups = groupPages(pages, batch.unify !== false);
  const sourceBytes = held.map((file) => file.bytes);
  const label = batch.category === "Outros" ? customDocumentName(String(body.title ?? "")) : { ok: true as const, name: String(batch.category) };
  if (!label.ok) return json({ message: label.message }, 422);
  const takenInLoop = new Map<string, string[]>();
  for (const group of groups) {
      const matches = group.cpf ? (byCpf.get(group.cpf) ?? []) : [];
      const sellerId = assignSeller(matches);
      const storeId = matches.length === 1 ? matches[0].storeId : (batch.store_id as string | null);
      const key = sellerId ?? "none";
      const taken = [...(await takenNames(admin, sellerId, batch)), ...(takenInLoop.get(key) ?? [])];
      const docName = fileName(label.name, taken);
      takenInLoop.set(key, [...(takenInLoop.get(key) ?? []), docName]);
      const pdf = await buildPdf(sourceBytes, group.pages);
      const docId = crypto.randomUUID();
      const storagePath = `${tenantId}/${batchId}/${docId}.pdf`;
      const up = await admin.storage.from(BUCKET).upload(storagePath, pdf, { contentType: "application/pdf" });
      if (up.error) {
        refused.push({ name: docName, message: "Não foi possível guardar o PDF." });
        continue;
      }
      const { error } = await admin.from("employee_document").insert({
        id: docId,
        batch_id: batchId,
        tenant_id: tenantId,
        store_id: storeId,
        seller_id: sellerId,
        status: "UNASSIGNED",
        storage_path: storagePath,
        file_name: docName,
        page_count: group.pages.length,
        size_bytes: pdf.byteLength,
      });
      if (error) refused.push({ name: docName, message: "Não foi possível guardar o PDF." });
      else created.push(docId);
  }
  return json({ batchId, created, refused });
}

async function takenNames(
  admin: SupabaseClient,
  sellerId: string | null,
  batch: { month: number; year: number; category: string },
): Promise<string[]> {
  if (!sellerId) return [];
  const { data: batches } = await admin
    .from("document_batch")
    .select("id")
    .eq("month", batch.month)
    .eq("year", batch.year)
    .eq("category", batch.category);
  const ids = (batches ?? []).map((row) => row.id as string);
  if (ids.length === 0) return [];
  const { data } = await admin.from("employee_document").select("file_name").eq("seller_id", sellerId).in("batch_id", ids);
  return (data ?? []).map((row) => row.file_name as string);
}

async function assign(admin: SupabaseClient, tenantId: string, body: Body) {
  const documentId = String(body.documentId ?? "");
  const sellerId = String(body.sellerId ?? "");
  const { data: doc } = await admin.from("employee_document").select("id, envelope_id").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || doc.envelope_id) return json({ error: "not_found" }, 404);
  const { data: seller } = await admin.from("store_seller").select("id, store_id").eq("id", sellerId).eq("tenant_id", tenantId).maybeSingle();
  if (!seller) return json({ error: "not_found" }, 404);
  await admin.from("employee_document").update({ seller_id: sellerId, store_id: seller.store_id, error: null }).eq("id", documentId);
  return json({ ok: true });
}

async function saveContact(admin: SupabaseClient, tenantId: string, body: Body) {
  const sellerId = String(body.sellerId ?? "");
  const { data: seller } = await admin.from("store_seller").select("id").eq("id", sellerId).eq("tenant_id", tenantId).maybeSingle();
  if (!seller) return json({ error: "not_found" }, 404);
  const cpf = saveCpf(String(body.cpf ?? ""));
  if (!cpf.ok) return json({ message: cpf.message }, 422);
  const email = saveEmail(String(body.email ?? ""));
  if (!email.ok) return json({ message: email.message }, 422);
  const whatsapp = saveWhatsapp(String(body.whatsapp ?? ""));
  if (!whatsapp.ok) return json({ message: whatsapp.message }, 422);
  const { error } = await admin.from("store_seller").update({ cpf: cpf.cpf, email: email.email, whatsapp: whatsapp.whatsapp }).eq("id", sellerId);
  if (error) return json({ error: "persist" }, 500);
  return json({ ok: true, cpf: cpf.cpf, email: email.email, whatsapp: whatsapp.whatsapp });
}

async function confirm(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const batch = await ownedBatch(admin, tenantId, String(body.batchId ?? ""));
  if (!batch) return json({ error: "not_found" }, 404);
  const channel = body.channel === "WHATSAPP" ? "WHATSAPP" : body.channel === "EMAIL" ? "EMAIL" : null;
  const deadline = typeof body.deadline === "string" && body.deadline ? body.deadline : null;
  const reminder = ["EVERY_DAY", "EVERY_3_DAYS", "EVERY_WEEK", "NEVER"].includes(String(body.reminder))
    ? String(body.reminder)
    : "EVERY_3_DAYS";
  if (!channel) return json({ message: "Escolha WhatsApp ou e-mail." }, 422);
  const token = await loadCompanyToken(admin, tenantId, secret);
  await admin.from("document_batch").update({ channel, deadline, reminder }).eq("id", batch.id);

  const { data: docs } = await admin.from("employee_document").select("*").eq("batch_id", batch.id);
  const results: { id: string; error: string | null }[] = [];
  for (const doc of docs ?? []) {
    try {
    const block = confirmBlock({ deadline, hasToken: Boolean(token), sizeBytes: doc.size_bytes as number });
    let seller: { name: string; email: string | null; whatsapp: string | null; cpf: string | null } | null = null;
    if (doc.seller_id) {
      const { data } = await admin.from("store_seller").select("name, email, whatsapp, cpf").eq("id", doc.seller_id).maybeSingle();
      seller = data;
    }
    const contactBlock = channelBlock(channel, { email: seller?.email ?? null, whatsapp: seller?.whatsapp ?? null });
    const rowBlock = block ?? (doc.seller_id ? contactBlock : null);
    if (!shouldSend({ envelopeId: (doc.envelope_id as string | null) ?? null, sellerId: (doc.seller_id as string | null) ?? null, block: rowBlock })) {
      if (rowBlock && !doc.envelope_id) await admin.from("employee_document").update({ error: rowBlock }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: doc.envelope_id ? null : rowBlock });
      continue;
    }
    const file = await admin.storage.from(BUCKET).download(doc.storage_path as string);
    if (file.error || !file.data || !token || !seller || !channel) {
      await admin.from("employee_document").update({ error: "Não foi possível ler o PDF." }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: "Não foi possível ler o PDF." });
      continue;
    }
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const sentName = deliveryFileName(doc.file_name as string, seller.name, Number(batch.month), Number(batch.year));
    const created = await assinaCreateEnvelope(token, bytes, sentName, {
      signatures: [
        {
          recipient: {
            name: seller.name,
            email: channel === "EMAIL" ? seller.email : "",
            phone: channel === "WHATSAPP" ? seller.whatsapp : "",
            cpf: seller.cpf ? maskCpf(seller.cpf) : "",
            routingOrder: 1,
            action: "SIGN",
            senderType: channel,
            authenticationType: "DEFAULT_SIGN",
            signaturePositions: signaturePositions(doc.page_count as number),
          },
        },
      ],
      documentSendConfig: {
        documentName: sentName,
        customEmailMessage: "",
        signatureDeadline: `${deadline}T23:59:59.000Z`,
        sendReminders: reminder,
        observers: [],
      },
      status: "SENT_FOR_SIGNATURE",
      folderId: null,
    });
    if (!created.ok || !created.body.id) {
      const message = created.ok
        ? "A Assina AI não devolveu o envelope."
        : created.status
          ? `Assina AI respondeu ${created.status}.`
          : "Não foi possível falar com o Assina AI.";
      await admin.from("employee_document").update({ error: message }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: message });
      continue;
    }
    await admin
      .from("employee_document")
      .update({
        status: "PENDING",
        envelope_id: created.body.id,
        recipient_id: recipientIdOf(created.body),
        error: null,
      })
      .eq("id", doc.id);
    results.push({ id: doc.id as string, error: null });
    } catch {
      const message = "Não foi possível falar com o Assina AI.";
      await admin.from("employee_document").update({ error: message }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: message });
    }
  }
  return json({ results });
}

async function resend(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const { data: doc } = await admin.from("employee_document").select("*").eq("id", String(body.documentId ?? "")).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || !resendVisible(doc.status as DocStatus) || !doc.envelope_id || !doc.recipient_id) return json({ error: "not_found" }, 404);
  const batch = await ownedBatch(admin, tenantId, doc.batch_id as string);
  if (!batch?.channel) return json({ error: "not_found" }, 404);
  const token = await loadCompanyToken(admin, tenantId, secret);
  const { data: seller } = await admin.from("store_seller").select("email, whatsapp").eq("id", doc.seller_id).maybeSingle();
  if (!token || !seller) return json({ message: "Não foi possível reenviar." }, 502);
  const channel = batch.channel as "EMAIL" | "WHATSAPP";
  const ok = await assinaResend(token, doc.envelope_id as string, doc.recipient_id as string, {
    senderType: channel,
    email: channel === "EMAIL" ? (seller.email as string) : undefined,
    phone: channel === "WHATSAPP" ? (seller.whatsapp as string) : undefined,
  });
  if (!ok) {
    await admin.from("employee_document").update({ error: "Não foi possível reenviar." }).eq("id", doc.id);
    return json({ message: "Não foi possível reenviar." }, 502);
  }
  await admin.from("employee_document").update({ error: null }).eq("id", doc.id);
  return json({ ok: true });
}

async function openFile(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const { data: doc } = await admin.from("employee_document").select("*").eq("id", String(body.documentId ?? "")).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) return json({ error: "not_found" }, 404);
  let path = (doc.status === "SIGNED" ? doc.signed_storage_path : doc.storage_path) as string | null;
  if (doc.status === "SIGNED" && !path && doc.envelope_id) {
    const token = await loadCompanyToken(admin, tenantId, secret);
    if (token) {
      const { syncEnvelope } = await import("../_shared/assinaSync.ts");
      await syncEnvelope(admin, token, doc.envelope_id as string);
      const again = await admin.from("employee_document").select("signed_storage_path").eq("id", doc.id).maybeSingle();
      path = (again.data?.signed_storage_path as string | null) ?? null;
    }
  }
  if (!path) return json({ error: "missing_file" }, 404);
  const batch = await ownedBatch(admin, tenantId, doc.batch_id as string);
  const { data: seller } = doc.seller_id
    ? await admin.from("store_seller").select("name").eq("id", doc.seller_id).maybeSingle()
    : { data: null };
  const download = seller?.name && batch
    ? deliveryFileName(doc.file_name as string, seller.name as string, Number(batch.month), Number(batch.year))
    : (doc.file_name as string);
  const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 10, { download });
  if (signed.error || !signed.data) return json({ error: "missing_file" }, 404);
  return json({ url: signed.data.signedUrl });
}
