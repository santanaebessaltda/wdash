import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, CardTitle, EmptyState, ProgressBar, progressTextClass } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import {
  boardMoments,
  type BoardMoment,
  type BoardSnapshot,
} from "@/data/wedash/boardEvents";
import { buildGoalCardView, buildGoalSummary, GOAL_STATUS_LABEL, goalStatus, prazoRemaining } from "@/data/wedash/goalView";
import { fetchGoals, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import {
  emptyChallengeAggInput,
  fetchChallengeInput,
  fetchChallenges,
  type ChallengeAggInput,
  type ChallengeRecord,
} from "@/data/wedash/challengesRepo";
import { buildChallengeView } from "@/data/wedash/challengeView";
import { fetchNamedSellerDayAggs, fetchSalesDayAggs, fetchSalesSellerDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import { buildTeamDashboardView, resolvePeriod, type Scope, type TeamAggInput, type TeamMemberRow } from "@/data/wedash/dashboard";
import { fetchTeamAggInput } from "@/pages/dashboard/TeamMemberDetail";
import { useScope } from "@/pages/dashboard/useScope";
import { searchForRoute } from "@/pages/dashboard/periodQuery";
import { ChallengeMiniCard } from "@/pages/challenges/ChallengeMiniCard";
import { TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { statusBadgeVariant } from "@/lib/status";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { defaultWeekHours, effectiveWeekHours } from "@/data/wedash/storeHours";
import { storesForSession } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { formatSyncWatermarkLabel } from "@/data/wedash/syncUi";
import { paths } from "@/router/paths";
import { brlCent, fullDate, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import overtakeUrl from "@/assets/sound/overtaking.wav";
import firstPlaceUrl from "@/assets/sound/first-place.wav";
import goalLevelUrl from "@/assets/sound/reached-the-goal.wav";
import challengeUrl from "@/assets/sound/target-met.wav";

const REFRESH_MS = 30 * 60 * 1000;
const WATERMARK_MS = 60 * 1000;
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

type GoalsData = {
  goals: GoalRecord[];
  dayAggs: SalesDayAgg[];
  sellerAggs: SalesSellerDayAgg[];
  namedAggs: SalesSellerDayAgg[];
  team: GoalTeamMember[];
};
const GOALS_EMPTY: GoalsData = { goals: [], dayAggs: [], sellerAggs: [], namedAggs: [], team: [] };

type ChallengesData = { challenges: ChallengeRecord[]; aggs: ChallengeAggInput };
const CHALLENGES_EMPTY: ChallengesData = { challenges: [], aggs: emptyChallengeAggInput() };

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
    /* modo privado: a faixa toca nesta sessão e pode repetir ao reabrir */
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
  if (moment.kind === "first") return `${firstName(moment.name, names)} assumiu o 1º lugar.`;
  if (moment.kind === "overtake") {
    return `${firstName(moment.name, names)} passou ${firstName(moment.passed, names)} e ficou em ${moment.position}º.`;
  }
  if (moment.kind === "level") return `${firstName(moment.name, names)} chegou em ${moment.level}.`;
  if (moment.kind === "store-level") return `A loja chegou em ${moment.level}.`;
  return `${firstName(moment.name, names)} bateu o desafio ${moment.challenge}.`;
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

type PersonLevel = {
  levelNumber: number | null;
  levelLabel: string | null;
  name: string;
  pct: number;
};

export function BoardPage() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const { scope, setScope } = useScope();
  const storeId = scope.storeIds[0] ?? null;
  const [team, setTeam] = useState<TeamAggInput>({ dayAggs: [] });
  const [goalsData, setGoalsData] = useState<GoalsData>(GOALS_EMPTY);
  const [challengesData, setChallengesData] = useState<ChallengesData>(CHALLENGES_EMPTY);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [packStore, setPackStore] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [current, setCurrent] = useState<BoardMoment | null>(null);
  const queue = useRef<BoardMoment[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const reloadGen = useRef(0);
  const watermarkMs = useRef<number | null>(null);

  const boardScope = useMemo<Scope | null>(() => {
    if (!storeId) return null;
    return { storeIds: [storeId], period: { kind: "thisMonth" }, division: null };
  }, [storeId]);

  const showNext = useCallback(() => {
    const next = queue.current.shift() ?? null;
    setCurrent(next);
  }, []);

  const reload = useCallback(async () => {
    if (!boardScope || !storeId) return;
    const gen = ++reloadGen.current;
    const today = calendarTodayIso();
    const period = resolvePeriod(boardScope.period, today);
    try {
      const [nextTeam, stamp, goals, challengeRows] = await Promise.all([
        fetchTeamAggInput(session.tenantId, boardScope),
        fetchSyncWatermark(session.tenantId).catch(() => null),
        fetchGoals({ tenantId: session.tenantId, storeIds: [storeId], from: period.start, to: period.end }),
        fetchChallenges({ tenantId: session.tenantId, storeIds: [storeId], from: period.start, to: period.end }),
      ]);
      let goalPack = GOALS_EMPTY;
      if (goals.length > 0) {
        const from = goals.reduce((min, goal) => (goal.startsOn < min ? goal.startsOn : min), goals[0]!.startsOn);
        const end = goals.reduce((max, goal) => (goal.endsOn > max ? goal.endsOn : max), goals[0]!.endsOn);
        const to = end < today ? end : today;
        const historyFrom = goalWeightFrom(from);
        const [dayAggs, sellerAggs, namedAggs, teamRows] = await Promise.all([
          historyFrom <= to
            ? fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: [storeId], from: historyFrom, to, brand: "ALL" })
            : Promise.resolve([]),
          from <= to ? fetchSalesSellerDayAggs({ tenantId: session.tenantId, storeIds: [storeId], from, to }) : Promise.resolve([]),
          from <= to ? fetchNamedSellerDayAggs({ tenantId: session.tenantId, storeIds: [storeId], from, to }) : Promise.resolve([]),
          fetchGoalTeam(session.tenantId, [storeId]),
        ]);
        goalPack = { goals, dayAggs, sellerAggs, namedAggs, team: teamRows };
      }
      const challengePack: ChallengesData =
        challengeRows.length === 0
          ? CHALLENGES_EMPTY
          : { challenges: challengeRows, aggs: await fetchChallengeInput({ tenantId: session.tenantId, challenges: challengeRows, today }) };
      if (gen !== reloadGen.current) return;
      setTeam(nextTeam);
      setGoalsData(goalPack);
      setChallengesData(challengePack);
      setWatermark(stamp);
      watermarkMs.current = stamp?.getTime() ?? null;
      setPackStore(storeId);
      setLoading(false);
    } catch (error) {
      if (gen !== reloadGen.current) return;
      console.error("Board reload:", error);
      setLoading(false);
    }
  }, [boardScope, session.tenantId, storeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onSynced = () => void reload();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    const refresh = window.setInterval(() => void reload(), REFRESH_MS);
    return () => {
      window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
      window.clearInterval(refresh);
    };
  }, [reload]);

  useEffect(() => {
    if (!storeId) return;
    const tick = window.setInterval(() => {
      void fetchSyncWatermark(session.tenantId)
        .then((stamp) => {
          const ms = stamp?.getTime() ?? null;
          if (ms != null && ms !== watermarkMs.current) void reload();
        })
        .catch(() => undefined);
    }, WATERMARK_MS);
    return () => window.clearInterval(tick);
  }, [reload, session.tenantId, storeId]);

  const today = calendarTodayIso();
  const stores = storesForSession(session.stores);
  const store = stores.find((item) => item.id === storeId);
  const view = useMemo(
    () => (boardScope ? buildTeamDashboardView(boardScope, team) : null),
    [boardScope, team],
  );

  const goalCard = useMemo(() => {
    if (!storeId) return null;
    const active = goalsData.goals
      .filter((goal) => goalStatus(goal, today) === "active")
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
    const goal = active[0];
    if (!goal) return null;
    return buildGoalCardView({
      goal,
      storeNameValue: store?.tradeName ?? "Filial",
      dayAggs: goalsData.dayAggs,
      sellerDayAggs: goalsData.sellerAggs,
      namedSellerDayAggs: goalsData.namedAggs,
      team: goalsData.team,
      today,
      week: effectiveWeekHours(store?.hours ?? defaultWeekHours()),
    });
  }, [goalsData, store, storeId, today]);

  const activeGoal = goalCard ? goalsData.goals.find((goal) => goal.id === goalCard.id) ?? null : null;

  const challenges = useMemo(() => {
    return challengesData.challenges
      .map((challenge) => ({
        challenge,
        view: buildChallengeView({ challenge, aggs: challengesData.aggs, today }),
      }))
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
    const summary = activeGoal
      ? buildGoalSummary(activeGoal, goalsData.dayAggs, today, effectiveWeekHours(store?.hours ?? defaultWeekHours()))
      : null;
    const storeLevel = activeGoal && activeGoal.tierMode !== "INDIVIDUAL" ? summary : null;
    const ranks = view.people.map((person, index) => ({ key: person.key, name: person.name, position: index + 1 }));
    const levelRows = [...levels.byKey.entries()].map(([key, level]) => ({ key, name: level.name, levelNumber: level.levelNumber, levelLabel: level.levelLabel }));
    const winners = challenges.flatMap(({ challenge, view: challengeView }) =>
      challengeView.participants
        .filter((person) => person.winner)
        .map((person) => ({
          challengeId: challenge.id,
          challengeName: challenge.name,
          key: person.key,
          name: person.name,
        })),
    );
    return {
      ranks,
      levels: levelRows,
      storeLevelNumber: storeLevel?.levelNumber ?? null,
      storeLevelLabel: levelLabel(storeLevel?.levelNumber ?? null, storeLevel?.currentLevel ?? null),
      winners,
    };
  }, [activeGoal, challenges, goalsData.dayAggs, levels, store?.hours, storeId, today, view]);

  const seenSnap = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot || !storeId || packStore !== storeId) return;
    const serial = JSON.stringify(snapshot);
    if (seenSnap.current === serial) return;
    seenSnap.current = serial;
    const moments = boardMoments(readSnapshot(storeId), snapshot).slice(0, MOMENT_CAP);
    writeSnapshot(storeId, snapshot);
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
      showNext();
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
  }, [current, muted, showNext, unlocked]);

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

  const names = view?.people.map((person) => person.name) ?? [];
  const podium: RankingRow[] = (view?.people.slice(0, 3) ?? []).map((person, index) => {
    const level = personLevel(person);
    return {
      position: index + 1,
      employeeId: person.key,
      name: person.name,
      storeId: person.storeIds[0],
      sales: person.sales,
      revenue: person.revenue,
      note: level ? (level.levelLabel ?? "Sem nível") : undefined,
    };
  });
  const rest = view?.people.slice(3) ?? [];
  const summary = activeGoal
    ? buildGoalSummary(activeGoal, goalsData.dayAggs, today, effectiveWeekHours(store?.hours ?? defaultWeekHours()))
    : null;

  if (!storeId) {
    return (
      <div className="flex min-h-full flex-col gap-4 p-6">
        <h1 className="text-[22px] font-extrabold text-t0">Placar</h1>
        <p className="text-sm text-t2">Escolha a filial que fica aberta neste notebook.</p>
        <div className="grid max-w-xl gap-2">
          {stores.map((item) => (
            <Button
              key={item.id}
              variant="outline"
              onClick={() => setScope({ storeIds: [item.id], period: scope.period, division: null })}
            >
              {item.tradeName}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 sm:p-6">
      <style>{`@keyframes board-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}`}</style>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-t0 sm:text-[26px]">{store?.tradeName ?? "Filial"}</h1>
          <p className="mt-0.5 text-[13px] text-t2">
            {monthLabel(today)}
            <span className="mx-1.5">·</span>
            {formatSyncWatermarkLabel(watermark, { loading })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => (unlocked ? unlock(!muted) : unlock(false))}>
            {!unlocked ? "Ativar som" : muted ? "Som desligado" : "Som ligado"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen().catch(() => undefined);
            }}
          >
            Tela cheia
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`${paths.team}${searchForRoute(paths.team, `?store=${storeId}`)}`)}>
            Sair
          </Button>
        </div>
      </header>

      {goalCard && activeGoal && summary ? (
        <div className="flex flex-col rounded-2xl border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)]">
          <div className="mb-3.5 flex items-center gap-3.5">
            <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[14px] bg-acc-soft text-acc">
              <TargetIcon size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-t0">{goalCard.name}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-t2">
                {fullDate(activeGoal.startsOn)} a {fullDate(activeGoal.endsOn)}
              </p>
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[13px] font-extrabold text-ok">{brlCent(summary.achieved)}</span>
            <span className="text-right text-[11.5px] text-t2">
              <span className={`font-mono font-bold ${progressTextClass(summary.pct)}`}>{num(summary.pct, 1)}%</span> de {brlCent(activeGoal.target)}
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar value={summary.pct} height={5} />
          </div>
          <p className="mt-2 text-[11.5px] text-t2">
            {summary.projectedPct != null
              ? `Projeção: ${num(summary.projectedPct, 0)}% · ${prazoRemaining(summary.daysRemaining).toLowerCase()}`
              : prazoRemaining(summary.daysRemaining)}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge variant={statusBadgeVariant(GOAL_STATUS_LABEL[summary.status])} className="uppercase">
              {GOAL_STATUS_LABEL[summary.status]}
            </Badge>
            <Badge variant="neutral" className="uppercase">
              {activeGoal.tierMode === "INDIVIDUAL" ? "Individual" : activeGoal.tierMode === "GENERAL" ? "Geral" : "Grupo"}
            </Badge>
            <Badge variant="neutral" className="uppercase">
              {activeGoal.tiers.length} {activeGoal.tiers.length === 1 ? "nível" : "níveis"}
            </Badge>
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState
            framed={false}
            icon="🎯"
            title="Meta não configurada"
            description="Cadastre uma meta para acompanhar o desempenho da equipe no período."
          />
        </Card>
      )}

      <Card padding="lg" className="min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <TrophyIcon size={16} className="text-acc" />
          <CardTitle>Ranking</CardTitle>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-t2">Carregando o ranking…</p>
        ) : (
          <>
            <RankingBlock ranking={podium} formatAmount={brlCent} />
            {rest.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {rest.map((person) => {
                  const level = personLevel(person);
                  return (
                    <RankRow
                      key={person.key}
                      person={person}
                      place={view!.people.indexOf(person) + 1}
                      level={level ? (level.levelLabel ?? "Sem nível") : null}
                      pct={level?.pct ?? null}
                      hot={momentKey(current) === person.key}
                    />
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      {challenges.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {challenges.map(({ challenge, view: challengeView }) => (
            <ChallengeMiniCard key={challenge.id} challenge={challenge} view={challengeView} prominent />
          ))}
        </div>
      )}

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

function RankRow({
  person,
  place,
  level,
  pct,
  hot,
}: {
  person: TeamMemberRow;
  place: number;
  level: string | null;
  pct: number | null;
  hot: boolean;
}) {
  return (
    <li className={cn("flex items-center gap-3 py-2.5", hot && "rounded-lg bg-acc-soft px-2")}>
      <span className="w-8 shrink-0 text-[13px] font-extrabold text-t2">{place}º</span>
      <PersonAvatar name={person.name} employeeId={person.key} storeId={person.storeIds[0]} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold text-t0">{person.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {level ? <Badge variant="accent">{level}</Badge> : null}
          <span className="text-[12px] text-t2">
            {person.sales} {person.sales === 1 ? "venda" : "vendas"}
          </span>
          {pct != null && (
            <span className="flex items-center gap-2">
              <span className="font-mono text-[12px] font-bold text-t0">{num(pct, 0)}%</span>
              <span className="w-16">
                <ProgressBar value={Math.min(100, Math.max(0, pct))} height={5} />
              </span>
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[14px] font-bold text-t0">{brlCent(person.revenue)}</span>
    </li>
  );
}
