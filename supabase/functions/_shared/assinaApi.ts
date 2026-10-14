/** Cliente HTTP do Assina AI. O token não sai da função. */
const BASE = "https://api.assinaai.com/api/v1";

export type AssinaEnvelope = {
  id?: string;
  status?: string;
  signatures?: Array<{ id?: string; recipient?: { id?: string } }>;
  file?: { s3TempFileName?: string; signedDocumentUrl?: string; documentUrl?: string };
};

async function call(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
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

export async function assinaCreateEnvelope(
  token: string,
  file: Uint8Array,
  fileName: string,
  envelope: unknown,
): Promise<{ ok: true; body: AssinaEnvelope } | { ok: false; status: number }> {
  const form = new FormData();
  form.append("file", new Blob([file]), fileName);
  form.append("envelope", JSON.stringify(envelope));
  const res = await call(token, "/envelopes/create", { method: "POST", body: form });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: (await res.json()) as AssinaEnvelope };
}

export async function assinaResend(
  token: string,
  envelopeId: string,
  recipientId: string,
  body: { senderType: "EMAIL" | "WHATSAPP"; email?: string; phone?: string },
): Promise<boolean> {
  const res = await call(token, `/envelopes/resend-signer-link/${envelopeId}/${recipientId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function recipientIdOf(body: AssinaEnvelope): string | null {
  const first = body.signatures?.[0];
  return first?.recipient?.id ?? first?.id ?? null;
}

export function signedUrlOf(body: AssinaEnvelope): string | null {
  return body.file?.signedDocumentUrl ?? body.file?.s3TempFileName ?? body.file?.documentUrl ?? null;
}
