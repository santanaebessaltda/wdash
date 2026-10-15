import { getSupabase } from "@/lib/supabase";
import { DOCUMENT_COPY } from "./documentSplit";

export type DocumentRow = {
  id: string;
  batchId: string;
  storeId: string | null;
  sellerId: string | null;
  status: "UNASSIGNED" | "PENDING" | "SIGNED" | "DECLINED" | "EXPIRED";
  fileName: string;
  error: string | null;
  envelopeId: string | null;
  sizeBytes: number;
  pageCount: number;
  createdAt: string;
};

export type BatchRow = {
  id: string;
  storeId: string | null;
  month: number;
  year: number;
  category: string;
  channel: "EMAIL" | "WHATSAPP" | null;
  deadline: string | null;
  createdAt: string;
};

export type PersonRow = { id: string; storeId: string; name: string; cpf: string | null; email: string | null; whatsapp: string | null; active: boolean; inErp: boolean };

type Invoke = { message?: string; error?: string; status?: string; batchId?: string; path?: string; token?: string; url?: string; refused?: { name: string; message: string }[]; results?: { id: string; error: string | null }[] };

async function readInvoke(fn: string, body: Record<string, unknown>): Promise<Invoke> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase não configurado.");
  const { data, error } = await sb.functions.invoke<Invoke>(fn, { body });
  let payload: Invoke | null = data ?? null;
  if (error && typeof error === "object") {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = (await ctx.json()) as Invoke;
        payload = { ...parsed, ...(payload ?? {}) };
      } catch {
        /* o corpo já veio em data */
      }
    }
  }
  if (payload?.message) throw new Error(payload.message);
  if (error) throw new Error(error.message);
  return payload ?? {};
}

async function call(body: Record<string, unknown>): Promise<Invoke> {
  return readInvoke("documents", body);
}

export async function fetchAssinaStatus(): Promise<"connected" | "not_configured"> {
  const sb = getSupabase();
  if (!sb) return "not_configured";
  const { data } = await sb.functions.invoke<Invoke>("assina-credential-persist", { body: {} });
  return data?.status === "connected" ? "connected" : "not_configured";
}

export async function saveAssinaToken(token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const data = await readInvoke("assina-credential-persist", { token });
    if (data.status !== "connected") return { ok: false, message: DOCUMENT_COPY.badToken };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : DOCUMENT_COPY.badToken };
  }
}

