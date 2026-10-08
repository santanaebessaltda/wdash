import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Modal, ProgressBar, Skeleton, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart } from "@/components/charts";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import {
  buildAbcClassDetail,
  buildCategoryDetail,
  buildProductDetail,
  buildProductLineDetail,
  buildProductsView,
  financeFetchRange,
  productsFetchRange,
  resolvePeriod,
  type AbcClass,
  type ProductDetail,
  type ProductDetailCategory,
  type ProductDetailItem,
  type ProductsAggInput,
  type ProductsView,
  type Scope,
} from "@/data/wedash/dashboard";
import {
  fetchProductCatalogDescriptions,
  fetchProductCatalogTypes,
  fetchSalesCategoryDayAggs,
  fetchSalesDayAggs,
  fetchSalesHourAggs,
  fetchSalesProductCostDayAggs,
  fetchSalesProductDayAggs,
} from "@/data/wedash/salesRepo";
import type { SalesHourAgg } from "@/data/wedash/salesTypes";
import { calendarTodayIso } from "@/data/wedash/clock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { brlCent, num, tipDelta, tipRelacao } from "@/lib/format";
import { cn } from "@/lib/cn";

type Delta = { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string };

export const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
      ?
    </span>
  </Tooltip>
);

/** Badge de delta  -  so % no chip; base do comparativo no tooltip (igual StatCard). */
export function BadgeVsAnterior({ delta, metrica }: { delta?: Delta; metrica?: string }) {
  if (!delta) return null;
  const badge = (
    <Badge variant={delta.positive ? "success" : "danger"}>
      {delta.positive ? "+" : "−"}
      {delta.value}
    </Badge>
  );
  const tip = tipDelta(delta, metrica);
  return tip ? <Tooltip label={tip}>{badge}</Tooltip> : badge;
}

export const pctFmt = (v: number | null, casas = 1) => (v == null ? "—" : `${v.toFixed(casas).replace(".", ",")}%`);
export const moneyOrDash = (v: number | null) => (v == null ? "—" : brlCent(v));

/* ---------- Dados ---------- */

/** Tudo o que a tela Produtos le  -  tambem usado pelo detalhe aberto de outras telas. */
export async function fetchProductsAggInput(tenantId: string, escopo: Scope): Promise<ProductsAggInput> {
  const periodo = resolvePeriod(escopo.periodo, calendarTodayIso());
  const range = financeFetchRange(escopo);
  const prodRange = productsFetchRange(escopo);
  const storeIds = escopo.filialIds;
  const [dayAggs, hourAggs, prevHourAggs, categoryDayAggs, productDayAggs, productCostDayAggs, catalogDescriptions, catalogTypes] =
    await Promise.all([
      fetchSalesDayAggs({ tenantId, storeIds, from: range.from, to: range.to, brand: null }),
      periodo.inicio === periodo.fim
        ? fetchSalesHourAggs({ tenantId, storeIds, day: periodo.inicio, brand: null })
        : Promise.resolve([] as SalesHourAgg[]),
      range.prevHourDay
        ? fetchSalesHourAggs({ tenantId, storeIds, day: range.prevHourDay, brand: null })
        : Promise.resolve([] as SalesHourAgg[]),
      fetchSalesCategoryDayAggs({ tenantId, storeIds, from: prodRange.from, to: prodRange.to, brand: null }),
      fetchSalesProductDayAggs({ tenantId, storeIds, from: prodRange.from, to: prodRange.to }),
      fetchSalesProductCostDayAggs({ tenantId, storeIds, from: prodRange.from, to: prodRange.to }),
      fetchProductCatalogDescriptions(),
      fetchProductCatalogTypes(),
    ]);
  return { dayAggs, hourAggs, prevHourAggs, categoryDayAggs, productDayAggs, productCostDayAggs, catalogDescriptions, catalogTypes };
}

export interface ProductsDetailData {
  aggs: ProductsAggInput;
  view: ProductsView;
}

