/**
 * documents — corte, revisão, envio, reenvio e abertura. Só o Gestor.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";
import { buildPdf, readPdfPages, withoutPage } from "../_shared/pdfPages.ts";
import { assinaCancelEnvelope, assinaCreateEnvelope, assinaResend, assinaSignerLink } from "../_shared/assinaApi.ts";
import { loadCompanyToken } from "../_shared/assinaSync.ts";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  asAuthentication,
  asReminder,
  assignSeller,
  channelBlock,
  collaboratorRecipientId,
  confirmBlock,
  contactPatch,
  customDocumentName,
  defaultSignatureMark,
  deliveryFileName,
  signatureDeadlineAt,
  envelopeSignatures,
  fileName,
  groupPages,
  placementWarning,
  resendVisible,
  shouldSend,
  sourceRefusal,
  type DocStatus,
  type ExtraSigner,
  type SendChannel,
  type SignatureMark,
} from "../../../src/data/wedash/documentSplit.ts";

const BUCKET = "documents";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asChannel(value: unknown): SendChannel | null {
  return value === "EMAIL" || value === "WHATSAPP" ? value : null;
}

function storedMarks(value: unknown): SignatureMark[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const mark = item as Record<string, unknown>;
    const pageNumber = Number(mark.pageNumber);
    const x = Number(mark.x);
    const y = Number(mark.y);
    if (!Number.isInteger(pageNumber) || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ pageNumber, x, y, element: mark.element === "RUBRIC" ? ("RUBRIC" as const) : ("SIGNATURE" as const) }];
  });
}

function storedExtra(value: unknown): ExtraSigner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const channel = asChannel(raw.channel);
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!channel || !name.trim()) return null;
  return {
    name,
    channel,
    email: typeof raw.email === "string" ? raw.email : null,
    whatsapp: typeof raw.whatsapp === "string" ? raw.whatsapp : null,
    marks: storedMarks(raw.marks),
    authentication: asAuthentication(raw.authentication),
  };
}

function storedExtras(value: unknown): ExtraSigner[] | null {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const parsed = value.map((item) => storedExtra(item));
    if (parsed.some((item) => !item)) return null;
    return parsed.filter((item): item is ExtraSigner => Boolean(item));
  }
  const one = storedExtra(value);
  return one ? [one] : null;
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
  if (action === "drop-page") return dropPage(admin, caller.tenantId, body);
  if (action === "delete") return removeDocument(admin, caller.tenantId, body);
  if (action === "save-contact") return saveContact(admin, caller.tenantId, body);
  if (action === "confirm") return confirm(admin, caller.tenantId, erpSecret, body);
  if (action === "resend") return resend(admin, caller.tenantId, erpSecret, body);
  if (action === "copy-link") return copyLink(admin, caller.tenantId, erpSecret, body);
  if (action === "cancel") return cancelDocument(admin, caller.tenantId, erpSecret, body);
  if (action === "move") return moveDocument(admin, caller.tenantId, body);
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
  const merged = groups.filter((group) => new Set(group.pages.map((page) => page.sourceIndex)).size > 1).length;
  return json({ batchId, created, refused, merged });
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
  if (!sellerId) {
    await admin.from("employee_document").update({ seller_id: null, store_id: null, status: "UNASSIGNED", error: null }).eq("id", documentId);
    return json({ ok: true });
  }
  const { data: seller } = await admin.from("store_seller").select("id, store_id").eq("id", sellerId).eq("tenant_id", tenantId).maybeSingle();
  if (!seller) return json({ error: "not_found" }, 404);
  await admin.from("employee_document").update({ seller_id: sellerId, store_id: seller.store_id, error: null }).eq("id", documentId);
  return json({ ok: true });
}

async function removeDocument(admin: SupabaseClient, tenantId: string, body: Body) {
  const documentId = String(body.documentId ?? "");
  const { data: doc } = await admin.from("employee_document").select("id, envelope_id, storage_path").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) return json({ error: "not_found" }, 404);
  if (doc.envelope_id) return json({ message: DOCUMENT_COPY.alreadySent }, 422);
  await admin.storage.from(BUCKET).remove([doc.storage_path as string]);
  const { error } = await admin.from("employee_document").delete().eq("id", documentId).eq("tenant_id", tenantId);
  if (error) return json({ error: "persist" }, 500);
  return json({ ok: true });
}

async function dropPage(admin: SupabaseClient, tenantId: string, body: Body) {
  const documentId = String(body.documentId ?? "");
  const pageNumber = Number(body.pageNumber);
  const { data: doc } = await admin.from("employee_document").select("id, envelope_id, storage_path, page_count").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) return json({ error: "not_found" }, 404);
  if (doc.envelope_id) return json({ message: DOCUMENT_COPY.alreadySent }, 422);
  const pageCount = Number(doc.page_count) || 1;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) return json({ error: "invalid_page" }, 400);
  const path = doc.storage_path as string;
  if (pageCount === 1) {
    await admin.storage.from(BUCKET).remove([path]);
    const { error } = await admin.from("employee_document").delete().eq("id", documentId).eq("tenant_id", tenantId);
    if (error) return json({ error: "persist" }, 500);
    return json({ ok: true, removed: true });
  }
  const file = await admin.storage.from(BUCKET).download(path);
  if (file.error || !file.data) return json({ message: "Não foi possível ler o PDF." }, 422);
  let pdf: Uint8Array;
  try {
    pdf = await withoutPage(new Uint8Array(await file.data.arrayBuffer()), pageNumber);
  } catch {
    return json({ message: "Não foi possível apagar esta página." }, 422);
  }
  const up = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) return json({ error: "persist" }, 500);
  const { error } = await admin.from("employee_document").update({ page_count: pageCount - 1, size_bytes: pdf.byteLength, error: null }).eq("id", documentId);
  if (error) return json({ error: "persist" }, 500);
  return json({ ok: true, removed: false, pageCount: pageCount - 1 });
}

async function saveContact(admin: SupabaseClient, tenantId: string, body: Body) {
  const sellerId = String(body.sellerId ?? "");
  const { data: seller } = await admin.from("store_seller").select("id").eq("id", sellerId).eq("tenant_id", tenantId).maybeSingle();
  if (!seller) return json({ error: "not_found" }, 404);
  const input: { cpf?: string; email?: string; whatsapp?: string } = {};
  if ("cpf" in body) input.cpf = String(body.cpf ?? "");
  if ("email" in body) input.email = String(body.email ?? "");
  if ("whatsapp" in body) input.whatsapp = String(body.whatsapp ?? "");
  const saved = contactPatch(input);
  if (!saved.ok) return json({ message: saved.message }, 422);
  if (Object.keys(saved.patch).length === 0) return json({ ok: true });
  const { error } = await admin.from("store_seller").update(saved.patch).eq("id", sellerId);
  if (error) return json({ error: "persist" }, 500);
  return json({ ok: true, ...saved.patch });
}

async function confirm(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const batch = await ownedBatch(admin, tenantId, String(body.batchId ?? ""));
  if (!batch) return json({ error: "not_found" }, 404);
  const fallbackChannel = asChannel(body.channel);
  const deadline = typeof body.deadline === "string" && body.deadline ? body.deadline : null;
  const reminder = asReminder(body.reminder) ?? "EVERY_3_DAYS";
  const token = await loadCompanyToken(admin, tenantId, secret);
  const batchPatch: { deadline: string | null; reminder: string; extra_signer?: ExtraSigner | null } = { deadline, reminder };
  if ("extraSigner" in body) batchPatch.extra_signer = body.extraSigner == null ? null : storedExtra(body.extraSigner);
  await admin.from("document_batch").update(batchPatch).eq("id", batch.id);
  const authenticationById = new Map<string, ReturnType<typeof asAuthentication>>();
  if (Array.isArray(body.documents)) {
    for (const item of body.documents) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const channel = asChannel(row.channel);
      if (!id || !channel) continue;
      authenticationById.set(id, asAuthentication(row.authentication));
      const patch: Record<string, unknown> = { channel, marks: storedMarks(row.marks) };
      if ("deadline" in row) patch.deadline = typeof row.deadline === "string" && row.deadline ? row.deadline.slice(0, 10) : null;
      if ("reminder" in row) patch.reminder = asReminder(row.reminder);
      if ("extraSigner" in row || "extraSigners" in row) {
        const provided = "extraSigners" in row ? row.extraSigners : row.extraSigner;
        if (provided == null) patch.extra_signer = null;
        else if (Array.isArray(provided)) {
          patch.extra_signer = provided.flatMap((item) => {
            const parsed = storedExtra(item);
            return parsed ? [parsed] : [];
          });
        } else patch.extra_signer = storedExtra(provided) ?? provided;
      }
      await admin.from("employee_document").update(patch).eq("id", id).eq("batch_id", batch.id);
    }
  }
  const storedBatch = await ownedBatch(admin, tenantId, batch.id as string);
  const extra = storedExtra(storedBatch?.extra_signer);

  const { data: docs } = await admin.from("employee_document").select("*").eq("batch_id", batch.id);
  const results: { id: string; error: string | null }[] = [];
  for (const doc of docs ?? []) {
    if (doc.removed_at) continue;
    try {
    const channel = asChannel(doc.channel) ?? fallbackChannel;
    const pageCount = Number(doc.page_count) || 1;
    const savedMarks = storedMarks(doc.marks);
    const marks = savedMarks.length > 0 ? savedMarks : [defaultSignatureMark(pageCount)];
    const docReminder = asReminder(doc.reminder) ?? reminder;
    const signatureDeadline = signatureDeadlineAt(new Date());
    const parsedDocExtra = storedExtras(doc.extra_signer);
    const extraInvalid = doc.extra_signer != null && parsedDocExtra == null ? "Informe o nome do signatário." : null;
    const block = confirmBlock({ deadline: null, hasToken: Boolean(token), sizeBytes: doc.size_bytes as number });
    let seller: { name: string; email: string | null; whatsapp: string | null; cpf: string | null } | null = null;
    if (doc.seller_id) {
      const { data } = await admin.from("store_seller").select("name, email, whatsapp, cpf").eq("id", doc.seller_id).maybeSingle();
      seller = data;
    }
    const missingChannel = channel ? null : "Escolha WhatsApp ou e-mail.";
    const contactBlock = channel ? channelBlock(channel, { email: seller?.email ?? null, whatsapp: seller?.whatsapp ?? null }) : null;
    const placeBlock = savedMarks.length > 0 ? placementWarning(savedMarks, pageCount) : null;
    const chosenExtras = doc.extra_signer != null ? (parsedDocExtra ?? []) : extra ? [extra] : [];
    const extraForDocs = chosenExtras.map((item) => ({
      ...item,
      marks: item.marks.length > 0 ? item.marks : [defaultSignatureMark(pageCount)],
    }));
    const extraContact = extraForDocs
      .map((item) => channelBlock(item.channel, { email: item.email, whatsapp: item.whatsapp }))
      .find((item) => item) ?? null;
    const extraPlace = chosenExtras
      .map((item) => (item.marks.length > 0 ? placementWarning(item.marks, pageCount) : null))
      .find((item) => item) ?? null;
    const rowBlock = block ?? missingChannel ?? (doc.seller_id ? contactBlock : null) ?? placeBlock ?? extraInvalid ?? extraContact ?? extraPlace;
    if (!shouldSend({ envelopeId: (doc.envelope_id as string | null) ?? null, sellerId: (doc.seller_id as string | null) ?? null, block: rowBlock })) {
      const quiet = !doc.seller_id || Boolean(doc.envelope_id);
      if (!quiet && rowBlock) await admin.from("employee_document").update({ error: rowBlock }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: quiet ? null : rowBlock });
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
      signatures: envelopeSignatures({
        seller,
        channel,
        authentication: authenticationById.get(doc.id as string) ?? "DEFAULT_SIGN",
        marks,
        pageCount,
        extras: extraForDocs,
      }),
      documentSendConfig: {
        documentName: sentName,
        customEmailMessage: "",
        signatureDeadline,
        sendReminders: docReminder,
        observers: [],
      },
      status: "SENT_FOR_SIGNATURE",
      folderId: null,
    });
    if (!created.ok || !created.body.id) {
      const message = created.ok
        ? "O Assina AI não devolveu a confirmação do envio."
        : created.message ?? (created.status ? "Não foi possível iniciar a assinatura deste documento." : "Não foi possível conectar ao Assina AI.");
      await admin.from("employee_document").update({ error: message }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: message });
      continue;
    }
    await admin
      .from("employee_document")
      .update({
        status: "PENDING",
        channel,
        envelope_id: created.body.id,
        recipient_id: collaboratorRecipientId(created.body.signatures),
        sent_at: new Date().toISOString(),
        deadline: signatureDeadline.slice(0, 10),
        error: null,
      })
      .eq("id", doc.id);
    results.push({ id: doc.id as string, error: null });
    } catch {
      const message = "Não foi possível conectar ao Assina AI.";
      await admin.from("employee_document").update({ error: message }).eq("id", doc.id);
      results.push({ id: doc.id as string, error: message });
    }
  }
  return json({ results });
}

async function resend(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const { data: doc } = await admin.from("employee_document").select("*").eq("id", String(body.documentId ?? "")).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || doc.removed_at || !resendVisible(doc.status as DocStatus) || !doc.envelope_id || !doc.recipient_id) return json({ error: "not_found" }, 404);
  const batch = await ownedBatch(admin, tenantId, doc.batch_id as string);
  const channel = asChannel(doc.channel) ?? asChannel(batch?.channel);
  if (!batch || !channel) return json({ error: "not_found" }, 404);
  const token = await loadCompanyToken(admin, tenantId, secret);
  const { data: seller } = await admin.from("store_seller").select("email, whatsapp").eq("id", doc.seller_id).maybeSingle();
  if (!token || !seller) return json({ message: "Não foi possível reenviar o link. Tente novamente." }, 502);
  const ok = await assinaResend(token, doc.envelope_id as string, doc.recipient_id as string, {
    senderType: channel,
    email: channel === "EMAIL" ? (seller.email as string) : undefined,
    phone: channel === "WHATSAPP" ? (seller.whatsapp as string) : undefined,
  });
  if (!ok) {
    await admin.from("employee_document").update({ error: "Não foi possível reenviar o link. Tente novamente." }).eq("id", doc.id);
    return json({ message: "Não foi possível reenviar o link. Tente novamente." }, 502);
  }
  await admin.from("employee_document").update({ error: null }).eq("id", doc.id);
  return json({ ok: true });
}

async function copyLink(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const { data: doc } = await admin.from("employee_document").select("status, envelope_id, recipient_id, removed_at").eq("id", String(body.documentId ?? "")).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || doc.removed_at || !resendVisible(doc.status as DocStatus) || !doc.envelope_id || !doc.recipient_id) return json({ message: "Não foi possível copiar o link. Tente novamente." }, 404);
  const token = await loadCompanyToken(admin, tenantId, secret);
  if (!token) return json({ message: DOCUMENT_COPY.noToken }, 422);
  const url = await assinaSignerLink(token, doc.envelope_id as string, doc.recipient_id as string);
  if (!url) return json({ message: "Não foi possível copiar o link. Tente novamente." }, 502);
  return json({ url });
}

async function cancelDocument(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const { data: doc } = await admin.from("employee_document").select("id, status, envelope_id, removed_at").eq("id", String(body.documentId ?? "")).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || doc.removed_at || !resendVisible(doc.status as DocStatus) || !doc.envelope_id) return json({ message: "Não foi possível excluir o documento. Tente novamente." }, 404);
  const token = await loadCompanyToken(admin, tenantId, secret);
  if (!token) return json({ message: DOCUMENT_COPY.noToken }, 422);
  const ok = await assinaCancelEnvelope(token, doc.envelope_id as string);
  if (!ok) return json({ message: "Não foi possível excluir o documento. Tente novamente." }, 502);
  const { error } = await admin.from("employee_document").update({ removed_at: new Date().toISOString(), error: null }).eq("id", doc.id);
  if (error) return json({ message: "Não foi possível excluir o documento. Tente novamente." }, 500);
  return json({ ok: true });
}

async function moveDocument(admin: SupabaseClient, tenantId: string, body: Body) {
  const documentId = String(body.documentId ?? "");
  const sellerId = String(body.sellerId ?? "");
  const month = Number(body.month);
  const year = Number(body.year);
  const { data: doc } = await admin.from("employee_document").select("id, batch_id, status, envelope_id, removed_at").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || doc.removed_at || !resendVisible(doc.status as DocStatus) || !doc.envelope_id) return json({ message: "Só um documento pendente pode ser movido." }, 422);
  const { data: seller } = await admin.from("store_seller").select("id, store_id").eq("id", sellerId).eq("tenant_id", tenantId).maybeSingle();
  const { data: batch } = await admin.from("document_batch").select("category, unify").eq("id", doc.batch_id).eq("tenant_id", tenantId).maybeSingle();
  if (!seller || !batch) return json({ message: "Não foi possível mover o documento. Tente novamente." }, 404);
  if (!Number.isInteger(month) || month < 1 || month > 12) return json({ message: "Não foi possível mover o documento. Tente novamente." }, 400);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return json({ message: "Informe um ano válido." }, 400);
  const { data: found } = await admin
    .from("document_batch")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("store_id", seller.store_id)
    .eq("month", month)
    .eq("year", year)
    .eq("category", batch.category)
    .limit(1);
  let batchId = found?.[0]?.id as string | undefined;
  if (!batchId) {
    const { data: created, error } = await admin
      .from("document_batch")
      .insert({ tenant_id: tenantId, store_id: seller.store_id, month, year, category: batch.category, unify: batch.unify })
      .select("id")
      .single();
    if (error || !created) return json({ message: "Não foi possível mover o documento. Tente novamente." }, 500);
    batchId = created.id as string;
  }
  const { error } = await admin.from("employee_document").update({ batch_id: batchId, seller_id: sellerId, store_id: seller.store_id, error: null }).eq("id", documentId);
  if (error) return json({ message: "Não foi possível mover o documento. Tente novamente." }, 500);
  return json({ ok: true });
}

async function openFile(admin: SupabaseClient, tenantId: string, secret: string, body: Body) {
  const { data: doc } = await admin.from("employee_document").select("*").eq("id", String(body.documentId ?? "")).eq("tenant_id", tenantId).maybeSingle();
  if (!doc || doc.removed_at) return json({ message: "O arquivo ainda não está disponível." }, 404);
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
