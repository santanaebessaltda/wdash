import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, CardTitle, EmptyState, ProgressBar, StatCard, progressTextClass } from "@/components/ui";
import { BoardSkeleton } from "@/components/wedash/LoadingSkeletons";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import { boardMoments, type BoardMoment, type BoardSnapshot } from "@/data/wedash/boardEvents";
import { buildGoalCardView, buildGoalSummary, GOAL_STATUS_LABEL, goalStatus, prazoRemaining } from "@/data/wedash/goalView";
import type { GoalRecord, GoalTeamMember } from "@/data/wedash/goalsRepo";
import { buildChallengeView } from "@/data/wedash/challengeView";
import type { ChallengeAggInput, ChallengeRecord } from "@/data/wedash/challengesRepo";
import { buildTeamDashboardView, type Scope, type TeamAggInput, type TeamMemberRow } from "@/data/wedash/dashboard";
import { ChallengeMiniCard } from "@/pages/challenges/ChallengeMiniCard";
import { TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { calendarTodayIso } from "@/data/wedash/clock";
import type { StoreWeekHours } from "@/data/wedash/storeHours";
import { formatSyncWatermarkLabel } from "@/data/wedash/syncUi";
import { brlCent, num, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { statusBadgeVariant } from "@/lib/status";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import overtakeUrl from "@/assets/sound/overtaking.wav";
import firstPlaceUrl from "@/assets/sound/first-place.wav";
import goalLevelUrl from "@/assets/sound/reached-the-goal.wav";
import challengeUrl from "@/assets/sound/target-met.wav";

const BANNER_MS = 3200;
const MOMENT_CAP = 4;
const MUTE_KEY = "wedash.board.muted";

const SOUND: Record<BoardMoment["kind"], string> = {
  overtake: overtakeUrl,
  first: firstPlaceUrl,
  level: goalLevelUrl,
  "store-level": goalLevelUrl,
  challenge: challengeUrl,
};

export type BoardGoalsData = {
  goals: GoalRecord[];
  dayAggs: SalesDayAgg[];
  sellerAggs: SalesSellerDayAgg[];
  namedAggs: SalesSellerDayAgg[];
  team: GoalTeamMember[];
};

export type BoardChallengesData = { challenges: ChallengeRecord[]; aggs: ChallengeAggInput };

type PersonLevel = {
  levelNumber: number | null;
  levelLabel: string | null;
  name: string;
  pct: number;
  storePct: number;
};

function snapshotKey(storeId: string): string {
  return `wedash.board.v1.${storeId}`;
}

function readSnapshot(storeId: string): BoardSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; snap?: BoardSnapshot };
    if (parsed.v !== 1 || !parsed.snap) return null;
    return parsed.snap;
  } catch {
    return null;
  }
}

