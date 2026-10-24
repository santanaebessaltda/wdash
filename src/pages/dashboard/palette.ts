/** Cores da Visão geral. Financeiro, Produtos e Equipe usam as mesmas. */

export const PALETTE = {
  pink: "var(--palette-pink)",
  pinkHover: "var(--palette-pink-2)",
  pinkSoft: "var(--palette-pink-soft)",
  purple: "var(--palette-purple)",
  purpleSoft: "var(--palette-purple-soft)",
  blue: "var(--palette-blue)",
  blueSoft: "var(--palette-blue-soft)",
  green: "var(--palette-green)",
  greenSoft: "var(--palette-green-soft)",
  amber: "var(--palette-amber)",
  amberSoft: "var(--palette-amber-soft)",
  red: "var(--palette-red)",
  neutral: "var(--palette-neutral)",
} as const;

export type KpiTone = { iconColor: string; iconBg: string };

const TONE_PINK: KpiTone = { iconColor: PALETTE.pink, iconBg: PALETTE.pinkSoft };
const TONE_AMBER: KpiTone = { iconColor: PALETTE.amber, iconBg: PALETTE.amberSoft };
const TONE_PURPLE: KpiTone = { iconColor: PALETTE.purple, iconBg: PALETTE.purpleSoft };
const TONE_BLUE: KpiTone = { iconColor: PALETTE.blue, iconBg: PALETTE.blueSoft };
const TONE_GREEN: KpiTone = { iconColor: PALETTE.green, iconBg: PALETTE.greenSoft };

/** Ícone do card pelo papel da métrica: faturamento rosa, CMV âmbar, vendas roxo, ticket e margem azul, lucro verde. */
export function kpiTone(label: string): KpiTone {
  const key = label.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (key.includes("faturamento")) return TONE_PINK;
  if (key.includes("cmv")) return TONE_AMBER;
  if (key.includes("lucro")) return TONE_GREEN;
  if (key.includes("margem") || key.includes("ticket")) return TONE_BLUE;
  if (key.includes("p.a")) return TONE_GREEN;
  if (key.includes("venda") || key.includes("item")) return TONE_PURPLE;
  return TONE_PINK;
}

/** Crédito roxo, Pix verde, débito azul, dinheiro âmbar. O resto fica neutro. */
export function paymentColor(method: string): string {
  const key = method.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (key.includes("credito")) return PALETTE.purple;
  if (key.includes("pix")) return PALETTE.green;
  if (key.includes("debito")) return PALETTE.blue;
  if (key.includes("dinheiro") || key === "cash") return PALETTE.amber;
  return PALETTE.neutral;
}

/** Fatias que não são a de maior valor. A líder usa a cor primária. */
export const SERIES_COLORS = [PALETTE.purple, PALETTE.blue, PALETTE.green, PALETTE.amber, PALETTE.red] as const;

/** A maior fatia fica rosa. Empate também. `neutral` não entra na disputa. */
export function colorsByAmount(items: { amount: number; neutral?: boolean }[]): string[] {
  const top = items.reduce((max, item) => (item.neutral ? max : Math.max(max, item.amount)), 0);
  let cursor = 0;
  return items.map((item) => {
    if (item.neutral) return PALETTE.neutral;
    if (top > 0 && item.amount === top) return PALETTE.pink;
    const color = SERIES_COLORS[cursor % SERIES_COLORS.length]!;
    cursor += 1;
    return color;
  });
}

/** Cor da próxima fatia depois das que `colorsByAmount` já pintou. */
export function nextSeriesColor(colors: string[]): string {
  const used = colors.filter((color) => color !== PALETTE.pink && color !== PALETTE.neutral).length;
  return SERIES_COLORS[used % SERIES_COLORS.length]!;
}

/** Avatares de produto, sem o rosa do faturamento. */
export const PRODUCT_AVATAR_TONES = [PALETTE.purple, PALETTE.blue, PALETTE.green, PALETTE.amber] as const;

export const profitText = (value: number | null) =>
  value == null ? "text-t2" : value < 0 ? "text-palette-red" : "text-palette-green";

export const variationColor = (value: number) => (value >= 0 ? PALETTE.green : PALETTE.red);
