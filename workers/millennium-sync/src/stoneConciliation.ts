/**
 * Arquivo de conciliação Stone (XML 2.2), um por Stone Code por dia.
 * Disponível depois das 5h do dia seguinte. Cliente Stone: Basic com a chave
 * secreta no usuário e senha vazia, header x-user-type: client.
 *
 * Só entra a captura do dia (Events/Captures > 0). Parcela que só liquidou
 * nesse dia (Captures = 0) é dinheiro que caiu de uma venda anterior.
 *
 * Conta 2 = crédito. Contas 1 e 3 = débito (na loja 00386, 1+3 = débito + TEF débito).
 * PIX não veio neste layout.
 */
export type StoneCapture = {
  acquirerKey: string;
  /** AuthorizationDateTime lido como UTC. */
  occurredAt: string;
  accountType: number;
  paymentMethod: string;
  brandId: number | null;
  capturedCents: number;
  authorizationCode: string;
  installments: number;
};

const STONE_URL = "https://conciliation.stone.com.br/v2/merchant";

function tag(block: string, name: string): string {
  return block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? "";
}

function reaisToCents(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** 20261007122028 → 2026-10-07T12:20:28.000Z. Vazio → "". */
export function stoneTimestampToIso(raw: string): string {
  const s = raw.trim();
  if (!/^\d{14}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.000Z`;
}

export function stoneReferenceDay(raw: string): string {
  const s = raw.trim();
  if (!/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** 2 crédito; 1 e 3 débito. O resto fica Outros até a Stone nomear. */
export function stonePaymentMethod(accountType: number): string {
  if (accountType === 2) return "Cartão de crédito";
  if (accountType === 1 || accountType === 3) return "Cartão de débito";
  return "Outros";
}

export function parseStoneConciliation(xml: string): { referenceDay: string; captures: StoneCapture[] } {
  const referenceDay = stoneReferenceDay(tag(xml, "ReferenceDate"));
  const captures: StoneCapture[] = [];
  for (const match of xml.matchAll(/<Transaction>([\s\S]*?)<\/Transaction>/g)) {
    const block = match[1] ?? "";
    if (tag(block, "Captures") !== "1" && Number(tag(block, "Captures") || "0") <= 0) continue;
    const acquirerKey = tag(block, "AcquirerTransactionKey");
    const occurredAt = stoneTimestampToIso(tag(block, "AuthorizationDateTime"));
    if (!acquirerKey || !occurredAt) continue;
    const accountType = Number(tag(block, "AccountType"));
    const brandRaw = tag(block, "BrandId");
    const installments = Number(tag(block, "NumberOfInstallments") || "1");
    captures.push({
      acquirerKey,
      occurredAt,
      accountType: Number.isFinite(accountType) ? accountType : 0,
      paymentMethod: stonePaymentMethod(Number.isFinite(accountType) ? accountType : 0),
      brandId: brandRaw ? Number(brandRaw) : null,
      capturedCents: reaisToCents(tag(block, "CapturedAmount")),
      authorizationCode: tag(block, "IssuerAuthorizationCode"),
      installments: Number.isFinite(installments) && installments > 0 ? installments : 1,
    });
  }
  return { referenceDay, captures };
}

export async function fetchStoneConciliation(opts: {
  stoneCode: string;
  secret: string;
  day: string;
  fetchImpl?: typeof fetch;
}): Promise<StoneCapture[]> {
  const ymd = opts.day.replaceAll("-", "");
  const token = Buffer.from(`${opts.secret}:`).toString("base64");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${STONE_URL}/${opts.stoneCode}/conciliation-file/${ymd}?layout=XML2_2`, {
    headers: {
      Authorization: `Basic ${token}`,
      "x-user-type": "client",
      Accept: "application/xml",
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const message = text.match(/<Message>([^<]*)<\/Message>/i)?.[1]?.trim() || text.slice(0, 180);
    throw new Error(`Stone ${opts.day} → ${res.status} ${message}`);
  }
  return parseStoneConciliation(text).captures;
}
