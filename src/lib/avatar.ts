const LADO = 512;

export const AVATAR_TIPOS = "image/jpeg,image/png,image/webp";

/** Recorta no centro (quadrado) e reduz para 512px em JPEG  -  foto de celular vira poucos KB. */
export async function prepararAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const lado = Math.min(bitmap.width, bitmap.height);
  const destino = Math.min(LADO, lado);
  const canvas = document.createElement("canvas");
  canvas.width = destino;
  canvas.height = destino;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, destino, destino);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
}