function writeSnapshot(storeId: string, snap: BoardSnapshot) {
  try {
    localStorage.setItem(snapshotKey(storeId), JSON.stringify({ v: 1, snap }));
  } catch {
    /* modo privado */
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function firstName(name: string, names: string[]): string {
  const first = name.trim().split(/\s+/)[0] || name;
  const same = names.filter((item) => (item.trim().split(/\s+/)[0] || item) === first).length;
  return same > 1 ? name : first;
}

function momentText(moment: BoardMoment, names: string[]): string {
  if (moment.kind === "first") return `${firstName(moment.name, names)} assumiu a liderança!`;
  if (moment.kind === "overtake") {
    return `${firstName(moment.name, names)} passou ${firstName(moment.passed, names)} e agora está em ${moment.position}º!`;
  }
  if (moment.kind === "level") return `${firstName(moment.name, names)} chegou ao ${moment.level}!`;
  if (moment.kind === "store-level") return `A loja chegou ao ${moment.level}!`;
  return `${firstName(moment.name, names)} concluiu o desafio ${moment.challenge}!`;
}

function monthLabel(today: string): string {
  const [year, month] = today.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, (month || 1) - 1, 1)),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function momentKey(moment: BoardMoment | null): string | null {
  if (!moment || moment.kind === "store-level") return null;
  return moment.key;
}

function levelLabel(levelNumber: number | null, name: string | null): string | null {
  if (levelNumber == null || !name) return null;
  return `N${levelNumber} · ${name}`;
}

function storeTotals(days: SalesDayAgg[], storeId: string, from: string, to: string, onlyDay?: string) {
  let revenue = 0;
  let sales = 0;
  for (const row of days) {
    if (row.storeId !== storeId || row.brand !== "ALL" || row.day < from || row.day > to) continue;
    if (onlyDay && row.day !== onlyDay) continue;
    revenue += row.revenueCents / 100;
    sales += row.salesCount;
  }
  return { revenue, sales };
}

const IconRevenue = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconSales = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

export function BoardView({
  storeId,
  storeName,
  week,
  team,
  goalsData,
  challengesData,
  watermark,
  loading,
  packStore,
  controls = "page",
  onExitTv,
}: {
  storeId: string | null;
  storeName: string | null;
  week: StoreWeekHours;
  team: TeamAggInput;
  goalsData: BoardGoalsData;
  challengesData: BoardChallengesData;
  watermark: Date | null;
  loading: boolean;
  packStore: string | null;
  /** page: dentro da WDash. tv: apresentação. public: link sem login. */
  controls?: "page" | "tv" | "public";
  onExitTv?: () => void;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [current, setCurrent] = useState<BoardMoment | null>(null);
  const queue = useRef<BoardMoment[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const seenSnap = useRef<string | null>(null);

  const today = calendarTodayIso();
  const boardScope = useMemo<Scope | null>(() => {
    if (!storeId) return null;
    return { storeIds: [storeId], period: { kind: "thisMonth" }, division: null };
  }, [storeId]);
  const view = useMemo(() => (boardScope ? buildTeamDashboardView(boardScope, team) : null), [boardScope, team]);

  const goalCard = useMemo(() => {
    if (!storeId) return null;
    const active = goalsData.goals
      .filter((goal) => goalStatus(goal, today) === "active")
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
    const goal = active[0];
    if (!goal) return null;
    return buildGoalCardView({
      goal,
      storeNameValue: storeName ?? "Filial",
      dayAggs: goalsData.dayAggs,
      sellerDayAggs: goalsData.sellerAggs,
      namedSellerDayAggs: goalsData.namedAggs,
      team: goalsData.team,
      today,
      week,
    });
  }, [goalsData, storeId, storeName, today, week]);

  const activeGoal = goalCard ? goalsData.goals.find((goal) => goal.id === goalCard.id) ?? null : null;
  const challenges = useMemo(() => {
    return challengesData.challenges
      .map((challenge) => ({ challenge, view: buildChallengeView({ challenge, aggs: challengesData.aggs, today }) }))
      .filter((card) => card.view.status === "active")
      .sort((a, b) => a.challenge.endsOn.localeCompare(b.challenge.endsOn) || a.challenge.name.localeCompare(b.challenge.name, "pt-BR"));
  }, [challengesData, today]);

  const levels = useMemo(() => {
    const byKey = new Map<string, PersonLevel>();
    const byName = new Map<string, PersonLevel>();
    for (const seller of goalCard?.sellers ?? []) {
      if (seller.noGoal) continue;
      const row: PersonLevel = {
        name: seller.name,
        levelNumber: seller.currentLevel,
        levelLabel: levelLabel(seller.currentLevel, seller.currentTierName),
        pct: seller.attainmentPct,
        storePct: seller.storeGoalPct,
      };
      byKey.set(seller.employeeId, row);
      byName.set(seller.name.trim().toLocaleLowerCase("pt-BR"), row);
    }
    return { byKey, byName };
  }, [goalCard]);

  function personLevel(person: TeamMemberRow): PersonLevel | null {
    return levels.byKey.get(person.key) ?? levels.byName.get(person.name.trim().toLocaleLowerCase("pt-BR")) ?? null;
  }

  const snapshot = useMemo<BoardSnapshot | null>(() => {
    if (!view || !storeId) return null;
    const summary = activeGoal ? buildGoalSummary(activeGoal, goalsData.dayAggs, today, week) : null;
    const storeLevel = activeGoal && activeGoal.tierMode !== "INDIVIDUAL" ? summary : null;
    return {
      ranks: view.people.map((person, index) => ({ key: person.key, name: person.name, position: index + 1 })),
      levels: [...levels.byKey.entries()].map(([key, level]) => ({
        key,
        name: level.name,
        levelNumber: level.levelNumber,
        levelLabel: level.levelLabel,
      })),
      storeLevelNumber: storeLevel?.levelNumber ?? null,
      storeLevelLabel: levelLabel(storeLevel?.levelNumber ?? null, storeLevel?.currentLevel ?? null),
      winners: challenges.flatMap(({ challenge, view: challengeView }) =>
        challengeView.participants
          .filter((person) => person.winner)
          .map((person) => ({ challengeId: challenge.id, challengeName: challenge.name, key: person.key, name: person.name })),
      ),
    };
  }, [activeGoal, challenges, goalsData.dayAggs, levels, storeId, today, view, week]);

  useEffect(() => {
    if (!snapshot || !storeId || packStore !== storeId) return;
    const serial = JSON.stringify(snapshot);
    if (seenSnap.current === serial) return;
    seenSnap.current = serial;
    const previous = readSnapshot(storeId);
    writeSnapshot(storeId, snapshot);
    const moments = boardMoments(previous, snapshot).slice(0, MOMENT_CAP);
    if (moments.length === 0) return;
    queue.current.push(...moments);
    setCurrent((showing) => showing ?? queue.current.shift() ?? null);
  }, [packStore, snapshot, storeId]);

  useEffect(() => {
    if (!current) return;
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      audio.current?.pause();
      setCurrent(queue.current.shift() ?? null);
    };
    timer = window.setTimeout(finish, BANNER_MS);
    if (unlocked && !muted) {
      const clip = new Audio(SOUND[current.kind]);
      clip.volume = 0.85;
      audio.current = clip;
      void clip.play().catch(() => undefined);
    }
    return () => {
      window.clearTimeout(timer);
      audio.current?.pause();
    };
  }, [current, muted, unlocked]);

  if (loading) {
    return <BoardSkeleton header={controls !== "page"} className={controls === "page" ? undefined : "min-h-full p-4 sm:p-6"} />;
  }

  function unlock(nextMuted = muted) {
    const clip = new Audio(overtakeUrl);
    clip.volume = 0;
    void clip.play().then(() => clip.pause()).catch(() => undefined);
    setUnlocked(true);
    setMuted(nextMuted);
    try {
      localStorage.setItem(MUTE_KEY, nextMuted ? "1" : "0");
    } catch {
      /* segue sem gravar */
    }
  }

  if (!storeId) return null;

  const names = view?.people.map((person) => person.name) ?? [];
  const podium: RankingRow[] = (view?.people.slice(0, 3) ?? []).map((person, index) => {
    const level = personLevel(person);
    return {
      position: index + 1,
      employeeId: person.key,
      name: firstName(person.name, names),
      avatarName: person.name,
      storeId: person.storeIds[0] ?? storeId,
      sales: person.sales,
      revenue: person.revenue,
      note: level ? (level.levelLabel ?? "Sem nível") : undefined,
    };
  });
  const summary = activeGoal ? buildGoalSummary(activeGoal, goalsData.dayAggs, today, week) : null;
  const month = view ? storeTotals(team.dayAggs, storeId, view.period.start, view.period.end) : { revenue: 0, sales: 0 };
  const todayTotals = storeTotals(team.dayAggs, storeId, today, today);
  const monthRevenue = view?.composition.total ?? month.revenue;

  const showSound = controls === "tv" || controls === "public";

  return (
    <div className={cn("flex flex-col gap-4", controls === "page" ? "" : "min-h-full p-4 sm:p-6")}>
      <style>{`@keyframes board-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}`}</style>
      {controls !== "page" && (
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-t0 sm:text-[26px]">{storeName ?? "Filial"}</h1>
          <p className="mt-0.5 text-[13px] text-t2">
            {monthLabel(today)}
            <span className="mx-1.5">·</span>
            {formatSyncWatermarkLabel(watermark, { loading })}
          </p>
        </div>
        {showSound && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => (unlocked ? unlock(!muted) : unlock(false))}>
              {!unlocked ? "Ativar som" : muted ? "Som desligado" : "Som ligado"}
            </Button>
            {controls === "tv" && (
              <Button type="button" variant="outline" size="sm" onClick={onExitTv}>
                Sair da tela cheia
              </Button>
            )}
          </div>
        )}
      </header>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard dense label="Faturamento" value={brlCent(monthRevenue)} sub={`Hoje ${brlCent(todayTotals.revenue)}`} icon={<IconRevenue />} iconColor="var(--acc)" iconBg="var(--acc-soft)" />
        <StatCard dense label="Vendas" value={num(month.sales)} sub={`Hoje ${num(todayTotals.sales)}`} icon={<IconSales />} iconColor="var(--ok)" iconBg="var(--ok-soft)" />
        <StatCard
          dense
          label="Meta"
          value={activeGoal ? brlCent(activeGoal.target) : "—"}
          sub={activeGoal ? (goalCard?.name ?? "Meta do mês") : "Não configurada"}
          icon={<TargetIcon size={16} />}
          iconColor="var(--info)"
          iconBg="rgba(59,130,246,0.12)"
        />
        <StatCard
          dense
          label="Progresso da meta"
          value={summary ? `${num(summary.pct, 1)}%` : "—"}
          sub={
            !summary
              ? "Meta não configurada"
              : activeGoal?.tierMode === "INDIVIDUAL"
                ? "Meta individual"
                : summary.currentLevel
                  ? `N${summary.levelNumber} · ${summary.currentLevel}`
                  : "Sem nível"
          }
          icon={<TrophyIcon size={16} />}
          iconColor="var(--warn)"
          iconBg="rgba(245,158,11,0.12)"
        />
      </div>

      {goalCard && activeGoal && summary ? (
        <div className="flex flex-col rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 px-6 py-4 shadow-[var(--shadow-vela)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-[18px] font-extrabold tracking-tight text-t0">{goalCard.name}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-t2">
                {shortDate(activeGoal.startsOn)} a {shortDate(activeGoal.endsOn)}
              </p>
              <p className="mt-1.5 font-mono text-[20px] font-extrabold leading-none tabular-nums text-t0">{brlCent(summary.achieved)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant={statusBadgeVariant(GOAL_STATUS_LABEL[summary.status])}>{GOAL_STATUS_LABEL[summary.status]}</Badge>
                <span className="text-[12px] text-t2">
                  {activeGoal.tierMode === "INDIVIDUAL" ? "Individual" : activeGoal.tierMode === "GENERAL" ? "Geral" : "Grupo"}
                  <span className="mx-1.5">·</span>
                  {activeGoal.tiers.length} {activeGoal.tiers.length === 1 ? "nível" : "níveis"}
                </span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={`font-mono text-[22px] font-extrabold leading-none tabular-nums ${progressTextClass(summary.pct)}`}>{num(summary.pct, 1)}%</p>
              <p className="mt-1 text-[12px] text-t2">de {brlCent(activeGoal.target)}</p>
            </div>
          </div>
          <div className="mt-3">
            <ProgressBar value={summary.pct} height={5} />
          </div>
          <p className="mt-1.5 text-[11.5px] text-t2">
            {summary.projectedPct != null
              ? `Projeção ${num(summary.projectedPct, 0)}% · ${prazoRemaining(summary.daysRemaining).toLowerCase()}`
              : prazoRemaining(summary.daysRemaining)}
          </p>
        </div>
      ) : (
        <Card>
          <EmptyState framed={false} icon="🎯" title="Meta não configurada" description="Cadastre uma meta para acompanhar o desempenho da equipe no período." />
        </Card>
      )}

      <div className={cn("grid min-w-0 gap-4", challenges.length > 0 && "xl:grid-cols-[minmax(0,65fr)_minmax(280px,35fr)] xl:items-start")}>
        <Card padding="lg" className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <TrophyIcon size={16} className="text-acc" />
            <CardTitle>Ranking</CardTitle>
          </div>
          <RankingBlock ranking={podium} formatAmount={brlCent} spotlight literalName />
              {(view?.people.length ?? 0) > 3 && (
                <div className="mt-5">
                  <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-t2">Demais posições</p>
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-line text-left text-[10.5px] font-bold uppercase tracking-wide text-t3">
                          <th className="pb-1.5 pr-2">#</th>
                          <th className="pb-1.5 pr-2">Pessoa</th>
                          <th className="pb-1.5 pr-2 text-right">Vendas</th>
                          <th className="pb-1.5 pr-2 text-right">P.A.</th>
                          <th className="pb-1.5 pr-2 text-right">Meta</th>
                          <th className="pb-1.5 text-right">Faturamento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view!.people.slice(3).map((person, index) => {
                          const level = personLevel(person);
                          const individual = activeGoal?.tierMode === "INDIVIDUAL";
                          const pct = level ? (individual ? `${num(level.pct, 1)}%` : `${num(level.storePct, 1)}% da meta`) : null;
                          return (
                            <tr key={person.key} className={cn("border-b border-line last:border-b-0", momentKey(current) === person.key && "bg-acc-soft")}>
                              <td className="py-1.5 pr-2 font-bold text-t3">{index + 4}º</td>
                              <td className="py-1.5 pr-2">
                                <span className="flex min-w-0 items-center gap-2">
                                  <PersonAvatar name={person.name} employeeId={person.key} storeId={person.storeIds[0] ?? storeId} size="sm" />
                                  <span className="min-w-0 truncate text-[12.5px] font-bold text-t0">{person.name}</span>
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono text-[12.5px] font-bold tabular-nums text-t0">{num(person.sales)}</td>
                              <td className="py-1.5 pr-2 text-right font-mono text-[12.5px] font-bold tabular-nums text-t0">{person.pa == null ? "—" : num(person.pa, 2)}</td>
                              <td className="py-1.5 pr-2 text-right">
                                <span className="block font-mono text-[13px] font-extrabold tabular-nums text-t0">{pct ?? "—"}</span>
                                {level?.levelLabel ? (
                                  <span className="mt-0.5 block text-[10px] font-medium text-t3">{level.levelLabel}</span>
                                ) : level ? (
                                  <span className="mt-0.5 block text-[10px] text-t3">Sem nível</span>
                                ) : null}
                              </td>
                              <td className="py-1.5 text-right font-mono text-[12.5px] font-bold tabular-nums text-t0">{brlCent(person.revenue)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
        </Card>

        {challenges.length > 0 && (
          <div className="flex min-w-0 flex-col gap-3">
            {challenges.map(({ challenge, view: challengeView }) => (
              <ChallengeMiniCard
                key={challenge.id}
                challenge={challenge}
                view={challengeView}
                prominent
                showPeople
                floor
                hotKey={current?.kind === "challenge" ? current.key : null}
              />
            ))}
          </div>
        )}
      </div>

      {current && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6">
          <p
            aria-live="polite"
            className="max-w-xl rounded-[var(--radius-vela-lg)] border border-acc bg-bg-2 px-8 py-6 text-center text-[22px] font-extrabold tracking-tight text-t0 shadow-[var(--shadow-vela)] sm:text-[28px]"
            style={{ animation: "board-pop 0.35s ease" }}
          >
            {momentText(current, names)}
          </p>
        </div>
      )}
    </div>
  );
}
