import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Breadcrumbs, Button, Card, CardTitle } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { ChallengeDetailSkeleton } from "@/components/wedash/LoadingSkeletons";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { usesMinSales } from "@/data/wedash/challengeForm";
import {
  fetchChallenge,
  fetchChallengeInput,
  isIndexMetric,
  usesScope,
  type ChallengeAggInput,
  type ChallengeRecord,
} from "@/data/wedash/challengesRepo";
import {
  buildChallengeView,
  challengePayout,
  CHALLENGE_METRIC_LABEL,
  CHALLENGE_MODE_LABEL,
  CHALLENGE_SCOPE_LABEL,
  CHALLENGE_STATUS_LABEL,
  metricValueLabel,
  prizeLabel,
  type ChallengeView,
} from "@/data/wedash/challengeView";
import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession } from "@/data/wedash/stores";
import { brlCent, dataCompleta, dataCurta, deIso, num, paraIso } from "@/lib/format";
import { exportPdf } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import {
  CHALLENGE_MODE_HELP,
  CHALLENGE_STATUS_VARIANT,
  challengeCriterion,
  challengeHeadline,
} from "@/pages/challenges/shared";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useReturnWhenStoreChanges } from "@/pages/dashboard/useScope";
import { FlameIcon } from "@/pages/dashboards/icons";
import { Icon, icons } from "@/pages/users/Icons";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";

type Loaded = { challenge: ChallengeRecord | null; aggs: ChallengeAggInput | null };

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1">
      ?
    </span>
  </Tooltip>
);

const GERENCIA_RESULTADO: Record<ChallengeRecord["metric"], string> = {
  QUANTITY: "Média por pessoa",
  VALUE: "Faturamento médio por pessoa",
  PA: "P.A. da equipe",
  TICKET: "Ticket médio da equipe",
  INDEX: "Índice da equipe",
};

const ORDINAL = ["1º", "2º", "3º"];

/** "  |  meta de 2,00"  |  Indice: "  |  indice da equipe de 105,0". */
function managerGoalText(c: ChallengeRecord): string {
  if (c.managerTarget == null) return "";
  const valor = metricValueLabel(c.metric, c.managerTarget);
  return isIndexMetric(c.metric) ? ` · índice da equipe de ${valor}` : ` · meta de ${valor}`;
}

/** Gestao > Desafios > detalhe  -  resumo e participantes; encerrado = fechamento com quem ganhou o que. */
export default function ChallengeDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const session = useActiveSession();
  const today = calendarTodayIso();
  const [data, setData] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [duplicarAberto, setDuplicarAberto] = useState(false);
  const hasOtherStores = storesForSession(session.stores).length > 1;
  useReturnWhenStoreChanges(data?.challenge?.storeId, paths.management.challenges);

  useEffect(() => {
    const onSync = () => setReload((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSync);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const challenge = await fetchChallenge(session.tenantId, id);
      const aggs = challenge ? await fetchChallengeInput({ tenantId: session.tenantId, challenges: [challenge], today }) : null;
      if (!cancelled) setData({ challenge, aggs });
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, id, today, reload]);

  const showSkeleton = useMinSkeleton(data === null);
  const challenge = data?.challenge ?? null;
  const loja = useMemo(
    () => (challenge ? storesForSession(session.stores).find((s) => s.id === challenge.storeId) : undefined),
    [challenge, session.stores],
  );
  const view = useMemo(
    () => (data?.challenge && data.aggs ? buildChallengeView({ challenge: data.challenge, aggs: data.aggs, today }) : null),
    [data, today],
  );

  const voltar = () => navigate(paths.management.challenges);
  const periodo = challenge ? `${dataCompleta(challenge.startsOn)} a ${dataCompleta(challenge.endsOn)}` : "";

  return (
    <div>
      {challenge && view?.status === "ended" && <PayoutReportHeader challenge={challenge} lojaNome={loja?.fantasia} />}
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} onClick={voltar}>
          Voltar
        </Button>
        <Breadcrumbs
          items={[{ label: "Gestão" }, { label: "Desafios", to: paths.management.challenges }, { label: challenge?.name ?? "Detalhe" }]}
        />
        {challenge && !showSkeleton && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDuplicarAberto(true)}>
              Duplicar desafio
            </Button>
            <Button size="sm" onClick={() => navigate(paths.management.challengeEdit(challenge.id))}>
              Editar desafio
            </Button>
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicarAberto}
        onClose={() => setDuplicarAberto(false)}
        kind="desafio"
        name={challenge?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!challenge) return;
          setDuplicarAberto(false);
          navigate(
            choice === "store"
              ? paths.management.challengeCopyStore(challenge.id)
              : paths.management.challengeCopy(challenge.id),
          );
        }}
      />

      {showSkeleton ? (
        <ChallengeDetailSkeleton />
      ) : !challenge || !view ? (
        <Card className="flex min-h-[280px] flex-col">
          <EmptyBlock
            icon="🔍"
            title="Desafio não encontrado"
            description="O desafio pode ter sido excluído ou não pertencer às suas lojas."
            action={
              <Button size="sm" variant="outline" onClick={voltar}>
                Voltar para Desafios
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <ChallengeHero challenge={challenge} view={view} lojaNome={loja?.fantasia} />

          {view.diasIncompletos.length > 0 && (
            <div className="mb-5 print:hidden">
              <Alert variant="warning" title="Resultado incompleto">
                Os itens por pessoa ainda não foram carregados para {diasTexto(view.diasIncompletos)}. O resultado pode mudar quando{" "}
                {view.diasIncompletos.length === 1 ? "esse dia for atualizado." : "esses dias forem atualizados."}
              </Alert>
            </div>
          )}

          {view.status === "ended" && (
            <ChallengePayoutCard
              challenge={challenge}
              view={view}
              onExport={() => exportPdf(["Fechamento do desafio", loja?.fantasia ?? "", challenge.name, periodo])}
            />
          )}
          <ParticipantsCard challenge={challenge} view={view} />
        </>
      )}
    </div>
  );
}

