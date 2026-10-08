/** AES-GCM decrypt  -  same scheme as Edge erp-credential-persist (SHA-256 key + iv.cipher base64). */

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function decryptPassword(ciphertext: string, secret: string): Promise<string> {
  const [ivB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !dataB64) throw new Error("invalid_ciphertext_format");

  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, ["decrypt"]);
  const iv = b64ToBytes(ivB64);
  const data = b64ToBytes(dataB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}