/** O que abrir no detalhe  -  por chave, para outras telas abrirem sem ter as linhas da tela Produtos. */
export type ProductSelection =
  | { tipo: "produto"; chave: string; nome: string }
  | { tipo: "linha"; nome: string }
  | { tipo: "categoria"; nome: string; categoriaId?: number }
  | { tipo: "classe"; classe: AbcClass };

const nomeSelecao = (s: ProductSelection) => (s.tipo === "classe" ? `Classe ${s.classe}` : s.nome);

function montarDetalhe(escopo: Scope, { aggs, view }: ProductsDetailData, s: ProductSelection): ProductDetail | null {
  switch (s.tipo) {
    case "produto": {
      const row = view.produtos.find((p) => p.chave === s.chave);
      return row ? buildProductDetail(escopo, aggs, row) : null;
    }
    case "linha": {
      const row = view.linhas.find((l) => l.nome === s.nome);
      return row ? buildProductLineDetail(escopo, aggs, row) : null;
    }
    case "categoria": {
      const row = view.curvaAbcCategorias.itens.find((c) =>
        s.categoriaId != null ? c.categoriaId === s.categoriaId : c.nome === s.nome,
      );
      return row ? buildCategoryDetail(escopo, aggs, row) : null;
    }
    case "classe":
      return buildAbcClassDetail(escopo, aggs, view, s.classe);
  }
}

/**
 * Detalhe de produto / linha / categoria / classe com navegacao em pilha (" <-  Voltar").
 * Com `data` usa os dados da tela; sem `data` busca os dados de Produtos so ao abrir.
 */
export function useProductDetail({
  escopo,
  data,
  tenantId,
}: {
  escopo: Scope;
  data?: ProductsDetailData;
  tenantId?: string;
}): { abrir: (s: ProductSelection) => void; modal: ReactNode } {
  const [pilha, setPilha] = useState<ProductSelection[]>([]);
  const topo = pilha.at(-1) ?? null;
  const abrir = useCallback((s: ProductSelection) => setPilha([s]), []);
  const empilhar = (s: ProductSelection) => setPilha((p) => [...p, s]);

  useEffect(() => {
    setPilha([]);
  }, [escopo]);

  // Custos/impostos das lojas chegam depois do 1 render  ->  recalcula.
  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const lazy = useLazyProductsData(escopo, tenantId, !data && topo != null);
  const fonte = data ?? lazy;

  const detalhe = useMemo(
    () => (topo && fonte ? montarDetalhe(escopo, fonte, topo) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topo, fonte, escopo, storesTick],
  );

  const modal = (
    <ProductDetailModal
      open={topo != null}
      loading={topo != null && !fonte}
      titulo={topo ? nomeSelecao(topo) : undefined}
      detalhe={detalhe}
      periodo={resolvePeriod(escopo.periodo, calendarTodayIso()).rotulo}
      onClose={() => setPilha([])}
      onProduto={(chave) => {
        const row = fonte?.view.produtos.find((p) => p.chave === chave);
        if (row) empilhar({ tipo: "produto", chave, nome: row.nome });
      }}
      onCategoria={(id) => {
        const row = fonte?.view.curvaAbcCategorias.itens.find((c) => c.categoriaId === id);
        if (row) empilhar({ tipo: "categoria", categoriaId: id, nome: row.nome });
      }}
      voltarPara={pilha.length > 1 ? nomeSelecao(pilha[pilha.length - 2]) : undefined}
      onVoltar={() => setPilha((p) => p.slice(0, -1))}
    />
  );

  return { abrir, modal };
}

/** Busca os dados de Produtos na 1 abertura; mantem ate mudar o filtro ou chegar venda nova. */
function useLazyProductsData(escopo: Scope, tenantId: string | undefined, enabled: boolean): ProductsDetailData | null {
  const [data, setData] = useState<ProductsDetailData | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current++;
    setData(null);
  }, [escopo, tenantId]);

  useEffect(() => {
    const onSynced = () => {
      gen.current++;
      setData(null);
    };
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (!enabled || !tenantId || data) return;
    const g = ++gen.current;
    fetchProductsAggInput(tenantId, escopo)
      .then((aggs) => {
        if (g === gen.current) setData({ aggs, view: buildProductsView(escopo, aggs) });
      })
      .catch((e) => {
        console.error("Product detail load:", e);
        if (g !== gen.current) return;
        const vazio: ProductsAggInput = { dayAggs: [] };
        setData({ aggs: vazio, view: buildProductsView(escopo, vazio) });
      });
  }, [enabled, tenantId, data, escopo]);

  return data;
}