function diasTexto(dias: string[]): string {
  if (dias.length === 1) return dataCurta(dias[0]!);
  const lista = dias.map(dataCurta);
  return `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

function prizesText(c: ChallengeRecord): string {
  if (c.mode === "MINIMUM") return c.prizes[0] ? `${prizeLabel(c.prizes[0])} por pessoa` : "—";
  return c.prizes.map((p, i) => `${ORDINAL[i]}: ${prizeLabel(p)}`).join(" · ") || "—";
}

/** "Body Splash VF Golden  |  Desod Col Obsessed  |  +2"  -  itens do desafio em uma linha. */
function itemsText(c: ChallengeRecord): string | null {
  if (!usesScope(c.metric)) return null;
  if (c.scope === "ALL") return CHALLENGE_SCOPE_LABEL.ALL;
  const nomes = c.scope === "PRODUCTS" ? c.products.map((p) => p.name) : c.categories.map((t) => t.name);
  if (nomes.length === 0) return null;
  if (nomes.length <= 3) return nomes.join(" · ");
  return `${nomes.slice(0, 2).join(" · ")} · +${nomes.length - 2}`;
}

function ChallengeHero({ challenge: c, view, lojaNome }: { challenge: ChallengeRecord; view: ChallengeView; lojaNome?: string }) {
  const destaque = challengeHeadline(c, view);
  const itens = itemsText(c);
  const usaVendas = usesMinSales(c.metric);
  const stats: { label: string; value: string; sub?: string; help?: string }[] = [
    { label: "Tipo", value: CHALLENGE_METRIC_LABEL[c.metric], sub: itens ?? undefined },
    {
      label: "Critério",
      value: challengeCriterion(c),
      sub: usaVendas && c.minSales ? `Para participar: ${num(c.minSales)} ${c.minSales === 1 ? "venda" : "vendas"}` : undefined,
    },
    {
      label: "Prêmios",
      value: prizesText(c),
      sub: c.managerPrize ? `Gerência: ${prizeLabel(c.managerPrize)}${managerGoalText(c)}` : undefined,
    },
    { label: destaque.label ?? "Resultado", value: destaque.value },
    { label: "Prazo", value: view.prazo },
  ];

  return (
    <Card padding="lg" className="mb-5">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-acc-soft text-acc">
          <FlameIcon size={26} />
        </span>
        <div className="min-w-[220px] flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-extrabold text-t0 sm:text-[22px]">{c.name}</h1>
            <Badge variant={CHALLENGE_STATUS_VARIANT[view.status]}>{CHALLENGE_STATUS_LABEL[view.status]}</Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] leading-relaxed text-t1">
            {dataCompleta(c.startsOn)} a {dataCompleta(c.endsOn)}
            {lojaNome ? ` · ${lojaNome}` : ""} · {CHALLENGE_MODE_LABEL[c.mode]}
            <TipHelp label={CHALLENGE_MODE_HELP[c.mode]} />
          </p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3.5 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">{s.label}</p>
            <p className="mt-1 text-[14px] font-extrabold leading-snug text-t0">{s.value}</p>
            {s.sub && <p className="mt-0.5 text-[11.5px] leading-snug text-t2">{s.sub}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ParticipantsCard({ challenge: c, view }: { challenge: ChallengeRecord; view: ChallengeView }) {
  const disputa = c.mode === "CONTEST";
  const aComecar = view.status === "upcoming";
  const usaVendas = usesMinSales(c.metric);
  const n = view.participantes.length;

  return (
    <Card className="mb-5 min-w-0 print:hidden">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Participantes</CardTitle>
          <p className="mt-0.5 text-[12px] text-t2">
            {aComecar
              ? "Os resultados aparecerão quando o desafio começar."
              : "Acompanhe o resultado de cada pessoa participante. Vendas sem vendedor identificado ou realizadas pela gerência não entram no ranking."}
          </p>
        </div>
        <span className="text-[12px] font-semibold text-t2">
          {n} {n === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>

      {view.gerencia && !aComecar && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-xl bg-bg-inset px-3.5 py-3 text-[12.5px]">
          <p className="font-bold text-t0">Gerência</p>
          <p className="flex items-center gap-1.5 text-t1">
            <span className="text-t2">{GERENCIA_RESULTADO[c.metric]}: </span>
            <span className="font-mono font-bold">{view.gerencia.resultado != null ? metricValueLabel(c.metric, view.gerencia.resultado) : "—"}</span>
            {view.gerencia.periodoAnterior && (
              <TipHelp
                label={`Compara a equipe durante o desafio com o período de ${dataCurta(view.gerencia.periodoAnterior.from)} a ${dataCurta(view.gerencia.periodoAnterior.to)}: 50% faturamento médio por pessoa, 25% ticket médio e 25% P.A. 100 representa o mesmo desempenho do período anterior. Com o desafio em andamento, os dois lados consideram até ontem.${view.gerencia.resultado == null ? " Fica indisponível no primeiro dia do desafio, sem vendas em um dos períodos ou quando faltam dados de itens." : ""}`}
              />
            )}
          </p>
          <p className="text-t1">
            <span className="text-t2">Meta da gerência: </span>
            <span className="font-mono font-bold">{metricValueLabel(c.metric, view.gerencia.alvo)}</span>
          </p>
          <p className="text-t1">
            <span className="text-t2">Prêmio: </span>
            <span className="font-bold">{prizeLabel(view.gerencia.premio)}</span>
          </p>
          <Badge variant={view.gerencia.atingiu ? "success" : "neutral"}>
            {view.gerencia.atingiu ? "Atingiu" : view.status === "ended" ? "Não atingiu" : "Ainda não atingiu"}
          </Badge>
        </div>
      )}

      {n === 0 ? (
        <EmptyBlock icon="👤" title="Nenhuma pessoa no desafio" description="Não há vendedores ativos nem vendas atribuídas à equipe no período." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 620 }}>
            <thead>
              <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wide text-t2">
                {disputa && <th className="w-10 pb-3 pr-3 text-left">#</th>}
                <th className="pb-3 pr-3 text-left">Nome</th>
                <th className="pb-3 pr-3 text-right">Resultado</th>
                {usaVendas && <th className="pb-3 pr-3 text-right">Vendas</th>}
                <th className="pb-3 pr-3 text-left">Situação</th>
                <th className="pb-3 text-right">Prêmio</th>
              </tr>
            </thead>
            <tbody>
              {view.participantes.map((p) => (
                <tr key={p.key} className="border-b border-line last:border-b-0">
                  {disputa && <td className="py-2.5 pr-3 font-mono font-bold text-t2">{p.posicao ?? "—"}</td>}
                  <td className="py-2.5 pr-3">
                    <p className="font-bold text-t0">{p.nome}</p>
                    {p.grupo && <p className="text-[11px] text-t2">{p.grupo}</p>}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono font-bold text-t0">
                    {aComecar ? "—" : p.resultado != null ? metricValueLabel(c.metric, p.resultado) : <SemItens indice={isIndexMetric(c.metric)} />}
                  </td>
                  {usaVendas && <td className="py-2.5 pr-3 text-right font-mono font-bold text-t1">{aComecar ? "—" : num(p.vendas)}</td>}
                  <td className="py-2.5 pr-3">
                    {p.vencedor ? (
                      <Badge variant="success">{p.posicao != null ? `${p.posicao}º lugar` : "Atingiu"}</Badge>
                    ) : (
                      <span className="text-t2">{p.falta ?? "—"}</span>
                    )}
                  </td>
                  <td className={`py-2.5 text-right font-semibold ${p.vencedor && p.premio ? "text-t0" : "text-t2"}`}>
                    {p.vencedor && p.premio ? prizeLabel(p.premio) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const SemItens = ({ indice }: { indice: boolean }) => (
  <Tooltip label={`${indice ? "Índice" : "Resultado"} indisponível porque faltam dados de itens em pelo menos um dia com vendas.`}>
    <span className="cursor-help">—</span>
  </Tooltip>
);

function PayoutReportHeader({ challenge: c, lojaNome }: { challenge: ChallengeRecord; lojaNome?: string }) {
  const agora = new Date();
  const geradoEm = `${agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return (
    <div className="mb-5 hidden border-b border-line pb-4 print:block">
      <div className="flex items-start justify-between gap-6">
        <WedashBrand size={28} />
        <p className="text-right text-[11px] leading-5 text-t2">Gerado em {geradoEm}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px]">
        {lojaNome && (
          <p>
            <span className="text-t2">Loja: </span>
            <span className="font-bold uppercase text-t0">{lojaNome}</span>
          </p>
        )}
        <p>
          <span className="text-t2">Desafio: </span>
          <span className="font-bold text-t0">{c.name}</span>
        </p>
        <p>
          <span className="text-t2">Período: </span>
          <span className="font-bold text-t0">
            {dataCompleta(c.startsOn)} a {dataCompleta(c.endsOn)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Desafio encerrado: quem ganhou o que. Outro premio (texto livre) aparece pelo nome e nao entra no total em R$. */
function ChallengePayoutCard({ challenge: c, view, onExport }: { challenge: ChallengeRecord; view: ChallengeView; onExport: () => void }) {
  const payout = challengePayout(view);
  const fimMais1 = deIso(c.endsOn);
  fimMais1.setDate(fimMais1.getDate() + 1);
  const linhas = [
    ...payout.vencedores.map((w, i) => ({ key: `p${i}`, nome: w.nome, sub: w.grupo, colocacao: w.colocacao, premio: w.premio })),
    ...(payout.gerencia
      ? [{ key: "gerencia", nome: "GERÊNCIA", sub: "Resultado da equipe", colocacao: "Atingiu", premio: payout.gerencia }]
      : []),
  ];
  const especie = contarEspecie(payout.especie);

  return (
    <Card className="mb-5 min-w-0 print:break-inside-avoid">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Fechamento do desafio</CardTitle>
            {view.emFechamento && (
              <Tooltip
                label={`O último dia do desafio será fechado na madrugada de ${dataCurta(paraIso(fimMais1))}. Vendas incluídas ou canceladas até lá ainda podem alterar o resultado.`}
              >
                <span className="inline-flex cursor-help">
                  <Badge variant="warning">Fechamento em andamento</Badge>
                </span>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-t2">Veja quem ganhou e o prêmio de cada pessoa.</p>
        </div>
        <Button variant="secondary" size="sm" className="print:hidden" onClick={onExport}>
          Exportar
        </Button>
      </div>

      {linhas.length === 0 ? (
        <EmptyBlock icon="🏁" title="Nenhum vencedor neste desafio" description="Ninguém atingiu o resultado necessário para receber o prêmio." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <div className="rounded-xl bg-bg-inset px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">Vencedores</p>
              <p className="mt-1 font-mono text-[16px] font-extrabold text-t0">{num(linhas.length)}</p>
            </div>
            <div className="rounded-xl bg-bg-inset px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">Prêmios em R$</p>
              <p className="mt-1 font-mono text-[16px] font-extrabold text-ok">{brlCent(payout.totalReais)}</p>
            </div>
            {especie.length > 0 && (
              <div className="col-span-2 rounded-xl bg-bg-inset px-3.5 py-3 sm:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">Outros prêmios</p>
                <p className="mt-1 text-[13px] font-bold leading-snug text-t0">{especie.join(" · ")}</p>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 480 }}>
              <thead>
                <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wide text-t2">
                  <th className="pb-3 pr-3 text-left">Nome</th>
                  <th className="pb-3 pr-3 text-left">Colocação</th>
                  <th className="pb-3 text-right">Prêmio</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => (
                  <tr key={r.key} className={`border-b border-line ${r.key === "gerencia" ? "bg-bg-inset" : ""}`}>
                    <td className="py-2.5 pr-3">
                      <p className="font-bold text-t0">{r.nome}</p>
                      {r.sub && <p className="text-[11px] text-t2">{r.sub}</p>}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-acc">{r.colocacao}</td>
                    <td
                      className={`py-2.5 text-right font-extrabold ${r.premio.kind === "MONEY" ? "font-mono text-ok" : "text-t0"}`}
                    >
                      {prizeLabel(r.premio)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-t0">
                  <td className="pt-3 pr-3 font-extrabold" colSpan={2}>
                    Total em R$
                  </td>
                  <td className="pt-3 text-right font-mono font-extrabold text-ok">{brlCent(payout.totalReais)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** ["Combo KFC", "Combo KFC", "Vale"]  ->  ["2x Combo KFC", "Vale"]. */
function contarEspecie(itens: string[]): string[] {
  const contagem = new Map<string, number>();
  for (const i of itens) contagem.set(i, (contagem.get(i) ?? 0) + 1);
  return [...contagem].map(([nome, n]) => (n > 1 ? `${n}× ${nome}` : nome));
}
