import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, CardTitle, EmptyState, ProgressBar } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import {
  boardMoments,
  type BoardMoment,
  type BoardSnapshot,
} from "@/data/wedash/boardEvents";
import { buildGoalCardView, buildGoalSummary, goalStatus } from "@/data/wedash/goalView";
import { fetchGoals, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import {
  emptyChallengeAggInput,
  fetchChallengeInput,
  fetchChallenges,
  type ChallengeAggInput,
  type ChallengeRecord,
} from "@/data/wedash/challengesRepo";
import { buildChallengeView, type ChallengeParticipant, type ChallengeView } from "@/data/wedash/challengeView";
import { fetchNamedSellerDayAggs, fetchSalesDayAggs, fetchSalesSellerDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import { buildTeamDashboardView, resolvePeriod, type Scope, type TeamAggInput, type TeamMemberRow } from "@/data/wedash/dashboard";
import { fetchTeamAggInput } from "@/pages/dashboard/TeamMemberDetail";
import { useScope } from "@/pages/dashboard/useScope";
import { searchForRoute } from "@/pages/dashboard/periodQuery";
import { GlobalGoalBand } from "@/pages/team/goalBlocks";
import { mainPrizeLabel } from "@/pages/challenges/shared";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { defaultWeekHours, effectiveWeekHours } from "@/data/wedash/storeHours";
import { storesForSession } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { formatSyncWatermarkLabel } from "@/data/wedash/syncUi";
import { paths } from "@/router/paths";
import { brlCent, num } from "@/lib/format";
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

function challengePct(person: ChallengeParticipant, target: number | null, leader: number): number {
  if (person.result == null) return 0;
  const denom = target != null && target > 0 ? target : leader;
  if (denom <= 0) return 0;
  return Math.min(100, (person.result / denom) * 100);
}

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
    const map = new Map<string, { levelNumber: number | null; levelLabel: string | null; name: string }>();
    for (const seller of goalCard?.sellers ?? []) {
      if (seller.noGoal) continue;
      map.set(seller.employeeId, {
        name: seller.name,
        levelNumber: seller.currentLevel,
        levelLabel: levelLabel(seller.currentLevel, seller.currentTierName),
      });
    }
    return map;
  }, [goalCard]);

  const snapshot = useMemo<BoardSnapshot | null>(() => {
    if (!view || !storeId) return null;
    const summary = activeGoal
      ? buildGoalSummary(activeGoal, goalsData.dayAggs, today, effectiveWeekHours(store?.hours ?? defaultWeekHours()))
      : null;
    const storeLevel = activeGoal && activeGoal.tierMode !== "INDIVIDUAL" ? summary : null;
    const ranks = view.people.map((person, index) => ({ key: person.key, name: person.name, position: index + 1 }));
    const levelRows = [...levels.entries()].map(([key, level]) => ({ key, ...level }));
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
  const podium: RankingRow[] = (view?.people.slice(0, 3) ?? []).map((person, index) => ({
    position: index + 1,
    employeeId: person.key,
    name: person.name,
    storeId: person.storeIds[0],
    sales: person.sales,
    revenue: person.revenue,
  }));
  const rest = view?.people.slice(3) ?? [];

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

      {goalCard && activeGoal ? (
        <Card padding="lg">
          <GlobalGoalBand
            goal={goalCard.band}
            tiers={activeGoal.tiers}
            todayIso={today}
            individual={activeGoal.tierMode === "INDIVIDUAL"}
          />
        </Card>
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

      <div className={cn("grid min-h-0 flex-1 gap-4", challenges.length > 0 && "lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]")}>
        <Card padding="lg" className="min-w-0">
          <CardTitle>Ranking</CardTitle>
          {loading ? (
            <p className="py-10 text-center text-sm text-t2">Carregando o ranking…</p>
          ) : (
            <>
              <RankingBlock ranking={podium} formatAmount={brlCent} />
              {rest.length > 0 && (
                <ul className="mt-4 divide-y divide-line">
                  {rest.map((person) => (
                    <RankRow key={person.key} person={person} place={view!.people.indexOf(person) + 1} level={levels.get(person.key)?.levelLabel ?? null} hot={momentKey(current) === person.key} />
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        {challenges.length > 0 && (
          <div className="flex min-w-0 flex-col gap-4">
            {challenges.map(({ challenge, view: challengeView }) => (
              <ChallengeColumn key={challenge.id} challenge={challenge} view={challengeView} hotKey={current?.kind === "challenge" ? current.key : null} />
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

function RankRow({
  person,
  place,
  level,
  hot,
}: {
  person: TeamMemberRow;
  place: number;
  level: string | null;
  hot: boolean;
}) {
  return (
    <li className={cn("flex items-center gap-3 py-2.5", hot && "rounded-lg bg-acc-soft px-2")}>
      <span className="w-8 shrink-0 text-[13px] font-extrabold text-t2">{place}º</span>
      <PersonAvatar name={person.name} employeeId={person.key} storeId={person.storeIds[0]} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold text-t0">{person.name}</p>
        <p className="text-[12px] text-t2">
          {person.sales} {person.sales === 1 ? "venda" : "vendas"}
        </p>
      </div>
      {level ? <Badge variant="neutral">{level}</Badge> : <span className="text-[12px] text-t2">—</span>}
      <span className="shrink-0 font-mono text-[14px] font-bold text-t0">{brlCent(person.revenue)}</span>
    </li>
  );
}

function ChallengeColumn({
  challenge,
  view,
  hotKey,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  hotKey: string | null;
}) {
  const prize = mainPrizeLabel(challenge);
  const leader = Math.max(0, ...view.participants.map((person) => person.result ?? 0));
  return (
    <Card padding="lg">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{challenge.name}</CardTitle>
          {prize && <p className="mt-1 text-[12px] text-t2">Prêmio {prize}</p>}
        </div>
        <Badge variant="neutral">{view.prazo}</Badge>
      </div>
      <ul className="space-y-2.5">
        {view.participants.map((person) => {
          const pct = challengePct(person, challenge.target, leader);
          return (
            <li key={person.key} className={cn("flex items-center gap-2", hotKey === person.key && "rounded-lg bg-acc-soft px-1")}>
              <span className="w-6 shrink-0 text-[12px] font-extrabold text-t2">{person.position == null ? "—" : `${person.position}º`}</span>
              <span className="w-[88px] shrink-0 truncate text-[13px] font-semibold text-t0">{person.name.split(" ")[0]}</span>
              <div className="min-w-0 flex-1">
                <ProgressBar value={pct} height={6} />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] font-bold text-acc">
                {person.result == null ? "—" : `${num(pct, 0)}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