/* ---------- Modal ---------- */

type TopSort = "nome" | "itens" | "faturamento" | "lucro" | "margem";

const valorDoSort = (r: { itens: number; faturamento: number; lucro: number | null; margemPct: number | null }, sort: TopSort) =>
  sort === "itens" ? r.itens : sort === "lucro" ? r.lucro : sort === "margem" ? r.margemPct : r.faturamento;

function CelulaLucro({ v }: { v: number | null }) {
  return (
    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", v == null ? "text-t2" : v < 0 ? "text-bad" : "text-ok")}>
      {v == null ? "—" : brlCent(v)}
    </td>
  );
}

export function MetricaDetalhe({
  label,
  valor,
  delta,
  destaque,
  tip,
}: {
  label: string;
  valor: string;
  delta?: Delta;
  destaque?: boolean;
  tip?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg-inset p-3">
      <p className="flex items-center gap-1 text-[11.5px] font-semibold text-t2">
        {label}
        {tip && <TipHelp label={tip} />}
      </p>
      <p className={cn("mt-1 font-mono text-[15px] font-extrabold tabular-nums", valor === "—" ? "text-t2" : destaque ? "text-ok" : "text-t0")}>
        {valor}
      </p>
      {delta && (
        <div className="mt-1.5">
          <BadgeVsAnterior delta={delta} />
        </div>
      )}
    </div>
  );
}

