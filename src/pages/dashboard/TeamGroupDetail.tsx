import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, ThSort, type SortDir } from "@/components/ui";
import { AreaLineChart } from "@/components/charts";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import {
  buildTeamGroupDetail,
  type Scope,
  type TeamAggInput,
  type TeamDashboardView,
  type TeamGroupDetail,
  type TeamGroupPersonRow,
} from "@/data/wedash/dashboard";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { DetailSkeleton, MetricDetail, pctFmt, TipHelp } from "@/pages/dashboard/ProductDetail";
import { brlCent, num, comparedWithTip } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";

type SortKey = "name" | "revenue" | "sales" | "averageTicket" | "pa" | "participationPct";

/**
 * Detalhe de um grupo do card Faturamento por grupo.
 * `view` = view já montada na tela (com rateio de meta, se houver).
 * `onPerson` = abre o detalhe da pessoa.
 */
export function useTeamGroupDetail({
  scope,
  data,
  view,
  onPerson,
}: {
  scope: Scope;
  data?: TeamAggInput;
  view?: TeamDashboardView | null;
  onPerson?: (key: string, name: string) => void;
}): { open: (shiftName: string) => void; modal: ReactNode } {
  const [shiftName, setShiftName] = useState<string | null>(null);
  const open = useCallback((name: string) => setShiftName(name), []);

  useEffect(() => {
    setShiftName(null);
  }, [scope]);

  const detail = useMemo(() => {
    if (!shiftName || !data) return null;
    return buildTeamGroupDetail(scope, data, shiftName, view ? { view } : undefined);
  }, [shiftName, data, scope, view]);

  const modal = (
    <TeamGroupDetailModal
      open={shiftName != null}
      loading={shiftName != null && !data}
      title={shiftName ?? undefined}
      detail={detail}
      onClose={() => setShiftName(null)}
      onPerson={(key, name) => {
        setShiftName(null);
        onPerson?.(key, name);
      }}
    />
  );
  return { open, modal };
}

function storesLabel(storeRows: string[]): string | null {
  if (storeRows.length === 0) return null;
  return storeRows.length > 1 ? `${storeRows[0]} · +${storeRows.length - 1}` : storeRows[0]!;
}

