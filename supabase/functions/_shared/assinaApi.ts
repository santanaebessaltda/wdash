/** Cliente HTTP do Assina AI. O token não sai da função. */
const BASE = "https://api.assinaai.com/api/v1";

export type AssinaEnvelope = {
  id?: string;
  status?: string;
  signatures?: Array<{
    id?: string;
    status?: string;
    routingOrder?: number;
    recipient?: { id?: string; name?: string; routingOrder?: number; status?: string };
  }>;
  file?: { s3TempFileName?: string; signedDocumentUrl?: string; documentUrl?: string };
};

async function call(token: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init?.body != null && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return fetch(`${BASE}${path}`, { ...init, headers });
}

export async function assinaTokenWorks(token: string): Promise<boolean> {
  const res = await call(token, "/folders/list");
  return res.status === 200;
}

export async function assinaGetEnvelope(token: string, envelopeId: string): Promise<AssinaEnvelope | null> {
  const res = await call(token, `/envelopes/${envelopeId}`);
  if (!res.ok) return null;
  return (await res.json()) as AssinaEnvelope;
}

async function failureMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
    const text = message.trim();
    return text && text.length <= 240 ? text : null;
  } catch {
    return null;
  }
}

/** O create exige multipart: o PDF como application/pdf e o envelope como application/json. */
function envelopeBody(file: Uint8Array, fileName: string, envelope: unknown): { body: Uint8Array; contentType: string } {
  const boundary = `----wdash${crypto.randomUUID().replace(/-/g, "")}`;
  const enc = new TextEncoder();
  const safeName = fileName.replace(/[\r\n"]/g, "_") || "documento.pdf";
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="envelope"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(envelope)}\r\n--${boundary}--\r\n`,
  );
  const body = new Uint8Array(head.length + file.length + tail.length);
  body.set(head, 0);
  body.set(file, head.length);
  body.set(tail, head.length + file.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function assinaCreateEnvelope(
  token: string,
  file: Uint8Array,
  fileName: string,
  envelope: unknown,
): Promise<{ ok: true; body: AssinaEnvelope } | { ok: false; status: number; message: string | null }> {
  try {
    const packed = envelopeBody(file, fileName, envelope);
    const res = await call(token, "/envelopes/create", {
      method: "POST",
      body: packed.body,
      headers: { "Content-Type": packed.contentType },
    });
    if (!res.ok) return { ok: false, status: res.status, message: await failureMessage(res) };
    return { ok: true, body: (await res.json()) as AssinaEnvelope };
  } catch {
    return { ok: false, status: 0, message: null };
  }
}

function httpUrl(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  return /^https?:\/\/\S+$/.test(trimmed) ? trimmed : null;
}

function urlIn(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const direct = httpUrl(value);
    if (direct) return direct;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return urlIn(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = urlIn(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = urlIn(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function readSignerLink(token: string, path: string, method: "GET" | "POST"): Promise<{ url: string | null; ok: boolean }> {
  const res = await call(token, path, method === "POST" ? { method: "POST" } : undefined);
  const text = await res.text();
  const url = res.ok ? urlIn(text) ?? httpUrl(res.headers.get("location") ?? "") : null;
  return { url, ok: res.ok };
}

export async function assinaSignerLink(
  token: string,
  envelopeId: string,
  recipientId: string,
  channel?: "EMAIL" | "WHATSAPP" | null,
): Promise<string | null> {
  const paths = [`/envelopes/refresh-token-signer-email-link/${envelopeId}/${recipientId}`];
  if (channel === "WHATSAPP") paths.push(`/envelopes/refresh-token-signer-whatsapp-link/${envelopeId}/${recipientId}`);
  try {
    for (const path of paths) {
      const got = await readSignerLink(token, path, "GET");
      if (got.url) return got.url;
      if (got.ok) continue;
      const posted = await readSignerLink(token, path, "POST");
      if (posted.url) return posted.url;
    }
    return null;
  } catch {
    return null;
  }
}

export async function assinaCancelEnvelope(token: string, envelopeId: string): Promise<boolean> {
  try {
    const res = await call(token, `/envelopes/soft-delete/${envelopeId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function assinaResend(
  token: string,
  envelopeId: string,
  recipientId: string,
  body: { senderType: "EMAIL" | "WHATSAPP"; email?: string; phone?: string },
): Promise<boolean> {
  try {
    const res = await call(token, `/envelopes/resend-signer-link/${envelopeId}/${recipientId}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function recipientIdOf(body: AssinaEnvelope): string | null {
  const first = body.signatures?.[0];
  return first?.recipient?.id ?? first?.id ?? null;
}

/** Só o PDF concluído do Assina. documentUrl e o arquivo temporário são o original, sem o certificado. */
export function signedUrlOf(body: AssinaEnvelope): string | null {
  const url = body.file?.signedDocumentUrl?.trim() ?? "";
  return url.startsWith("http://") || url.startsWith("https://") ? url : null;
}

export async function downloadSignedPdf(token: string, url: string): Promise<Uint8Array | null> {
  const attempts: Array<HeadersInit | undefined> = [undefined, { Authorization: `Bearer ${token}` }];
  for (const headers of attempts) {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return bytes;
    } catch {
      /* a próxima tentativa usa o token, se a URL exigir */
    }
  }
  return null;
}