/** Mesmo padrao da tabela Top produtos (#  |  Produto  |  Itens  |  Faturamento  |  Lucro bruto  |  Margem); clique abre o produto. */
function ProdutosDoGrupo({ produtos, onProduto }: { produtos: ProductDetailItem[]; onProduto: (chave: string) => void }) {
  const [sort, setSort] = useState<TopSort>("faturamento");
  const [dir, setDir] = useState<SortDir>("desc");
  const linhas = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...produtos].sort((a, b) => {
      if (sort === "nome") return a.nome.localeCompare(b.nome, "pt-BR") * d;
      const va = valorDoSort(a, sort);
      const vb = valorDoSort(b, sort);
      if (va == null && vb == null) return b.faturamento - a.faturamento;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * d || b.faturamento - a.faturamento;
    });
  }, [produtos, sort, dir]);
  const alternar = (k: TopSort) => {
    if (sort === k) setDir((x) => (x === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "nome" ? "asc" : "desc");
    }
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
            <th className="px-1 pb-3 text-left font-bold">#</th>
            <ThSort label="Produto" active={sort === "nome"} dir={dir} onClick={() => alternar("nome")} align="left" className="px-1 pb-3" />
            <ThSort label="Itens vendidos" active={sort === "itens"} dir={dir} onClick={() => alternar("itens")} className="px-1 pb-3" />
            <ThSort label="Faturamento" active={sort === "faturamento"} dir={dir} onClick={() => alternar("faturamento")} className="px-1 pb-3" />
            <ThSort label="Lucro bruto" active={sort === "lucro"} dir={dir} onClick={() => alternar("lucro")} className="px-1 pb-3" />
            <ThSort label="Margem" active={sort === "margem"} dir={dir} onClick={() => alternar("margem")} className="px-1 pb-3" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((p, idx) => (
            <tr
              key={p.chave}
              tabIndex={0}
              onClick={() => onProduto(p.chave)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onProduto(p.chave);
                }
              }}
              className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
            >
              <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
              <td className="px-1 py-3">
                <ProductNameCell nome={p.nome} idx={idx} sub={p.codigo} />
              </td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.itens)}</td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.faturamento)}</td>
              <CelulaLucro v={p.lucro} />
              <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.margemPct == null ? "text-t2" : "text-ok")}>
                {pctFmt(p.margemPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Categorias de uma classe da Curva ABC  -  padrao da tabela Top produtos; clique abre a categoria. */
function CategoriasDaClasse({
  categorias,
  onCategoria,
}: {
  categorias: ProductDetailCategory[];
  onCategoria: (categoriaId: number) => void;
}) {
  const [sort, setSort] = useState<TopSort>("faturamento");
  const [dir, setDir] = useState<SortDir>("desc");
  const linhas = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...categorias].sort((a, b) => {
      if (sort === "nome") return a.nome.localeCompare(b.nome, "pt-BR") * d;
      const va = valorDoSort(a, sort);
      const vb = valorDoSort(b, sort);
      if (va == null && vb == null) return b.faturamento - a.faturamento;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * d || b.faturamento - a.faturamento;
    });
  }, [categorias, sort, dir]);
  const alternar = (k: TopSort) => {
    if (sort === k) setDir((x) => (x === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "nome" ? "asc" : "desc");
    }
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
            <th className="px-1 pb-3 text-left font-bold">#</th>
            <ThSort label="Categoria" active={sort === "nome"} dir={dir} onClick={() => alternar("nome")} align="left" className="px-1 pb-3" />
            <ThSort label="Itens vendidos" active={sort === "itens"} dir={dir} onClick={() => alternar("itens")} className="px-1 pb-3" />
            <ThSort label="Faturamento" active={sort === "faturamento"} dir={dir} onClick={() => alternar("faturamento")} className="px-1 pb-3" />
            <ThSort label="Lucro bruto" active={sort === "lucro"} dir={dir} onClick={() => alternar("lucro")} className="px-1 pb-3" />
            <ThSort label="Margem" active={sort === "margem"} dir={dir} onClick={() => alternar("margem")} className="px-1 pb-3" />
            <th className="px-1 pb-3 text-right font-bold">
              <span className="inline-flex items-center gap-1">
                Participação
                <TipHelp label="Participação da categoria no faturamento de todas as categorias e, abaixo, o acumulado que define a classe (A até 80%, B até 95%)." />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((c, idx) => (
            <tr
              key={c.categoriaId}
              tabIndex={0}
              onClick={() => onCategoria(c.categoriaId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCategoria(c.categoriaId);
                }
              }}
              className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
            >
              <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
              <td className="px-1 py-3">
                <ProductNameCell nome={c.nome} idx={idx} />
              </td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(c.itens)}</td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(c.faturamento)}</td>
              <CelulaLucro v={c.lucro} />
              <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", c.margemPct == null ? "text-t2" : "text-ok")}>
                {pctFmt(c.margemPct)}
              </td>
              <td className="px-1 py-3 text-right">
                <p className="font-mono text-[13px] font-bold text-t0">{pctFmt(c.pct)}</p>
                <p className="text-[11px] text-t2">acum. {pctFmt(c.pctAcumulado)}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetalheSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-3.5 w-48" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[200px] rounded-xl" />
    </div>
  );
}

