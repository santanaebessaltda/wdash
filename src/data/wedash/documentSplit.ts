/** Regras puras do envio de documentos. A Edge e a tela usam este módulo. */

export const DOCUMENT_CATEGORIES = [
  "Holerite",
  "Espelho de ponto",
  "Adiantamento salarial",
  "Vale-transporte",
  "Vale-alimentação / refeição",
  "Participação nos lucros (PLR)",
  "Informe de rendimentos",
  "Admissão",
  "Rescisão",
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
  missingPage: "Este PDF não tem a página da assinatura. Posicione a marca de novo.",
  alreadySent: "Este documento já foi enviado.",
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

/** Nome curto da pasta, sem a extensão. O índice "(2)" fica só no arquivo. */
export function folderTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "");
}

/** Nome que a tela mostra. Holerite (2) aparece como Holerite. */
export function displayTitle(fileName: string): string {
  return folderTitle(fileName).replace(/ \(\d+\)$/, "");
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

/** Fim do 30º dia depois do envio, em UTC. 15/10 vira 14/11 às 23:59:59.000Z. */
export function signatureDeadlineAt(sentAt: Date): string {
  const end = new Date(Date.UTC(sentAt.getUTCFullYear(), sentAt.getUTCMonth(), sentAt.getUTCDate() + 30, 23, 59, 59));
  return end.toISOString();
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

export type SendChannel = "EMAIL" | "WHATSAPP";

/** O que o Assina pede antes da assinatura. `DEFAULT_SIGN` é a assinatura na tela. */
export type AuthenticationType = "DEFAULT_SIGN" | "SELFIE" | "DOCUMENT_AND_SELFIE" | "SMS" | "ICP_BRASIL";

export const AUTHENTICATIONS: { id: AuthenticationType; label: string; detail: string; credits: number }[] = [
  { id: "DEFAULT_SIGN", label: "Assinatura na tela", detail: "Padrão Assina AI", credits: 0 },
  { id: "SELFIE", label: "Selfie", detail: "Reconhecimento facial", credits: 0 },
  { id: "DOCUMENT_AND_SELFIE", label: "Documento + selfie", detail: "Reconhecimento facial", credits: 0 },
  { id: "SMS", label: "Código por SMS", detail: "Autenticação por SMS", credits: 1 },
  { id: "ICP_BRASIL", label: "Certificado ICP-Brasil", detail: "e-CPF ou e-CNPJ", credits: 1 },
];

export function asAuthentication(value: unknown): AuthenticationType {
  return AUTHENTICATIONS.some((item) => item.id === value) ? (value as AuthenticationType) : "DEFAULT_SIGN";
}

/** WhatsApp gasta 1 crédito por signatário. E-mail não gasta. */
export function channelCredits(channel: SendChannel): number {
  return channel === "WHATSAPP" ? 1 : 0;
}

export function signerCredits(channel: SendChannel, authentication: AuthenticationType): number {
  return channelCredits(channel) + (AUTHENTICATIONS.find((item) => item.id === authentication)?.credits ?? 0);
}

export type MarkElement = "SIGNATURE" | "RUBRIC";

export type SignatureMark = {
  pageNumber: number;
  x: number;
  y: number;
  element: MarkElement;
};

/** `seller` é o colaborador do documento. `user:` é alguém da lista de usuários. */
export type FieldMark = SignatureMark & { id: string; signerId: string };

export type ExtraSigner = {
  name: string;
  channel: SendChannel;
  email: string | null;
  whatsapp: string | null;
  marks: SignatureMark[];
  authentication?: AuthenticationType;
};

export type EnvelopeRecipient = {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  routingOrder: number;
  action: "SIGN";
  senderType: SendChannel;
  authenticationType: AuthenticationType;
  signaturePositions: SignatureMark[];
};

function present(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function maskCpf(digits: string): string {
  return digits.replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/** Campos que ainda faltam no cadastro. Um valor já salvo não volta a ser pedido. */
export function contactFieldsToAsk(
  profile: { cpf: string | null; email: string | null; whatsapp: string | null },
  channel: SendChannel,
): { cpf: boolean; email: boolean; whatsapp: boolean } {
  return {
    cpf: !present(profile.cpf),
    email: channel === "EMAIL" && !present(profile.email),
    whatsapp: channel === "WHATSAPP" && !present(profile.whatsapp),
  };
}

/** Grava só as chaves recebidas. O canal escondido não entra no patch. */
export function contactPatch(input: { cpf?: string; email?: string; whatsapp?: string }):
  | { ok: true; patch: { cpf?: string; email?: string | null; whatsapp?: string | null } }
  | { ok: false; message: string } {
  const patch: { cpf?: string; email?: string | null; whatsapp?: string | null } = {};
  if (input.cpf !== undefined) {
    const saved = saveCpf(input.cpf);
    if (!saved.ok) return saved;
    patch.cpf = saved.cpf;
  }
  if (input.email !== undefined) {
    const saved = saveEmail(input.email);
    if (!saved.ok) return saved;
    patch.email = saved.email;
  }
  if (input.whatsapp !== undefined) {
    const saved = saveWhatsapp(input.whatsapp);
    if (!saved.ok) return saved;
    patch.whatsapp = saved.whatsapp;
  }
  return { ok: true, patch };
}

export type ContactEdit = { cpf: string; email: string; whatsapp: string };

/** O que a pessoa digitou vale na preparação. A gravação fica para o envio. */
export function applyContactEdit<T extends { id: string; cpf: string | null; email: string | null; whatsapp: string | null }>(
  person: T | null,
  edits: Record<string, ContactEdit>,
): T | null {
  if (!person) return null;
  const edit = edits[person.id];
  if (!edit) return person;
  return { ...person, cpf: edit.cpf, email: edit.email, whatsapp: edit.whatsapp };
}

/** Copia canal e marcas. CPF, e-mail e WhatsApp ficam de fora. */
export function replicateSetup(source: { channel: SendChannel; marks: SignatureMark[] }): { channel: SendChannel; marks: SignatureMark[] } {
  return {
    channel: source.channel,
    marks: source.marks.map((mark) => ({ ...mark })),
  };
}

/** null quando a página apagada era a única e o documento sai do envio. */
export function remainingPages(pageCount: number, pageNumber: number): number | null {
  if (!Number.isInteger(pageCount) || pageCount < 1) return null;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) return pageCount;
  return pageCount === 1 ? null : pageCount - 1;
}

/** A marca acompanha as páginas que sobraram. Se a página dela saiu, volta ao centro da última. */
export function markAfterDrop(mark: SignatureMark, removedPage: number, nextPageCount: number): SignatureMark | null {
  if (mark.pageNumber === removedPage) return null;
  const pageNumber = mark.pageNumber > removedPage ? mark.pageNumber - 1 : mark.pageNumber;
  if (pageNumber < 1 || pageNumber > nextPageCount) return null;
  return { ...mark, pageNumber };
}

/** Uma assinatura no centro da última página. */
export function defaultSignatureMark(pageCount: number): SignatureMark {
  return { pageNumber: Math.max(1, pageCount), x: 50, y: 50, element: "SIGNATURE" };
}

export type Reminder = "EVERY_DAY" | "EVERY_3_DAYS" | "EVERY_WEEK" | "NEVER";

/** Pessoa que assina só este envio. Não vira colaborador nem usuário. */
export type GuestSigner = {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  channel?: SendChannel;
  authentication?: AuthenticationType;
};

/** Canal e autenticação de uma pessoa de fora. Sem escolha, WhatsApp e assinatura na tela. */
export function guestChannel(guest: { channel?: SendChannel } | null | undefined): SendChannel {
  return guest?.channel === "EMAIL" ? "EMAIL" : "WHATSAPP";
}

export function guestAuthentication(guest: { authentication?: AuthenticationType } | null | undefined): AuthenticationType {
  return asAuthentication(guest?.authentication);
}

export type DocumentDraft = {
  channel: SendChannel;
  authentication?: AuthenticationType;
  fields: FieldMark[];
  guests: GuestSigner[];
  deadline: string;
  reminder: Reminder;
};

export function asReminder(value: unknown): Reminder | null {
  if (value === "EVERY_DAY" || value === "EVERY_3_DAYS" || value === "EVERY_WEEK" || value === "NEVER") return value;
  return null;
}

/** A marca fica numa página que o documento ainda tem. */
export function clampMark(mark: SignatureMark, pageCount: number): SignatureMark {
  const pages = Math.max(1, Math.floor(pageCount) || 1);
  const pageNumber = Math.min(pages, Math.max(1, Math.floor(mark.pageNumber) || 1));
  return { pageNumber, x: mark.x, y: mark.y, element: mark.element === "RUBRIC" ? "RUBRIC" : "SIGNATURE" };
}

export function defaultDraft(pageCount: number): DocumentDraft {
  return {
    channel: "WHATSAPP",
    authentication: "DEFAULT_SIGN",
    fields: [{ ...defaultSignatureMark(pageCount), id: "seller-mark", signerId: "seller" }],
    guests: [],
    deadline: "",
    reminder: "EVERY_3_DAYS",
  };
}

export function fieldAfterDrop(field: FieldMark, removedPage: number, nextPageCount: number): FieldMark | null {
  const next = markAfterDrop(field, removedPage, nextPageCount);
  if (!next) return null;
  return { ...field, pageNumber: next.pageNumber, x: next.x, y: next.y, element: next.element };
}

function clampField(field: FieldMark, pageCount: number): FieldMark {
  return { ...clampMark(field, pageCount), id: field.id, signerId: field.signerId };
}

/** Prazo, lembrete, marcas e signatários de usuário passam para o documento seguinte. O canal não. */
export function carryDraft(previous: DocumentDraft, pageCount: number): DocumentDraft {
  const fields = previous.fields.length > 0 ? previous.fields : defaultDraft(pageCount).fields;
  return {
    channel: "WHATSAPP",
    authentication: "DEFAULT_SIGN",
    fields: fields.map((field) => clampField(field, pageCount)),
    guests: (previous.guests ?? []).map((guest) => ({ ...guest })),
    deadline: previous.deadline,
    reminder: previous.reminder,
  };
}

/** Documento já ajustado fica como está. O que ainda não foi aberto herda o anterior. */
export function resolveDrafts(
  rows: { id: string; pageCount: number }[],
  drafts: Record<string, DocumentDraft | undefined>,
): DocumentDraft[] {
  let last = defaultDraft(rows[0]?.pageCount ?? 1);
  return rows.map((row) => {
    const own = drafts[row.id];
    const next = own
      ? {
          ...own,
          guests: own.guests ?? [],
          fields: (own.fields.length > 0 ? own.fields : defaultDraft(row.pageCount).fields).map((field) => clampField(field, row.pageCount)),
        }
      : carryDraft(last, row.pageCount);
    last = next;
    return next;
  });
}

export function sellerMarks(fields: FieldMark[]): FieldMark[] {
  return fields.filter((field) => field.signerId === "seller");
}

/** Contato de quem assinou sem ser colaborador. Serve para reutilizar no próximo envio. */
export type SignerContact = { name: string; email: string; whatsapp: string };

export function signerContactKey(contact: SignerContact): string {
  const phone = contact.whatsapp.replace(/\D/g, "");
  if (phone) return `w:${phone}`;
  const email = contact.email.trim().toLowerCase();
  if (email) return `e:${email}`;
  return `n:${contact.name.trim().toLowerCase()}`;
}

function readSignerContacts(value: unknown): SignerContact[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const contacts: SignerContact[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; email?: unknown; whatsapp?: unknown };
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    contacts.push({
      name,
      email: typeof row.email === "string" ? row.email.trim() : "",
      whatsapp: typeof row.whatsapp === "string" ? row.whatsapp.trim() : "",
    });
  }
  return contacts;
}

/** Últimos contatos de fora, do envio mais recente para o mais antigo. */
export function signerHistory(rows: { sentAt: string | null; extra: unknown }[], limit = 8): SignerContact[] {
  const ordered = [...rows].sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  const seen = new Set<string>();
  const history: SignerContact[] = [];
  for (const row of ordered) {
    for (const contact of readSignerContacts(row.extra)) {
      const key = signerContactKey(contact);
      if (seen.has(key)) continue;
      seen.add(key);
      history.push(contact);
      if (history.length >= limit) return history;
    }
  }
  return history;
}

/** Usuário sai no e-mail da conta. Cada pessoa de fora sai no canal dela. */
export function extraSignersFrom(
  fields: FieldMark[],
  signers: { id: string; name: string; email: string | null }[],
  pageCount: number,
  scope: {
    people?: { id: string; name: string; email: string | null; whatsapp: string | null }[];
    guests?: GuestSigner[];
    channel?: SendChannel;
  } = {},
): ExtraSigner[] {
  const channel = scope.channel ?? "WHATSAPP";
  const extras: ExtraSigner[] = [];
  const keys = [...new Set(fields.map((field) => field.signerId))];
  for (const key of keys) {
    const marks = applicableMarks(
      fields.filter((field) => field.signerId === key),
      pageCount,
    );
    if (marks.length === 0) continue;
    if (key.startsWith("user:")) {
      const signer = signers.find((item) => item.id === key.slice("user:".length));
      if (!signer?.name.trim() || !signer.email) continue;
      extras.push({ name: signer.name.trim(), channel: "EMAIL", email: signer.email, whatsapp: null, marks, authentication: "DEFAULT_SIGN" });
    } else if (key.startsWith("seller:")) {
      const person = scope.people?.find((item) => item.id === key.slice("seller:".length));
      if (!person?.name.trim()) continue;
      extras.push({
        name: person.name.trim(),
        channel,
        email: person.email,
        whatsapp: person.whatsapp,
        marks,
        authentication: "DEFAULT_SIGN",
      });
    } else if (key.startsWith("guest:")) {
      const guest = scope.guests?.find((item) => item.id === key.slice("guest:".length));
      if (!guest?.name.trim()) continue;
      const email = saveEmail(guest.email);
      const whatsapp = saveWhatsapp(guest.whatsapp);
      extras.push({
        name: guest.name.trim(),
        channel: guestChannel(guest),
        email: email.ok ? email.email : null,
        whatsapp: whatsapp.ok ? whatsapp.whatsapp : null,
        marks,
        authentication: guestAuthentication(guest),
      });
    }
  }
  return extras;
}

export function documentIssue(
  person: { cpf: string | null; email: string | null; whatsapp: string | null } | null,
  draft: DocumentDraft,
  pageCount: number,
  signers: { id: string; name: string; email: string | null }[] = [],
  people: { id: string; name: string; email: string | null; whatsapp: string | null; cpf?: string | null }[] = [],
  sizeBytes = 0,
): string | null {
  if (!person) return "Escolha o colaborador.";
  const ask = contactFieldsToAsk(person, draft.channel);
  if (ask.cpf || ask.email || ask.whatsapp) return "Falta contato no cadastro.";
  const cpf = saveCpf(person.cpf ?? "");
  if (!cpf.ok) return cpf.message;
  if (draft.channel === "EMAIL") {
    const saved = saveEmail(person.email ?? "");
    if (!saved.ok) return saved.message;
    if (!saved.email) return "Informe o e-mail de quem vai assinar.";
  }
  if (draft.channel === "WHATSAPP") {
    const saved = saveWhatsapp(person.whatsapp ?? "");
    if (!saved.ok) return saved.message;
    if (!saved.whatsapp) return "Informe o WhatsApp de quem vai assinar.";
  }
  const sms = smsPhoneGap(person.whatsapp, asAuthentication(draft.authentication));
  if (sms) return sms;
  if (draft.fields.some((field) => !field.signerId)) return "Escolha quem assina esta marcação.";
  const place = placementWarning(sellerMarks(draft.fields), pageCount);
  if (place) return place;
  for (const field of draft.fields) {
    if (field.signerId.startsWith("user:")) {
      const signer = signers.find((item) => item.id === field.signerId.slice("user:".length));
      if (!signer?.name.trim() || !signer.email) return "O signatário adicional precisa ser um usuário com e-mail.";
    } else if (field.signerId.startsWith("seller:")) {
      const other = people.find((item) => item.id === field.signerId.slice("seller:".length));
      const missing = other
        ? contactFieldsToAsk({ cpf: other.cpf ?? null, email: other.email, whatsapp: other.whatsapp }, draft.channel)
        : null;
      if (!other?.name.trim() || !missing || missing.cpf || missing.email || missing.whatsapp) return "Falta contato no cadastro.";
    } else if (field.signerId.startsWith("guest:")) {
      const guest = (draft.guests ?? []).find((item) => item.id === field.signerId.slice("guest:".length));
      if (!guest?.name.trim()) return "Informe o nome de quem vai assinar.";
      const guestSend = guestChannel(guest);
      if (guestSend === "EMAIL") {
        const saved = saveEmail(guest.email);
        if (!saved.ok) return saved.message;
        if (!saved.email) return "Informe o e-mail de quem vai assinar.";
      }
      if (guestSend === "WHATSAPP") {
        const saved = saveWhatsapp(guest.whatsapp);
        if (!saved.ok) return saved.message;
        if (!saved.whatsapp) return "Informe o WhatsApp de quem vai assinar.";
      }
      const guestSms = smsPhoneGap(guest.whatsapp, guestAuthentication(guest));
      if (guestSms) return guestSms;
    }
  }
  if (sizeBytes > DOCUMENT_LIMITS.maxEnvelopeBytes) return DOCUMENT_COPY.overEnvelope;
  return null;
}

export type PreparationStatus = "Pronto" | "Precisa de atenção" | "Já enviado";
export type PreparationReason = "Sem colaborador" | "Contato incompleto" | "Falta marcação" | "Revisar marcação";

/** Status da preparação. O motivo da pendência fica em `preparationReason`. */
export function preparationSituation(
  person: { cpf: string | null; email: string | null; whatsapp: string | null } | null,
  draft: DocumentDraft,
  pageCount: number,
  signers: { id: string; name: string; email: string | null }[] = [],
  people: { id: string; name: string; email: string | null; whatsapp: string | null; cpf?: string | null }[] = [],
  envelopeId: string | null = null,
  sizeBytes = 0,
): PreparationStatus {
  if (envelopeId) return "Já enviado";
  return documentIssue(person, draft, pageCount, signers, people, sizeBytes) ? "Precisa de atenção" : "Pronto";
}

/** Motivo quando o documento precisa de atenção. Documento herdado e ainda não aberto usa "Revisar marcação". */
export function preparationReason(
  person: { cpf: string | null; email: string | null; whatsapp: string | null } | null,
  draft: DocumentDraft,
  pageCount: number,
  signers: { id: string; name: string; email: string | null }[] = [],
  people: { id: string; name: string; email: string | null; whatsapp: string | null; cpf?: string | null }[] = [],
  envelopeId: string | null = null,
  sizeBytes = 0,
  reviewed = true,
): PreparationReason | null {
  const status = preparationSituation(person, draft, pageCount, signers, people, envelopeId, sizeBytes);
  if (status === "Pronto" && !reviewed) return "Revisar marcação";
  if (status !== "Precisa de atenção") return null;
  const issue = documentIssue(person, draft, pageCount, signers, people, sizeBytes);
  if (issue === "Escolha o colaborador.") return "Sem colaborador";
  if (issue === DOCUMENT_COPY.missingPage || issue === "Escolha quem assina esta marcação.") return "Falta marcação";
  if (
    issue === "Falta contato no cadastro." ||
    issue?.startsWith("Informe ") ||
    issue === "O signatário adicional precisa ser um usuário com e-mail." ||
    issue === DOCUMENT_COPY.badCpf ||
    issue === DOCUMENT_COPY.badEmail ||
    issue === DOCUMENT_COPY.badWhatsapp
  ) {
    return "Contato incompleto";
  }
  return null;
}

export function preparationCaption(status: PreparationStatus, reason: PreparationReason | null): string {
  if (status === "Pronto" && reason === "Revisar marcação") return "Precisa de atenção · Revisar marcação";
  return reason ? `${status} · ${reason}` : status;
}

export function applicableMarks(marks: SignatureMark[], pageCount: number): SignatureMark[] {
  return marks.filter(
    (mark) => (mark.element === "SIGNATURE" || mark.element === "RUBRIC") && mark.pageNumber >= 1 && mark.pageNumber <= pageCount,
  );
}

export function placementWarning(marks: SignatureMark[], pageCount: number): string | null {
  return applicableMarks(marks, pageCount).length > 0 ? null : DOCUMENT_COPY.missingPage;
}

function smsPhoneGap(whatsapp: string | null | undefined, authentication: AuthenticationType): string | null {
  if (authentication !== "SMS") return null;
  const saved = saveWhatsapp(whatsapp ?? "");
  if (!saved.ok) return saved.message;
  if (!saved.whatsapp) return "Informe o WhatsApp para o código por SMS.";
  return null;
}

function recipientOf(
  person: { name: string; cpf: string | null; email: string | null; whatsapp: string | null },
  channel: SendChannel,
  marks: SignatureMark[],
  routingOrder: number,
  authentication: AuthenticationType,
): { recipient: EnvelopeRecipient } {
  return {
    recipient: {
      name: person.name,
      email: channel === "EMAIL" ? (person.email ?? "") : "",
      phone: channel === "WHATSAPP" || authentication === "SMS" ? (person.whatsapp ?? "") : "",
      cpf: person.cpf ? maskCpf(person.cpf) : "",
      routingOrder,
      action: "SIGN",
      senderType: channel,
      authenticationType: authentication,
      signaturePositions: marks,
    },
  };
}

/** Colaborador na ordem 1. Cada signatário extra, quando tem nome, nas ordens seguintes. */
export function envelopeSignatures(input: {
  seller: { name: string; cpf: string | null; email: string | null; whatsapp: string | null };
  channel: SendChannel;
  authentication?: AuthenticationType;
  marks: SignatureMark[];
  pageCount: number;
  extras?: ExtraSigner[] | null;
  extra?: ExtraSigner | null;
}): Array<{ recipient: EnvelopeRecipient }> {
  const signatures = [
    recipientOf(input.seller, input.channel, applicableMarks(input.marks, input.pageCount), 1, asAuthentication(input.authentication)),
  ];
  const extras = input.extras ?? (input.extra ? [input.extra] : []);
  let order = 2;
  for (const extra of extras) {
    if (!present(extra.name)) continue;
    signatures.push(
      recipientOf(
        { name: extra.name.trim(), cpf: null, email: extra.email, whatsapp: extra.whatsapp },
        extra.channel,
        applicableMarks(extra.marks, input.pageCount),
        order,
        asAuthentication(extra.authentication),
      ),
    );
    order += 1;
  }
  return signatures;
}

/** O reenvio usa o colaborador, mesmo quando a resposta lista o signatário extra primeiro. */
export function collaboratorRecipientId(
  signatures: Array<{ id?: string; routingOrder?: number; recipient?: { id?: string; routingOrder?: number } }> | null | undefined,
): string | null {
  if (!signatures?.length) return null;
  const match = signatures.find((item) => (item.routingOrder ?? item.recipient?.routingOrder) === 1) ?? signatures[0];
  return match.recipient?.id ?? match.id ?? null;
}
