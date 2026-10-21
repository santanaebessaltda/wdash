import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Breadcrumbs, Button, Card, CardTitle } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { Tooltip } from "@/components/ui/Tooltip";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { ExportDialog } from "@/components/wedash/ExportDialog";
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
import { brlCent, fullDate, shortDate, isoToDate, num, dateToIso } from "@/lib/format";
import { statusBadgeVariant } from "@/lib/status";
import { exportPdf } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import {
  CHALLENGE_MODE_HELP,
  challengeBackPath,
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

const MANAGEMENT_RESULT: Record<ChallengeRecord["metric"], string> = {
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
  const amount = metricValueLabel(c.metric, c.managerTarget);
  return isIndexMetric(c.metric) ? ` · índice da equipe de ${amount}` : ` · meta de ${amount}`;
}

/** Performance > Desafios > detalhe — resumo e participantes; encerrado = fechamento com quem ganhou o que. */
export default function ChallengeDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useActiveSession();
  const today = calendarTodayIso();
  const [data, setData] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const hasOtherStores = storesForSession(session.stores).length > 1;
  const backTo = challengeBackPath(location.state);
  const fromTeam = backTo.startsWith(paths.team);
  useReturnWhenStoreChanges(data?.challenge?.storeId, backTo);

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
  const store = useMemo(
    () => (challenge ? storesForSession(session.stores).find((s) => s.id === challenge.storeId) : undefined),
    [challenge, session.stores],
  );
  const view = useMemo(
    () => (data?.challenge && data.aggs ? buildChallengeView({ challenge: data.challenge, aggs: data.aggs, today }) : null),
    [data, today],
  );

  const back = () => navigate(backTo);
  const period = challenge ? `${fullDate(challenge.startsOn)} a ${fullDate(challenge.endsOn)}` : "";

  return (
    <div>
      {challenge && view?.status === "ended" && <PayoutReportHeader challenge={challenge} storeNameValue={store?.tradeName} />}
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} onClick={back}>
          Voltar
        </Button>
        <Breadcrumbs
          items={
            fromTeam
              ? [{ label: "Dashboard", to: paths.overview }, { label: "Equipe", to: backTo }, { label: challenge?.name ?? "Detalhe" }]
              : [{ label: "Performance" }, { label: "Desafios", to: paths.management.challenges }, { label: challenge?.name ?? "Detalhe" }]
          }
        />
        {challenge && !showSkeleton && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}>
              Duplicar desafio
            </Button>
            <Button size="sm" onClick={() => navigate(paths.management.challengeEdit(challenge.id), { state: location.state })}>
              Editar desafio
            </Button>
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        kind="desafio"
        name={challenge?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!challenge) return;
          setDuplicateOpen(false);
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
            description="O desafio pode ter sido excluído ou não pertencer às suas filiais."
            action={
              <Button size="sm" variant="outline" onClick={back}>
                {fromTeam ? "Voltar para Equipe" : "Voltar para Desafios"}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <ChallengeHero challenge={challenge} view={view} storeNameValue={store?.tradeName} />

          {view.daysIncomplete.length > 0 && (
            <div className="mb-5 print:hidden">
              <Alert variant="warning" title="Resultado incompleto">
                Os itens por pessoa ainda não foram carregados para {daysText(view.daysIncomplete)}. O resultado pode mudar quando{" "}
                {view.daysIncomplete.length === 1 ? "esse dia for atualizado." : "esses dias forem atualizados."}
              </Alert>
            </div>
          )}

          {view.status === "ended" && (
            <ChallengePayoutCard
              challenge={challenge}
              view={view}
              onExport={() => exportPdf(["Fechamento do desafio", store?.tradeName ?? "", challenge.name, period])}
            />
          )}
          <ParticipantsCard challenge={challenge} view={view} />
        </>
      )}
    </div>
  );
}

