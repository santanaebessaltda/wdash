/** Produtos mockados por categoria, para o drill de margem por categoria. */
import { categorias } from "./stores";

export interface ProductSummary {
  codProduto: string;
  nome: string;
  receita: number;
  itens: number;
  margem: number;
  margemPct: number;
  coberturaDias: number | null;
  bloqueadoCompra: boolean;
}

const NOMES: Record<number, string[]> = {
  1: ["Perfume Pink Dream 100ml", "Perfume Cherry Blossom 100ml", "Perfume Black Orchid 75ml", "Perfume Sweet Vanilla 100ml", "Perfume Ocean Breeze 75ml", "Perfume Golden Musk 50ml"],
  2: ["Body Splash Cherry Blossom 250ml", "Body Splash Pink Dream 250ml", "Body Splash Sweet Vanilla 250ml", "Body Splash Coconut 250ml", "Body Splash Fresh Mint 250ml", "Body Splash Lavanda 250ml"],
  3: ["Body Cream Cherry Blossom 200g", "Body Cream Pink Dream 200g", "Body Cream Vanilla 200g", "Body Cream Coconut 200g", "Body Cream Karité 200g"],
  4: ["Shampoo Reconstrução 300ml", "Condicionador Reconstrução 300ml", "Máscara Hidratação 250g", "Leave-in Proteção 150ml", "Fortalecedor Wedrop Incolor"],
  5: ["Sérum Vitamina C 30ml", "Hidratante Facial FPS 30", "Gel de Limpeza 150ml", "Máscara Facial Argila 80g"],
  6: ["Batom Matte Rosé", "Gloss Pink Shine", "Máscara de Cílios Volume", "Blush Pêssego"],
  7: ["Kit Presente Cherry Blossom", "Kit Presente Pink Dream", "Kit Body Splash Trio", "Kit Dia das Mães"],
  8: ["Colágeno Verisol 30 doses", "Creatina 300g", "Whey Protein 900g", "Multivitamínico 60 cáps", "Ômega 3 60 cáps"],
};

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distribui a receita e a margem da categoria entre produtos, de forma deterministica. */
export function productsOfCategory(categoriaId: number, escopo: string, receita: number, margem: number, itens: number): ProductSummary[] {
  const cat = categorias.find((c) => c.id === categoriaId);
  const nomes = NOMES[categoriaId] ?? [];
  if (!cat || nomes.length === 0) return [];
  const r = prng(categoriaId * 7919 + escopo.length * 31);
  const pesos = nomes.map((_, i) => Math.pow(0.72, i) * (0.8 + r() * 0.4));
  const soma = pesos.reduce((s, x) => s + x, 0);
  return nomes
    .map((nome, i) => {
      const fr = pesos[i] / soma;
      const rec = Math.round(receita * fr);
      const mg = Math.round(margem * fr * (0.9 + r() * 0.2));
      const cobertura = r() < 0.12 ? null : Math.round(6 + r() * 90);
      return {
        codProduto: `${categoriaId}${String(i + 1).padStart(3, "0")}`,
        nome,
        receita: rec,
        itens: Math.round(itens * fr),
        margem: mg,
        margemPct: rec > 0 ? (mg / rec) * 100 : 0,
        coberturaDias: cobertura,
        bloqueadoCompra: nome.includes("Wedrop") || r() < 0.08,
      };
    })
    .sort((a, b) => b.receita - a.receita);
}
