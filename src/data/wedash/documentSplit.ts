/** Regras puras do envio de documentos. A Edge e a tela usam este módulo. */

export const DOCUMENT_CATEGORIES = [
  "Holerite",
  "Espelho de ponto",
  "Adiantamento salarial",
  "Vale-transporte",
  "Vale-alimentação / refeição",
  "Participação nos lucros (PLR)",
  "Informe de rendimentos",
  "Outros",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_COPY = {
  scanned: "Este PDF é escaneado. Envie o arquivo digital gerado pelo sistema de folha.",
  tooMany: "Você pode anexar até 5 PDFs por vez.",
  tooBigSource: "Cada PDF pode ter até 15 MB e 1.000 páginas.",
  notPdf: "Envie apenas arquivos PDF.",
  noWhatsapp: "Informe o WhatsApp para enviar este documento.",
  noEmail: "Informe o e-mail para enviar este documento.",
  overEnvelope: "O PDF passa de 5 MB depois da separação. Separe o arquivo e tente novamente.",
  noToken: "A conexão com o Assina AI ainda não foi configurada. Acesse Conta › Integrações para conectar.",
  badToken: "Token inválido.",
  badCpf: "Informe um CPF válido.",
  badWhatsapp: "Informe um WhatsApp válido com DDD.",
  badEmail: "Informe um e-mail válido.",
} as const;

export const DOCUMENT_LIMITS = {
  maxFiles: 5,
  maxSourceBytes: 15 * 1024 * 1024,
  maxPages: 1000,
  maxEnvelopeBytes: 5 * 1024 * 1024,
} as const;

const MONTHS = [
  "",
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export type DocStatus = "UNASSIGNED" | "PENDING" | "SIGNED" | "DECLINED" | "EXPIRED";

export type PageRef = { sourceIndex: number; pageNumber: number };

export type PageGroup = { cpf: string | null; pages: PageRef[] };

const CPF_RE = /(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g;

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** 11 dígitos com verificadores. null quando o texto não é um CPF. */
export function cpfDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return null;
  if (checkDigit(digits, 9) !== Number(digits[9])) return null;
  if (checkDigit(digits, 10) !== Number(digits[10])) return null;
  return digits;
}

export function firstCpf(text: string): string | null {
  for (const match of text.matchAll(CPF_RE)) {
    const cpf = cpfDigits(match[1]);
    if (cpf) return cpf;
  }
  return null;
}

export function saveCpf(raw: string): { ok: true; cpf: string } | { ok: false; message: string } {
  const cpf = cpfDigits(raw);
  if (!cpf) return { ok: false, message: DOCUMENT_COPY.badCpf };
  return { ok: true, cpf };
}

export function saveWhatsapp(raw: string): { ok: true; whatsapp: string | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, whatsapp: null };
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 11) return { ok: false, message: DOCUMENT_COPY.badWhatsapp };
  return { ok: true, whatsapp: digits };
}

export function saveEmail(raw: string): { ok: true; email: string | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, email: null };
  if (!trimmed.includes("@")) return { ok: false, message: DOCUMENT_COPY.badEmail };
  return { ok: true, email: trimmed };
}

export function groupPages(pages: Array<PageRef & { text: string }>, unify: boolean): PageGroup[] {
  if (!unify) {
    return pages.map((page) => ({
      cpf: firstCpf(page.text),
      pages: [{ sourceIndex: page.sourceIndex, pageNumber: page.pageNumber }],
    }));
  }
  const groups: PageGroup[] = [];
  const byCpf = new Map<string, PageGroup>();
  for (const page of pages) {
    const cpf = firstCpf(page.text);
    const ref = { sourceIndex: page.sourceIndex, pageNumber: page.pageNumber };
    if (!cpf) {
      groups.push({ cpf: null, pages: [ref] });
      continue;
    }
    const existing = byCpf.get(cpf);
    if (existing) existing.pages.push(ref);
    else {
      const created = { cpf, pages: [ref] };
      byCpf.set(cpf, created);
      groups.push(created);
    }
  }
  return groups;
}

export function assignSeller(matches: { id: string }[]): string | null {
  return matches.length === 1 ? matches[0].id : null;
}

