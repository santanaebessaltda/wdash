import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, readXlsx } from "./xlsx";

type Entry = { name: string; data: Uint8Array; crc: number; method: number };

/** Le um ZIP pelo diretorio central (independente do escritor). */
function readZip(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("sem EOCD");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    out.push({ name, data: buf.subarray(start, start + size), crc, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const text = (entries: Entry[], name: string) => new TextDecoder().decode(entries.find((e) => e.name === name)!.data);

const ROWS: Array<Array<string | number>> = [
  ["COD_PRODUTO", "Cod_Cor", "Cod_Estampa", "Tamanho", "Quantidade", "Total em Estoque", "Descricao"],
  ["OLEBOS-ATH-001", "000", "000", "U", 120, 1, "ÓLEO BOOSTER REPAIR 30ML - WEPINK"],
  [526, "000", "000", "U", 24, 0, "A & B <C> \"D\""],
];

describe("buildXlsx", () => {
  const entries = readZip(buildXlsx(ROWS, { textColumns: [1, 2, 3] }));

  it("gera as 7 partes do pacote com CRC-32 correto", () => {
    expect(entries.map((e) => e.name).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/_rels/workbook.xml.rels",
        "xl/sharedStrings.xml",
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
      ].sort(),
    );
    for (const e of entries) expect(e.crc).toBe(crc32(e.data));
  });

  it("strings vão para sharedStrings (t=\"s\") e números como valor", () => {
    const sheet = text(entries, "xl/worksheets/sheet1.xml");
    const sst = text(entries, "xl/sharedStrings.xml");
    const strings = [...sst.matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map((m) => m[1]);
    const cell = (ref: string) => sheet.match(new RegExp(`<c r="${ref}"([^>]*)>(?:<v>([^<]*)</v>)?</c>`))!;
    const a2 = cell("A2");
    expect(a2[1]).toContain('t="s"');
    expect(strings[Number(a2[2])]).toBe("OLEBOS-ATH-001");
    const a3 = cell("A3");
    expect(a3[1]).not.toContain('t="s"');
    expect(a3[2]).toBe("526");
    expect(cell("E2")[2]).toBe("120");
    expect(cell("E2")[1]).not.toContain('t="s"');
  });

  it("colunas de texto usam o estilo com formato Texto (numFmt 49), inclusive \"000\"", () => {
    const styles = text(entries, "xl/styles.xml");
    const xfs = [...styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)![1].matchAll(/<xf [^>]*>/g)].map((m) => m[0]);
    const sheet = text(entries, "xl/worksheets/sheet1.xml");
    const styleOf = (ref: string) => Number(sheet.match(new RegExp(`<c r="${ref}" s="(\\d+)"`))?.[1] ?? 0);
    for (const ref of ["B2", "C2", "D2", "B3"]) expect(xfs[styleOf(ref)]).toContain('numFmtId="49"');
    for (const ref of ["A2", "E2", "G2"]) expect(xfs[styleOf(ref)]).not.toContain('numFmtId="49"');
  });

  it("escapa &, <, > e aspas e mantém acentos em UTF-8", () => {
    const sst = text(entries, "xl/sharedStrings.xml");
    expect(sst).toContain("A &amp; B &lt;C&gt; &quot;D&quot;");
    expect(sst).toContain("ÓLEO BOOSTER REPAIR 30ML - WEPINK");
  });

  it("aba e partes ligadas (workbook → sheet1, styles, sharedStrings)", () => {
    expect(text(entries, "xl/workbook.xml")).toContain('<sheet name="Página1" sheetId="1" r:id="rId1"/>');
    const rels = text(entries, "xl/_rels/workbook.xml.rels");
    expect(rels).toContain('Target="worksheets/sheet1.xml"');
    expect(rels).toContain('Target="styles.xml"');
    expect(rels).toContain('Target="sharedStrings.xml"');
    expect(text(entries, "[Content_Types].xml")).toContain('PartName="/xl/worksheets/sheet1.xml"');
  });
});

/** Reempacota o xlsx com deflate, como o Excel faz. */
function zipDeflate(stored: Uint8Array): Uint8Array {
  const dv = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
  let eocd = stored.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files: Array<{ name: Uint8Array; raw: Uint8Array; crc: number }> = [];
  for (let i = 0; i < count; i++) {
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = stored.slice(p + 46, p + 46 + nameLen);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    files.push({ name, raw: stored.slice(start, start + size), crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const data = deflateRawSync(file.raw);
    const local = new Uint8Array(30 + file.name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, file.crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, file.raw.length, true);
    lv.setUint16(26, file.name.length, true);
    local.set(file.name, 30);
    const central = new Uint8Array(46 + file.name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, file.crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, file.raw.length, true);
    cv.setUint16(28, file.name.length, true);
    cv.setUint32(42, offset, true);
    central.set(file.name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function storeZip(files: Array<[string, string]>): Uint8Array {
  const encoded = files.map(([name, body]) => ({ name: new TextEncoder().encode(name), raw: new TextEncoder().encode(body), crc: crc32(body) }));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of encoded) {
    const local = new Uint8Array(30 + file.name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, file.crc, true);
    lv.setUint32(18, file.raw.length, true);
    lv.setUint32(22, file.raw.length, true);
    lv.setUint16(26, file.name.length, true);
    local.set(file.name, 30);
    const central = new Uint8Array(46 + file.name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, file.crc, true);
    cv.setUint32(20, file.raw.length, true);
    cv.setUint32(24, file.raw.length, true);
    cv.setUint16(28, file.name.length, true);
    cv.setUint32(42, offset, true);
    central.set(file.name, 46);
    locals.push(local, file.raw);
    centrals.push(central);
    offset += local.length + file.raw.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function inlineSheet(cells: string): string {
  return `<?xml version="1.0"?><worksheet xmlns="${SHEET_NS}"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`;
}

describe("readXlsx", () => {
  const sheet = [
    ["COD_PRODUTO", "Descricao1", "Quantidade minin", "Saldo"],
    [182, "BODY SPLASH FATAL ROUGE 200 ML - WEPINK", 72, 0],
    [185, "BODY SPLASH DIVINE 200ML - WEPINK", "", 1],
  ];

  it("lê o xlsx que a própria tela gera", async () => {
    const rows = await readXlsx(buildXlsx(sheet));
    expect(rows).toEqual([
      ["COD_PRODUTO", "Descricao1", "Quantidade minin", "Saldo"],
      ["182", "BODY SPLASH FATAL ROUGE 200 ML - WEPINK", "72", "0"],
      ["185", "BODY SPLASH DIVINE 200ML - WEPINK", "", "1"],
    ]);
  });

  it("lê o mesmo arquivo comprimido, como o Excel grava", async () => {
    const rows = await readXlsx(zipDeflate(buildXlsx(sheet)));
    expect(rows[1][0]).toBe("182");
    expect(rows[1][2]).toBe("72");
    expect(rows[2][2]).toBe("");
  });

  it("ignora a aba oculta e lê a aba visível", async () => {
    const hidden = inlineSheet('<c r="A1" t="inlineStr"><is><t>Campo</t></is></c><c r="B1" t="inlineStr"><is><t>Valor</t></is></c>');
    const visible = inlineSheet(
      '<c r="A1" t="inlineStr"><is><t>COD_PRODUTO</t></is></c><c r="C1" t="inlineStr"><is><t>Quantidade minin</t></is></c>',
    );
    const book =
      `<?xml version="1.0"?><workbook xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<sheets><sheet state="hidden" name="_CONFIG" sheetId="1" r:id="rId1"/>' +
      '<sheet name="LAYOUT" sheetId="2" r:id="rId2"/></sheets></workbook>';
    const rels =
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      "</Relationships>";
    const rows = await readXlsx(
      storeZip([
        ["xl/workbook.xml", book],
        ["xl/_rels/workbook.xml.rels", rels],
        ["xl/worksheets/sheet1.xml", hidden],
        ["xl/worksheets/sheet2.xml", visible],
      ]),
    );
    expect(rows[0][0]).toBe("COD_PRODUTO");
    expect(rows[0][2]).toBe("Quantidade minin");
  });
});
