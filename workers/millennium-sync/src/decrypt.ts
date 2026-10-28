/** AES-GCM — mesmo esquema das Edges (SHA-256 da chave + iv.cipher em base64). */

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function aesKey(secret: string, usage: "encrypt" | "decrypt") {
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, [usage]);
}

export async function decryptPassword(ciphertext: string, secret: string): Promise<string> {
  const [ivB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !dataB64) throw new Error("invalid_ciphertext_format");

  const key = await aesKey(secret, "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(dataB64));
  return new TextDecoder().decode(plain);
}

/** Cifra no mesmo formato do decryptPassword (para tokens OAuth Cielo). */
export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret, "encrypt");
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${bytesToB64(iv)}.${bytesToB64(cipher)}`;
}
