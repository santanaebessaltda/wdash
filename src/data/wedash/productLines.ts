/**
 * Linha de produto (fragrancia) a partir da descricao do ERP (o Millennium nao tem campo de linha):
 * "DESOD COL OBSESSED DELUXE 100 ML - WEPINK" e "BODY SPLASH OBSESSED 200ML - WEPINK"  ->  linha OBSESSED.
 *
 * 1. Tira o tipo do comeco (desodorante colonia, body splash, body cream, roll-on...), o tamanho e a marca.
 * 2. Agrupa pela 1 palavra da fragrancia (2 palavras quando a 1 e generica: MY, THE, LE).
 * 3. Nome da linha = comeco comum de todas as fragrancias do grupo no catalogo
 *    (ONE TOUCH LATTE / SILK / WARM  ->  ONE TOUCH; FANTASY KIDS ...  ->  FANTASY KIDS).
 * Produto sem tipo de fragrancia (skincare, cabelo, maquiagem, suplementos, kits) fica sem linha.
 */

/** Tipos de produto com fragrancia, do prefixo mais longo para o mais curto. */
const KIND_PREFIXES: Array<{ prefix: string; kind: string }> = [
  { prefix: "DESODORANTE ROLL-ON MY PROTECTION", kind: "Roll-on" },
  { prefix: "DESODORANTE ROLL-ON", kind: "Roll-on" },
  { prefix: "BODY BUTTER DESODORANTE", kind: "Body butter" },
  { prefix: "BODY BUTTER", kind: "Body butter" },
  { prefix: "DESOD COL", kind: "Desodorante colônia" },
  { prefix: "AGUA DE COLONIA", kind: "Desodorante colônia" },
  { prefix: "DESOD", kind: "Desodorante colônia" },
  { prefix: "BODY SPLASH", kind: "Body splash" },
  { prefix: "BODY CREAM", kind: "Body cream" },
  { prefix: "BODY SCRUB", kind: "Body scrub" },
  { prefix: "PERFUME CAPILAR", kind: "Perfume capilar" },
  { prefix: "ESPUMA DE BANHO", kind: "Espuma de banho" },
  { prefix: "SABONETE EM BARRA", kind: "Sabonete" },
  { prefix: "THE OIL", kind: "The Oil" },
  { prefix: "THE CREAM", kind: "The Cream" },
];

/** Grafias diferentes da mesma fragrancia no cadastro do ERP. */
const ALIASES: Record<string, string> = {
  GADHAN: "GHADAN",
  INFINTY: "INFINITY",
  CELEBRATERELICS: "CELEBRATE RELICS",
  AURETEX: "AURETX",
  VIRGINIA: "VF",
};

/** 1 palavra generica demais para ser a linha sozinha. */
const GENERIC_FIRST = new Set(["MY", "THE", "LE"]);

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00ad/g, "")
    .replace(/[–—]/g, "-")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

export type Fragrance = { name: string; kind: string };

/** Fragrancia + tipo do produto; null = produto sem fragrancia (fora das linhas). */
export function fragranceOf(description: string): Fragrance | null {
  let s = normalize(description);
  const hit = KIND_PREFIXES.find((k) => s === k.prefix || s.startsWith(`${k.prefix} `));
  if (!hit) return null;
  s = s.slice(hit.prefix.length);
  s = s
    .replace(/\s*-?\s*\d+([.,]\d+)?\s*(ML|GR|G|KG)\b.*$/, "")
    .replace(/\s+ML\b.*$/, "")
    .replace(/\s*-\s*WE ?PINI?K\b.*$/, "")
    .replace(/\s+WE ?PINK$/, "")
    .replace(/\bLOCAO CORPORAL\b.*$/, "")
    .replace(/[\s-]+$/, "")
    .trim();
  const words = s
    .split(" ")
    .filter(Boolean)
    .flatMap((w) => (ALIASES[w] ?? w).split(" "));
  if (words.length === 0) return null;
  return { name: words.join(" "), kind: hit.kind };
}

const groupKey = (name: string) => {
  const w = name.split(" ");
  return GENERIC_FIRST.has(w[0]!) && w.length > 1 ? `${w[0]} ${w[1]}` : w[0]!;
};

/** Conectivo nao fecha nome de linha (FUSION FOR HER / FOR HIM  ->  FUSION). */
const TRAILING_CONNECTORS = new Set(["FOR", "DE", "DI", "E", "THE"]);

function commonPrefix(names: string[]): string {
  const split = names.map((n) => n.split(" "));
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const w = split[0]![i];
    if (!w || split.some((p) => p[i] !== w)) break;
    out.push(w);
  }
  while (out.length > 1 && TRAILING_CONNECTORS.has(out[out.length - 1]!)) out.pop();
  return out.join(" ");
}

export type ProductLineIndex = {
  /** Linha do produto; null = sem fragrancia. */
  lineOf(description: string): { line: string; kind: string } | null;
};

/** Indice de linhas a partir das descricoes do catalogo (e das vendas, para produto fora do catalogo). */
export function buildProductLineIndex(descriptions: Iterable<string>): ProductLineIndex {
  const byKey = new Map<string, Set<string>>();
  for (const d of descriptions) {
    const f = fragranceOf(d);
    if (!f) continue;
    const k = groupKey(f.name);
    const set = byKey.get(k) ?? new Set<string>();
    set.add(f.name);
    byKey.set(k, set);
  }
  const lineByKey = new Map<string, string>();
  for (const [k, names] of byKey) lineByKey.set(k, commonPrefix([...names]) || k);
  return {
    lineOf(description) {
      const f = fragranceOf(description);
      if (!f) return null;
      const k = groupKey(f.name);
      return { line: lineByKey.get(k) ?? k, kind: f.kind };
    },
  };
}
