/** AES-GCM no mesmo formato da senha do shopping: iv.cipher em base64. */

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keyFrom(secret: string, usage: "encrypt" | "decrypt") {
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, [usage]);
}

export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(secret, "encrypt");
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${b64(iv)}.${b64(cipher)}`;
}

export async function decryptSecret(packed: string, secret: string): Promise<string> {
  const [iv, cipher] = packed.split(".");
  const key = await keyFrom(secret, "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(cipher));
  return new TextDecoder().decode(plain);
}