function ProductDetailModal({
  open,
  loading,
  titulo,
  detalhe,
  periodo,
  onClose,
  onProduto,
  onCategoria,
  voltarPara,
  onVoltar,
}: {
  open: boolean;
  loading: boolean;
  titulo?: string;
  detalhe: ProductDetail | null;
  periodo: string;
  onClose: () => void;
  onProduto: (chave: string) => void;
  onCategoria: (categoriaId: number) => void;
  /** Nome do detalhe anterior (aberto a partir dele). */
  voltarPara?: string;
  onVoltar: () => void;
}) {
  const cmp = detalhe?.comparativo;
  const tipo = detalhe?.tipo ?? "produto";
  const artigo = { produto: "do produto", linha: "da linha", categoria: "da categoria", classe: "da classe" }[tipo];
  const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
  const subtitulo = !detalhe
    ? ""
    : tipo === "linha"
      ? ["Linha de produto", plural(detalhe.produtos.length, "produto"), periodo].join(" · ")
      : tipo === "categoria"
        ? ["Categoria", detalhe.classe ? `Classe ${detalhe.classe}` : "", plural(detalhe.produtos.length, "produto"), periodo]
            .filter(Boolean)
            .join(" · ")
        : tipo === "classe"
          ? ["Curva ABC", plural(detalhe.categorias.length, "categoria"), periodo].join(" · ")
          : [detalhe.codigo, periodo].filter(Boolean).join(" · ");
  return (
    <Modal open={open} onClose={onClose} title={detalhe?.nome ?? titulo} size="lg">
      {loading ? (
        <DetalheSkeleton />
      ) : !detalhe ? (
        <div className="flex min-h-[220px] flex-col">
          <EmptyBlock />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="-mt-1">
            {voltarPara && (
              <button type="button" onClick={onVoltar} className="mb-1.5 text-[12px] font-semibold text-acc hover:underline">
                ← Voltar para {voltarPara}
              </button>
            )}
            <p className="text-[12px] font-semibold text-t2">{subtitulo}</p>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MetricaDetalhe label="Faturamento" valor={brlCent(detalhe.faturamento)} delta={cmp?.faturamento} />
              <MetricaDetalhe label="Itens vendidos" valor={num(detalhe.itens)} delta={cmp?.itens} />
              <MetricaDetalhe label="Preço médio" valor={brlCent(detalhe.precoMedio)} />
              <MetricaDetalhe
                label="Participação"
                valor={pctFmt(detalhe.participacaoPct)}
                tip={`Participação ${artigo} no faturamento de todos os produtos do período.`}
              />
              <MetricaDetalhe label="CMV" valor={moneyOrDash(detalhe.cmv)} />
              <MetricaDetalhe label="Lucro bruto" valor={moneyOrDash(detalhe.lucro)} destaque />
              <MetricaDetalhe label="Margem" valor={pctFmt(detalhe.margemPct)} delta={cmp?.margem} />
            </div>
            <p className="mt-2.5 text-[11.5px] text-t2">
              {cmp
                ? `Variação ${tipRelacao(cmp.vs).replace(/^Em/, "em")}`
                : `Sem vendas ${artigo} no período anterior para comparar.`}
              {detalhe.cmv == null && " CMV, lucro e margem ficam indisponíveis quando faltam dados de custo no período."}
            </p>
          </div>

          {detalhe.serie && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-t0">
                Faturamento {detalhe.serieGranularidade === "mes" ? "por mês" : "por dia"}
              </h4>
              <AreaLineChart
                data={detalhe.serie.map((d) => d.faturamento)}
                labels={detalhe.serie.map((d) => d.label)}
                formatValue={brlCent}
                height={200}
                showAxisLabels
              />
            </section>
          )}

          {(tipo === "linha" || tipo === "categoria") && detalhe.produtos.length > 0 && (
            <section>
              <h4 className="text-[13px] font-bold text-t0">Produtos {artigo}</h4>
              {detalhe.tipos.length > 0 && <p className="mt-0.5 text-[11.5px] text-t2">{detalhe.tipos.join(" · ")}</p>}
              <ProdutosDoGrupo key={`${tipo}-${detalhe.chave}`} produtos={detalhe.produtos} onProduto={onProduto} />
            </section>
          )}

          {tipo === "classe" && detalhe.categorias.length > 0 && (
            <section>
              <h4 className="text-[13px] font-bold text-t0">Categorias da classe</h4>
              <CategoriasDaClasse key={detalhe.chave} categorias={detalhe.categorias} onCategoria={onCategoria} />
            </section>
          )}

          {detalhe.lojas.length > 0 && (
            <section>
              <h4 className="mb-3 text-[13px] font-bold text-t0">Vendas por loja</h4>
              <div className="flex flex-col gap-3">
                {detalhe.lojas.map((l) => (
                  <div key={l.filialId}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{l.nome}</span>
                      <span className="shrink-0 text-[11.5px] text-t2">
                        {num(l.itens)} ite{l.itens === 1 ? "m" : "ns"}
                      </span>
                      <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(l.faturamento)}</span>
                      <span className="min-w-[40px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pctFmt(l.pct, 0)}</span>
                    </div>
                    <ProgressBar value={l.pct} color="var(--acc)" height={6} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
