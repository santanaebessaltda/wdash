/** Lê o texto de cada página e monta um PDF só com as páginas pedidas. */
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { extractText } from "https://esm.sh/unpdf@0.12.2";

export async function readPdfPages(bytes: Uint8Array): Promise<{ pageCount: number; texts: string[]; hasText: boolean }> {
  const result = await extractText(bytes, { mergePages: false });
  const raw = result.text;
  const texts = Array.isArray(raw) ? raw.map((line) => String(line)) : [String(raw ?? "")];
  const pageCount = result.totalPages || texts.length;
  while (texts.length < pageCount) texts.push("");
  return { pageCount, texts, hasText: texts.some((text) => text.trim().length > 0) };
}

export async function buildPdf(
  sources: Uint8Array[],
  pages: Array<{ sourceIndex: number; pageNumber: number }>,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = await Promise.all(sources.map((bytes) => PDFDocument.load(bytes)));
  for (const page of pages) {
    const [copied] = await out.copyPages(loaded[page.sourceIndex], [page.pageNumber - 1]);
    out.addPage(copied);
  }
  return out.save();
}

/** Tira uma página (1-based) e devolve o PDF que sobrou. */
export async function withoutPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  pdf.removePage(pageNumber - 1);
  return pdf.save();
}
