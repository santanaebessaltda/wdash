/**
 * XLSX minimo (1 aba) para arquivos de importacao no Millennium  -  mesmo esqueleto do exemplo exportado pelo Google
 * (sharedStrings + estilo de celula Texto, numFmt 49). ZIP sem compressao (metodo 0): todo leitor de XLSX aceita.
 */

export type XlsxCell = string | number;

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetParts(rows: XlsxCell[][], textColumns: number[]): { sheet: string; sst: string } {
  const strings: string[] = [];
  const index = new Map<string, number>();
  let refs = 0;
  const textCols = new Set(textColumns);
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const style = textCols.has(c) ? ' s="1"' : "";
          if (typeof v === "number") return `<c r="${ref}"${style}><v>${v}</v></c>`;
          let i = index.get(v);
          if (i === undefined) {
            i = strings.push(v) - 1;
            index.set(v, i);
          }
          refs++;
          return `<c r="${ref}"${style} t="s"><v>${i}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return {
    sheet: `${HEAD}<worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetData>${body}</sheetData></worksheet>`,
    sst: `${HEAD}<sst xmlns="${NS}" count="${refs}" uniqueCount="${strings.length}">${strings
      .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
      .join("")}</sst>`,
  };
}

const STYLES =
  `${HEAD}<styleSheet xmlns="${NS}">` +
  '<fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

function packageFiles(sheet: string, sst: string, sheetName: string): Array<[string, string]> {
  const ct = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  return [
    [
      "[Content_Types].xml",
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="${ct}.sharedStrings+xml"/>` +
        "</Types>",
    ],
    [
      "_rels/.rels",
      `${HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `${HEAD}<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
        "</Relationships>",
    ],
    ["xl/styles.xml", STYLES],
    ["xl/sharedStrings.xml", sst],
    ["xl/worksheets/sheet1.xml", sheet],
  ];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP sem compressao; data fixa 01/01/1980 (o conteudo nao depende do relogio). */
function zipStore(files: Array<[string, Uint8Array]>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

export function buildXlsx(rows: XlsxCell[][], opts: { textColumns?: number[]; sheetName?: string } = {}): Uint8Array {
  const { sheet, sst } = sheetParts(rows, opts.textColumns ?? []);
  const enc = new TextEncoder();
  return zipStore(packageFiles(sheet, sst, opts.sheetName ?? "Página1").map(([name, xml]) => [name, enc.encode(xml)]));
}

type ZipEntry = { name: string; method: number; data: Uint8Array };

function findEocd(buf: Uint8Array): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= start; i--) if (dv.getUint32(i, true) === 0x06054b50) return i;
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP de um xlsx (store ou deflate). Ignora entradas criptografadas. */
async function readZip(buf: Uint8Array): Promise<ZipEntry[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("not-xlsx");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("not-xlsx");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error("not-xlsx");
    const start = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
    const compressed = buf.slice(start, start + compSize);
    if ((flags & 1) !== 0) throw new Error("not-xlsx");
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (!data) throw new Error("not-xlsx");
    out.push({ name, method, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const xmlText = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function zipText(entries: ZipEntry[], name: string): string | null {
  const hit = entries.find((e) => e.name.replace(/\\/g, "/") === name);
  return hit ? new TextDecoder().decode(hit.data) : null;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => {
    const body = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join("");
  });
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Primeira aba como grade de texto. Número vira o texto da célula (`72`, `182`). */
function sheetRows(xml: string, strings: string[]): string[][] {
  const grid = new Map<number, Map<number, string>>();
  let maxRow = -1;
  let maxCol = -1;
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /r="([A-Z]+\d+)"/i.exec(cell[1])?.[1];
      if (!ref) continue;
      const r = Number(/\d+/.exec(ref)?.[0] ?? 1) - 1;
      const c = colIndex(ref);
      const type = /t="([^"]+)"/.exec(cell[1])?.[1] ?? "";
      const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cell[2]);
      const raw = inline ? [...inline[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join("") : (/<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? "");
      const value = type === "s" ? (strings[Number(raw)] ?? "") : xmlText(raw);
      const line = grid.get(r) ?? new Map<number, string>();
      line.set(c, value);
      grid.set(r, line);
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    }
  }
  const rows: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const line = grid.get(r);
    if (!line) continue;
    const cells: string[] = [];
    for (let c = 0; c <= maxCol; c++) cells.push(line.get(c) ?? "");
    if (cells.some((v) => v.trim() !== "")) rows.push(cells);
  }
  return rows;
}

function sheetFile(target: string): string {
  const path = target.replace(/\\/g, "/").replace(/^\//, "");
  return path.startsWith("xl/") ? path : `xl/${path}`;
}

/** Primeira aba visível. Aba oculta (configuração, backup) não entra. */
function firstSheetPath(entries: ZipEntry[]): string {
  const book = zipText(entries, "xl/workbook.xml");
  const rels = zipText(entries, "xl/_rels/workbook.xml.rels");
  const rel = new Map<string, string>();
  if (rels) {
    for (const tag of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(tag[0])?.[1];
      const target = /Target="([^"]+)"/.exec(tag[0])?.[1];
      if (id && target) rel.set(id, target);
    }
  }
  const paths: string[] = [];
  const visible: string[] = [];
  if (book) {
    for (const tag of book.matchAll(/<sheet\b[^>]*>/g)) {
      const rid = /r:id="([^"]+)"/.exec(tag[0])?.[1];
      const state = /state="([^"]+)"/.exec(tag[0])?.[1] ?? "visible";
      const target = rid ? rel.get(rid) : null;
      if (!target) continue;
      const path = sheetFile(target);
      paths.push(path);
      if (state === "visible") visible.push(path);
    }
  }
  return visible[0] ?? paths[0] ?? "xl/worksheets/sheet1.xml";
}

/** Lê a primeira aba visível de um .xlsx (o nosso, ou um Excel/Google com ZIP comprimido). */
export async function readXlsx(buf: Uint8Array): Promise<string[][]> {
  const entries = await readZip(buf);
  const sheet = zipText(entries, firstSheetPath(entries));
  if (!sheet) throw new Error("not-xlsx");
  const sst = zipText(entries, "xl/sharedStrings.xml");
  return sheetRows(sheet, sst ? sharedStrings(sst) : []);
}