export async function loadDocuments(tenantId: string, storeId: string | null): Promise<{
  batches: BatchRow[];
  documents: DocumentRow[];
  people: PersonRow[];
  stores: { id: string; name: string }[];
}> {
  const sb = getSupabase();
  if (!sb) return { batches: [], documents: [], people: [], stores: [] };
  const [batches, documents, people, stores] = await Promise.all([
    sb.from("document_batch").select("id, store_id, month, year, category, channel, deadline, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    sb.from("employee_document").select("id, batch_id, store_id, seller_id, status, file_name, error, envelope_id, size_bytes, page_count, created_at").eq("tenant_id", tenantId).order("created_at"),
    sb.from("store_seller").select("id, store_id, name, cpf, email, whatsapp, active, in_erp").eq("tenant_id", tenantId).order("name").limit(2000),
    sb.from("store").select("id, name").eq("tenant_id", tenantId).order("name"),
  ]);
  const inStore = (id: string | null) => !storeId || id === storeId;
  return {
    batches: ((batches.data ?? []) as Record<string, unknown>[])
      .filter((row) => inStore(row.store_id as string | null))
      .map(mapBatch),
    documents: ((documents.data ?? []) as Record<string, unknown>[]).filter((row) => inStore((row.store_id as string | null) ?? storeId)).map(mapDoc),
    people: ((people.data ?? []) as Record<string, unknown>[]).filter((row) => inStore(row.store_id as string)).map(mapPerson),
    stores: ((stores.data ?? []) as { id: string; name: string }[]).filter((row) => inStore(row.id)),
  };
}

function mapBatch(row: Record<string, unknown>): BatchRow {
  return {
    id: String(row.id),
    storeId: (row.store_id as string | null) ?? null,
    month: Number(row.month),
    year: Number(row.year),
    category: String(row.category),
    channel: row.channel === "EMAIL" || row.channel === "WHATSAPP" ? row.channel : null,
    deadline: (row.deadline as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapDoc(row: Record<string, unknown>): DocumentRow {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    storeId: (row.store_id as string | null) ?? null,
    sellerId: (row.seller_id as string | null) ?? null,
    status: row.status as DocumentRow["status"],
    fileName: String(row.file_name),
    error: (row.error as string | null) ?? null,
    envelopeId: (row.envelope_id as string | null) ?? null,
    sizeBytes: Number(row.size_bytes ?? 0),
    pageCount: Number(row.page_count ?? 1),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapPerson(row: Record<string, unknown>): PersonRow {
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    name: String(row.name),
    cpf: (row.cpf as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    whatsapp: (row.whatsapp as string | null) ?? null,
    active: row.active !== false,
    inErp: row.in_erp !== false,
  };
}

export type PrepareStatus =
  | { phase: "upload"; index: number; total: number; name: string }
  | { phase: "read" }
  | { phase: "review" };

export async function prepareFiles(input: {
  storeId: string | null;
  month: number;
  year: number;
  category: string;
  title?: string;
  unify: boolean;
  files: File[];
  onProgress?: (status: PrepareStatus) => void;
}): Promise<{ batchId: string; refused: { name: string; message: string }[] }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase não configurado.");
  let batchId = "";
  const sources: { path: string; name: string }[] = [];
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    input.onProgress?.({ phase: "upload", index: index + 1, total: input.files.length, name: file.name });
    const slot = await call({
      action: "upload",
      batchId,
      storeId: input.storeId,
      month: input.month,
      year: input.year,
      category: input.category,
      unify: input.unify,
    });
    if (!slot.path || !slot.token || !slot.batchId) throw new Error(slot.message ?? "Não foi possível abrir o upload.");
    batchId = slot.batchId;
    const up = await sb.storage.from("documents").uploadToSignedUrl(slot.path, slot.token, file);
    if (up.error) throw new Error(up.error.message);
    sources.push({ path: slot.path, name: file.name });
  }
  input.onProgress?.({ phase: "read" });
  const prepared = await call({ action: "prepare", batchId, sources, title: input.title });
  return { batchId, refused: prepared.refused ?? [] };
}

export async function dropDocumentPage(documentId: string, pageNumber: number) {
  await call({ action: "drop-page", documentId, pageNumber });
}

export async function assignDocument(documentId: string, sellerId: string) {
  await call({ action: "assign", documentId, sellerId });
}

export async function saveEmployeeContact(input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) {
  await call({ action: "save-contact", ...input });
}

export async function confirmBatch(input: {
  batchId: string;
  deadline: string;
  reminder: string;
  documents: {
    id: string;
    channel: "EMAIL" | "WHATSAPP";
    marks: { pageNumber: number; x: number; y: number; element: "SIGNATURE" | "RUBRIC" }[];
    deadline?: string;
    reminder?: string;
    extraSigner?: { name: string; channel: "EMAIL" | "WHATSAPP"; email: string | null; whatsapp: string | null; marks: { pageNumber: number; x: number; y: number; element: "SIGNATURE" | "RUBRIC" }[] } | null;
    extraSigners?: { name: string; channel: "EMAIL" | "WHATSAPP"; email: string | null; whatsapp: string | null; marks: { pageNumber: number; x: number; y: number; element: "SIGNATURE" | "RUBRIC" }[] }[];
  }[];
  extraSigner: { name: string; channel: "EMAIL" | "WHATSAPP"; email: string | null; whatsapp: string | null; marks: { pageNumber: number; x: number; y: number; element: "SIGNATURE" | "RUBRIC" }[] } | null;
}) {
  return call({ action: "confirm", ...input });
}

export async function resendDocument(documentId: string) {
  const data = await call({ action: "resend", documentId });
  if (data.message) throw new Error(data.message);
}

export async function openDocument(documentId: string): Promise<string> {
  const data = await call({ action: "open", documentId });
  if (!data.url) throw new Error("O arquivo ainda não está disponível.");
  return data.url;
}