function TeamGroupDetailModal({
  open,
  loading,
  title,
  detail,
  onClose,
  onPerson,
}: {
  open: boolean;
  loading: boolean;
  title?: string;
  detail: TeamGroupDetail | null;
  onClose: () => void;
  onPerson: (key: string, name: string) => void;
}) {
  const cmp = detail?.comparison;
  const subtitle = detail
    ? [
        detail.schedule,
        detail.period.label,
        detail.unattributed
          ? null
          : `${detail.people.length} ${detail.people.length === 1 ? "pessoa" : "pessoas"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Modal open={open} onClose={onClose} title={detail?.name ?? title} size="lg">
      {loading ? (
        <DetailSkeleton />
      ) : !detail ? (
        <div className="flex min-h-[220px] flex-col">
          <EmptyBlock />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="-mt-1 text-[12px] font-semibold text-t2">{subtitle}</p>

          <div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <MetricDetail label="Faturamento" amount={brlCent(detail.revenue)} delta={cmp?.revenue} />
              <MetricDetail
                label="Nº de vendas"
                amount={detail.unattributed ? "—" : num(detail.sales)}
                delta={cmp?.sales}
              />
              <MetricDetail
                label="Ticket médio"
                amount={detail.unattributed || detail.sales === 0 ? "—" : brlCent(detail.averageTicket)}
                delta={cmp?.ticket}
              />
              <MetricDetail
                label="P.A."
                amount={detail.pa == null ? "—" : num(detail.pa, 2)}
                delta={cmp?.pa}
                tip="Média de itens por venda."
              />
              <MetricDetail label="Itens vendidos" amount={detail.pa == null ? "—" : num(detail.items)} />
              <MetricDetail
                label="Participação"
                amount={pctFmt(detail.participationPct)}
                tip={
                  detail.unattributed
                    ? "Participação da venda sem vendedor no faturamento total das filiais no período."
                    : "Participação do grupo no faturamento da equipe no período."
                }
              />
            </div>
            <p className="mt-2.5 text-[11.5px] text-t2">
              {detail.unattributed
                ? "Vendas sem vendedor identificado — não há pessoas neste grupo."
                : cmp
                  ? `Variação ${comparedWithTip(cmp.vs).replace(/^Em/, "em")}`
                  : "Sem vendas no período anterior para comparar."}
              {!detail.unattributed && detail.pa == null && detail.sales > 0
                ? " P.A. e itens vendidos ficam indisponíveis quando faltam dados de itens no período."
                : ""}
            </p>
          </div>

          {detail.series && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-t0">
                Faturamento {detail.seriesGranularity === "month" ? "por mês" : "por dia"}
              </h4>
              <AreaLineChart
                data={detail.series.map((d) => d.revenue)}
                labels={detail.series.map((d) => d.label)}
                tooltipLabels={detail.series.map((d) => d.detail ?? d.label)}
                formatValue={brlCent}
                height={200}
                showAxisLabels
              />
            </section>
          )}

          {detail.unattributed ? (
            <div className="flex min-h-[140px] flex-col">
              <EmptyBlock
                icon="🧾"
                title="Sem pessoas neste grupo"
                description="Este faturamento veio de vendas sem vendedor identificado no Millennium."
              />
            </div>
          ) : (
            <GroupPeopleTable people={detail.people} multiStore={detail.multiStore} onPerson={onPerson} />
          )}
        </div>
      )}
    </Modal>
  );
}

function GroupPeopleTable({
  people,
  multiStore,
  onPerson,
}: {
  people: TeamGroupPersonRow[];
  multiStore: boolean;
  onPerson: (key: string, name: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>("revenue");
  const [dir, setDir] = useState<SortDir>("desc");
  const lines = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...people].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR") * d;
      const va = a[sort];
      const vb = b[sort];
      if (va == null && vb == null) return b.revenue - a.revenue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return ((va as number) - (vb as number)) * d || b.revenue - a.revenue;
    });
  }, [people, sort, dir]);

  const toggle = (k: SortKey) => {
    if (sort === k) setDir((x) => (x === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "name" ? "asc" : "desc");
    }
  };

  if (people.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col">
        <EmptyBlock title="Nenhuma pessoa neste grupo" description="Ninguém do grupo vendeu no período." />
      </div>
    );
  }

  return (
    <section>
      <h4 className="mb-2 text-[13px] font-bold text-t0">Equipe do grupo</h4>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
              <th className="px-1 pb-3 text-left font-bold">#</th>
              <ThSort label="Nome" active={sort === "name"} dir={dir} onClick={() => toggle("name")} align="left" className="px-1 pb-3" />
              <ThSort label="Faturamento" active={sort === "revenue"} dir={dir} onClick={() => toggle("revenue")} className="px-1 pb-3" />
              <ThSort label="Nº de vendas" active={sort === "sales"} dir={dir} onClick={() => toggle("sales")} className="px-1 pb-3" />
              <ThSort label="Ticket médio" active={sort === "averageTicket"} dir={dir} onClick={() => toggle("averageTicket")} className="px-1 pb-3" />
              <ThSort label="P.A." active={sort === "pa"} dir={dir} onClick={() => toggle("pa")} className="px-1 pb-3" />
              <th className="px-1 pb-3 text-right font-bold">
                <span className="inline-flex items-center gap-1">
                  Participação
                  <TipHelp label="Participação da pessoa no faturamento deste grupo no período." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((p, idx) => {
              const store = multiStore ? storesLabel(p.storeRows) : null;
              return (
                <tr
                  key={p.key}
                  tabIndex={0}
                  onClick={() => onPerson(p.key, p.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPerson(p.key, p.name);
                    }
                  }}
                  className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                >
                  <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                  <td className="px-1 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <PersonAvatar name={p.name} employeeId={p.key} storeId={p.storeIds[0]} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-t0">{p.name}</p>
                        {store &&
                          (p.storeRows.length > 1 ? (
                            <Tooltip label={p.storeRows.slice(1).join(" · ")}>
                              <p className="truncate text-[11px] text-t2">{store}</p>
                            </Tooltip>
                          ) : (
                            <p className="truncate text-[11px] text-t2">{store}</p>
                          ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.revenue)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.sales)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.averageTicket)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.pa == null ? "text-t2" : "text-t0")}>
                    {p.pa == null ? "—" : num(p.pa, 2)}
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{pctFmt(p.participationPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
