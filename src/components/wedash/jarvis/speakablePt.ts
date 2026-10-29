/**
 * Texto na tela (R$ 1.192.475) ≠ o que o TTS entende.
 * Expande números/moeda pt-BR para fala antes de mandar ao áudio.
 */

const UNITS = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

function underThousand(n: number, feminine = false): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  if (n < 20) {
    if (feminine && n === 1) return "uma";
    if (feminine && n === 2) return "duas";
    return UNITS[n] ?? String(n);
  }
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t] ?? "";
    const unit = feminine && u === 1 ? "uma" : feminine && u === 2 ? "duas" : UNITS[u];
    return `${TENS[t]} e ${unit}`;
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = HUNDREDS[h] ?? "";
  if (rest === 0) return head;
  return `${head} e ${underThousand(rest, feminine)}`;
}

/** Inteiro ≥ 0 → português (até bilhões). */
export function integerToPtBr(n: number, feminine = false): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return "zero";
  if (v < 1000) return underThousand(v, feminine);

  const billions = Math.floor(v / 1_000_000_000);
  const millions = Math.floor((v % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((v % 1_000_000) / 1000);
  const rem = v % 1000;

  const parts: string[] = [];
  if (billions > 0) {
    parts.push(billions === 1 ? "um bilhão" : `${underThousand(billions)} bilhões`);
  }
  if (millions > 0) {
    parts.push(millions === 1 ? "um milhão" : `${underThousand(millions)} milhões`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? "mil" : `${underThousand(thousands, feminine)} mil`);
  }
  if (rem > 0) parts.push(underThousand(rem, feminine));

  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} e ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** "1.192.475" ou "1192475" → número. */
export function parsePtBrNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  // 1.192.475,50 ou 1.192.475
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    const [intPart, dec] = t.split(",");
    const whole = Number((intPart ?? "").replace(/\./g, ""));
    if (!Number.isFinite(whole)) return null;
    if (dec != null) {
      const frac = Number(`0.${dec}`);
      return Number.isFinite(frac) ? whole + frac : whole;
    }
    return whole;
  }
  // 1192475,50
  if (/^\d+(,\d+)?$/.test(t)) {
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function moneyToSpeech(rawAmount: string): string {
  const n = parsePtBrNumber(rawAmount);
  if (n == null) return `reais ${rawAmount}`;
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const reais =
    whole === 1 ? "um real" : `${integerToPtBr(whole)} reais`;
  if (cents <= 0) return reais;
  const centavos =
    cents === 1 ? "um centavo" : `${integerToPtBr(cents)} centavos`;
  return `${reais} e ${centavos}`;
}

function numberToSpeech(raw: string): string {
  const n = parsePtBrNumber(raw);
  if (n == null) return raw;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100);
  if (frac <= 0) return integerToPtBr(whole);
  return `${integerToPtBr(whole)} vírgula ${integerToPtBr(frac)}`;
}

/**
 * Prepara texto do chat para TTS: moeda e milhares pt-BR por extenso.
 * Mantém vírgulas, pontos e reticências (pausas naturais estilo Néctar).
 */
export function forSpeech(text: string): string {
  let out = text;

  // R$ 1.192.475 / R$1.192.475,90
  out = out.replace(/R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)/gi, (_, amount: string) =>
    moneyToSpeech(amount),
  );

  // Milhares sem R$ (ex.: 9.722 vendas) — evita TTS ler "nove ponto sete…"
  out = out.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (full) => numberToSpeech(full));

  // Compactos tipo 1,2M / 15K (se o LLM usar)
  out = out.replace(/\b(\d+(?:,\d+)?)\s*[Mm]\b/g, (_, n: string) => {
    const v = parsePtBrNumber(n);
    if (v == null) return `${n} milhões`;
    const scaled = Math.round(v * 1_000_000);
    return scaled === 1_000_000 ? "um milhão" : integerToPtBr(scaled);
  });
  out = out.replace(/\b(\d+(?:,\d+)?)\s*[Kk]\b/g, (_, n: string) => {
    const v = parsePtBrNumber(n);
    if (v == null) return `${n} mil`;
    return integerToPtBr(Math.round(v * 1000));
  });

  // Normaliza espaços sem apagar pontuação; reforça pausa após vírgula.
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/,([^\s])/g, ", $1");
  return out;
}