export function fileName(category: string, taken: string[]): string {
  const base = `${category}.pdf`;
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${category} (${n}).pdf`)) n += 1;
  return `${category} (${n}).pdf`;
}

/** Nome curto da pasta, sem a extensão. */
export function folderTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "");
}

/** Nome livre de Outros. A pasta mostra este texto; o envio acrescenta a pessoa, o mês e o ano. */
export function customDocumentName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim().replace(/\.pdf$/i, "").replace(/\s+/g, " ");
  if (!name) return { ok: false, message: "Informe o nome do documento." };
  if (name.length > 80) return { ok: false, message: "O nome do documento aceita até 80 caracteres." };
  if (/[\\/:*?"<>|]/.test(name)) return { ok: false, message: "O nome do documento não pode conter \\ / : * ? \" < > |." };
  return { ok: true, name };
}

function personFileToken(name: string): string {
  const token = name.trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "");
  return token || "Colaborador";
}

/** Nome que sai no envio e no download: Holerite-Maria-Eduarda-Outubro-2026.pdf */
export function deliveryFileName(storedName: string, personName: string, month: number, year: number): string {
  return `${folderTitle(storedName)}-${personFileToken(personName)}-${monthFolder(month)}-${year}.pdf`;
}

export function monthFolder(month: number): string {
  return MONTHS[month] ?? "";
}

export function folderSegments(input: {
  allStores: boolean;
  storeName: string;
  employeeName: string;
  year: number;
  month: number;
}): string[] {
  const tail = [input.employeeName, String(input.year), monthFolder(input.month)];
  return input.allStores ? [input.storeName, ...tail] : tail;
}

export function batchLabel(statuses: DocStatus[]): "Pendente" | "Assinado" {
  return statuses.length > 0 && statuses.every((status) => status === "SIGNED") ? "Assinado" : "Pendente";
}

export function signedCount(statuses: DocStatus[]): number {
  return statuses.filter((status) => status === "SIGNED").length;
}

export function sourceRefusal(input: {
  mime: string;
  bytes: number;
  pages: number;
  hasText: boolean;
  alreadyAccepted: number;
}): string | null {
  if (input.mime !== "application/pdf") return DOCUMENT_COPY.notPdf;
  if (input.alreadyAccepted >= DOCUMENT_LIMITS.maxFiles) return DOCUMENT_COPY.tooMany;
  if (input.bytes > DOCUMENT_LIMITS.maxSourceBytes || input.pages > DOCUMENT_LIMITS.maxPages) return DOCUMENT_COPY.tooBigSource;
  if (!input.hasText) return DOCUMENT_COPY.scanned;
  return null;
}

export function channelBlock(
  channel: "EMAIL" | "WHATSAPP",
  contact: { email: string | null; whatsapp: string | null },
): string | null {
  if (channel === "WHATSAPP" && !contact.whatsapp) return DOCUMENT_COPY.noWhatsapp;
  if (channel === "EMAIL" && !contact.email) return DOCUMENT_COPY.noEmail;
  return null;
}

export function confirmBlock(input: { deadline: string | null; hasToken: boolean; sizeBytes: number }): string | null {
  if (!input.hasToken) return DOCUMENT_COPY.noToken;
  if (input.sizeBytes > DOCUMENT_LIMITS.maxEnvelopeBytes) return DOCUMENT_COPY.overEnvelope;
  return null;
}

export function shouldSend(row: { envelopeId: string | null; sellerId: string | null; block: string | null }): boolean {
  return row.envelopeId == null && row.sellerId != null && row.block == null;
}

export function resendVisible(status: DocStatus): boolean {
  return status === "PENDING";
}

export function applyEnvelopeStatus(current: DocStatus, envelopeStatus: string): DocStatus {
  if (current === "SIGNED") return "SIGNED";
  if (envelopeStatus === "COMPLETED") return "SIGNED";
  if (envelopeStatus === "DECLINED" || envelopeStatus === "CANCELED") return "DECLINED";
  if (envelopeStatus === "EXPIRED") return "EXPIRED";
  if (envelopeStatus === "SENT_FOR_SIGNATURE" || envelopeStatus === "PARTIALLY_SIGNED") return "PENDING";
  return current;
}

export function signaturePositions(pageCount: number): Array<{ pageNumber: number; x: number; y: number; element: "SIGNATURE" }> {
  return Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    x: 50,
    y: 50,
    element: "SIGNATURE",
  }));
}