function daysText(days: string[]): string {
  if (days.length === 1) return shortDate(days[0]!);
  const list = days.map(shortDate);
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

function prizesText(c: ChallengeRecord): string {
  if (c.mode === "MINIMUM") return c.prizes[0] ? `${prizeLabel(c.prizes[0])} por pessoa` : "—";
  return c.prizes.map((p, i) => `${ORDINAL[i]}: ${prizeLabel(p)}`).join(" · ") || "—";
}

/** "Body Splash VF Golden  |  Desod Col Obsessed  |  +2"  -  itens do desafio em uma linha. */
function itemsText(c: ChallengeRecord): string | null {
  if (!usesScope(c.metric)) return null;
  if (c.scope === "ALL") return CHALLENGE_SCOPE_LABEL.ALL;
  const names = c.scope === "PRODUCTS" ? c.products.map((p) => p.name) : c.categories.map((t) => t.name);
  if (names.length === 0) return null;
  if (names.length <= 3) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} · +${names.length - 2}`;
}

function ChallengeHero({ challenge: c, view, storeNameValue }: { challenge: ChallengeRecord; view: ChallengeView; storeNameValue?: string }) {
  const destaque = challengeHeadline(c, view);
  const items = itemsText(c);
  const usesSales = usesMinSales(c.metric);
  const stats: { label: string; value: string; sub?: string; help?: string }[] = [
    { label: "Tipo", value: CHALLENGE_METRIC_LABEL[c.metric], sub: items ?? undefined },
    {
      label: "Critério",
      value: challengeCriterion(c),
      sub: usesSales && c.minSales ? `Para participar: ${num(c.minSales)} ${c.minSales === 1 ? "venda" : "vendas"}` : undefined,
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
            <Badge variant={statusBadgeVariant(CHALLENGE_STATUS_LABEL[view.status])}>{CHALLENGE_STATUS_LABEL[view.status]}</Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] leading-relaxed text-t1">
            {fullDate(c.startsOn)} a {fullDate(c.endsOn)}
            {storeNameValue ? ` · ${storeNameValue}` : ""} · {CHALLENGE_MODE_LABEL[c.mode]}
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
  const usesSales = usesMinSales(c.metric);
  const n = view.participants.length;

  return (
    <Card className="mb-5 min-w-0 overflow-hidden print:hidden">
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

      {view.management && !aComecar && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-xl bg-bg-inset px-3.5 py-3 text-[12.5px]">
          <p className="font-bold text-t0">Gerência</p>
          <p className="flex items-center gap-1.5 text-t1">
            <span className="text-t2">{MANAGEMENT_RESULT[c.metric]}: </span>
            <span className="font-mono font-bold">{view.management.result != null ? metricValueLabel(c.metric, view.management.result) : "—"}</span>
            {view.management.periodPrevious && (
              <TipHelp
                label={`Compara a equipe durante o desafio com o período de ${shortDate(view.management.periodPrevious.from)} a ${shortDate(view.management.periodPrevious.to)}: 50% faturamento médio por pessoa, 25% ticket médio e 25% P.A. 100 representa o mesmo desempenho do período anterior. Com o desafio em andamento, os dois lados consideram até ontem.${view.management.result == null ? " Fica indisponível no primeiro dia do desafio, sem vendas em um dos períodos ou quando faltam dados de itens." : ""}`}
              />
            )}
          </p>
          <p className="text-t1">
            <span className="text-t2">Meta da gerência: </span>
            <span className="font-mono font-bold">{metricValueLabel(c.metric, view.management.target)}</span>
          </p>
          <p className="text-t1">
            <span className="text-t2">Prêmio: </span>
            <span className="font-bold">{prizeLabel(view.management.prize)}</span>
          </p>
          <Badge variant={view.management.atingiu ? "accent" : "neutral"}>
            {view.management.atingiu ? "Atingiu" : view.status === "ended" ? "Não atingiu" : "Ainda não atingiu"}
          </Badge>
        </div>
      )}

      {n === 0 ? (
        <EmptyBlock icon="👤" title="Nenhuma pessoa no desafio" description="Não há vendedores ativos nem vendas atribuídas à equipe no período." />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 620 }}>
            <thead>
              <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wide text-t2">
                {disputa && <th className="w-10 pb-3 pr-3 text-left">#</th>}
                <th className="pb-3 pr-3 text-left">Nome</th>
                <th className="pb-3 pr-3 text-right">Resultado</th>
                {usesSales && <th className="pb-3 pr-3 text-right">Vendas</th>}
                <th className="pb-3 pr-3 text-left">Situação</th>
                <th className="pb-3 text-right">Prêmio</th>
              </tr>
            </thead>
            <tbody>
              {view.participants.map((p) => (
                <tr key={p.key} className="border-b border-line last:border-b-0">
                  {disputa && <td className="py-2.5 pr-3 font-mono font-bold text-t2">{p.position ?? "—"}</td>}
                  <td className="py-2.5 pr-3">
                    <PersonName
                      name={p.name}
                      employeeId={p.key}
                      storeId={c.storeId}
                      sub={[p.group, p.eligibleDays < p.periodDays ? `${p.eligibleDays} de ${p.periodDays} dias` : null].filter(Boolean).join(" · ") || null}
                    />
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono font-bold text-t0">
                    {aComecar ? "—" : p.result != null ? metricValueLabel(c.metric, p.result) : <WithoutItems index={isIndexMetric(c.metric)} />}
                  </td>
                  {usesSales && <td className="py-2.5 pr-3 text-right font-mono font-bold text-t1">{aComecar ? "—" : num(p.sales)}</td>}
                  <td className="py-2.5 pr-3">
                    {p.winner ? (
                      <Badge variant={p.position != null ? "success" : "accent"}>{p.position != null ? `${p.position}º lugar` : "Atingiu"}</Badge>
                    ) : (
                      <span className="text-t2">{p.gap ?? "—"}</span>
                    )}
                  </td>
                  <td className={`py-2.5 text-right font-semibold ${p.winner && p.prize ? "text-t0" : "text-t2"}`}>
                    {p.winner && p.prize ? prizeLabel(p.prize) : "—"}
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

const WithoutItems = ({ index }: { index: boolean }) => (
  <Tooltip label={`${index ? "Índice" : "Resultado"} indisponível porque faltam dados de itens em pelo menos um dia com vendas.`}>
    <span className="cursor-help">—</span>
  </Tooltip>
);

function PayoutReportHeader({ challenge: c, storeNameValue }: { challenge: ChallengeRecord; storeNameValue?: string }) {
  const now = new Date();
  const geradoEm = `${now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return (
    <div className="mb-5 hidden border-b border-line pb-4 print:block">
      <div className="flex items-start justify-between gap-6">
        <WedashBrand size={28} />
        <p className="text-right text-[11px] leading-5 text-t2">Gerado em {geradoEm}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px]">
        {storeNameValue && (
          <p>
            <span className="text-t2">Loja: </span>
            <span className="font-bold uppercase text-t0">{storeNameValue}</span>
          </p>
        )}
        <p>
          <span className="text-t2">Desafio: </span>
          <span className="font-bold text-t0">{c.name}</span>
        </p>
        <p>
          <span className="text-t2">Período: </span>
          <span className="font-bold text-t0">
            {fullDate(c.startsOn)} a {fullDate(c.endsOn)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Desafio encerrado: quem ganhou o que. Outro premio (texto livre) aparece pelo nome e nao entra no total em R$. */
function ChallengePayoutCard({ challenge: c, view, onExport }: { challenge: ChallengeRecord; view: ChallengeView; onExport: () => void }) {
  const payout = challengePayout(view);
  const endMais1 = isoToDate(c.endsOn);
  endMais1.setDate(endMais1.getDate() + 1);
  const lines = [
    ...payout.vencedores.map((w) => ({
      key: w.key,
      name: w.name,
      sub: w.group,
      rank: w.rank,
      prize: w.prize,
      employeeId: w.key,
    })),
    ...(payout.management
      ? [{ key: "gerencia", name: "GERÊNCIA", sub: "Resultado da equipe", rank: "Atingiu", prize: payout.management, employeeId: null as string | null }]
      : []),
  ];
  const especie = countEspecie(payout.especie);

  return (
    <Card className="mb-5 min-w-0 overflow-hidden print:break-inside-avoid print:overflow-visible">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Fechamento do desafio</CardTitle>
            {view.emClosing && (
              <Tooltip
                label={`O último dia do desafio será fechado na madrugada de ${shortDate(dateToIso(endMais1))}. Vendas incluídas ou canceladas até lá ainda podem alterar o resultado.`}
              >
                <span className="inline-flex cursor-help">
                  <Badge variant={statusBadgeVariant("Fechamento em andamento")}>Fechamento em andamento</Badge>
                </span>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-t2">Veja quem ganhou e o prêmio de cada pessoa.</p>
        </div>
        <ExportDialog formats={["pdf"]} onExport={() => onExport()} />
      </div>

      {lines.length === 0 ? (
        <EmptyBlock icon="🏁" title="Nenhum vencedor neste desafio" description="Ninguém atingiu o resultado necessário para receber o prêmio." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <div className="rounded-xl bg-bg-inset px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">Vencedores</p>
              <p className="mt-1 font-mono text-[16px] font-extrabold text-t0">{num(lines.length)}</p>
            </div>
            <div className="rounded-xl bg-bg-inset px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">Prêmios em R$</p>
              <p className="mt-1 font-mono text-[16px] font-extrabold text-ok">{brlCent(payout.totalBrl)}</p>
            </div>
            {especie.length > 0 && (
              <div className="col-span-2 rounded-xl bg-bg-inset px-3.5 py-3 sm:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">Outros prêmios</p>
                <p className="mt-1 text-[13px] font-bold leading-snug text-t0">{especie.join(" · ")}</p>
              </div>
            )}
          </div>

          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 480 }}>
              <thead>
                <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wide text-t2">
                  <th className="pb-3 pr-3 text-left">Nome</th>
                  <th className="pb-3 pr-3 text-left">Colocação</th>
                  <th className="pb-3 text-right">Prêmio</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((r) => (
                  <tr key={r.key} className={`border-b border-line ${r.key === "gerencia" ? "bg-bg-inset" : ""}`}>
                    <td className="py-2.5 pr-3">
                      <PersonName name={r.name} employeeId={r.employeeId} storeId={r.key === "gerencia" ? null : c.storeId} sub={r.sub} />
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-acc">{r.rank}</td>
                    <td
                      className={`py-2.5 text-right font-extrabold ${r.prize.kind === "MONEY" ? "font-mono text-ok" : "text-t0"}`}
                    >
                      {prizeLabel(r.prize)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-t0">
                  <td className="pt-3 pr-3 font-extrabold" colSpan={2}>
                    Total em R$
                  </td>
                  <td className="pt-3 text-right font-mono font-extrabold text-ok">{brlCent(payout.totalBrl)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function PersonName({
  name,
  employeeId,
  storeId,
  sub,
}: {
  name: string;
  employeeId?: string | null;
  storeId?: string | null;
  sub?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={name} employeeId={employeeId} storeId={storeId} size="sm" />
      <div className="min-w-0">
        <p className="truncate font-bold text-t0">{name}</p>
        {sub ? <p className="truncate text-[11px] text-t2">{sub}</p> : null}
      </div>
    </div>
  );
}

/** ["Combo KFC", "Combo KFC", "Vale"]  ->  ["2x Combo KFC", "Vale"]. */
function countEspecie(items: string[]): string[] {
  const count = new Map<string, number>();
  for (const i of items) count.set(i, (count.get(i) ?? 0) + 1);
  return [...count].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name));
}
