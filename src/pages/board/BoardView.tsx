import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Card, CardHero, CardTitle, EmptyState, Modal, StatCard, ThSort, progressTextClass, type SortDir } from "@/components/ui";
import { BoardSkeleton } from "@/components/wedash/LoadingSkeletons";
import { RecordStatusBadge } from "@/components/wedash/RecordBadges";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import { boardMoments, type BoardMoment, type BoardSnapshot } from "@/data/wedash/boardEvents";
import { buildGoalCardView, buildGoalSummary, GOAL_STATUS_LABEL, goalLevelPct, goalSpreadsUnidentified, goalStatus, prazoRemaining } from "@/data/wedash/goalView";
import type { GoalRecord, GoalTeamMember } from "@/data/wedash/goalsRepo";
import { buildChallengeView } from "@/data/wedash/challengeView";
import type { ChallengeAggInput, ChallengeRecord } from "@/data/wedash/challengesRepo";
import { type Scope, type TeamAggInput, type TeamMemberRow } from "@/data/wedash/dashboard";
import { teamViewWithGoalShare } from "@/data/wedash/engine/generalRanking";
import { ChallengeMiniCard } from "@/pages/challenges/ChallengeMiniCard";
import { PALETTE, kpiTone } from "@/pages/dashboard/palette";
import { TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { GoalLevelGuide } from "@/pages/goals/GoalLevelGuide";
import { GlobalGoalBand } from "@/pages/team/goalBlocks";
import { BoardThemeSwitch, useBoardTheme } from "./boardTheme";
import { BoardCelebration, type CelebrationFace } from "./celebration";
import { calendarTodayIso } from "@/data/wedash/clock";
import { defaultWeekHours, effectiveWeekHours, type StoreWeekHours } from "@/data/wedash/storeHours";
import { formatBoardRefreshStatus } from "@/data/wedash/syncUi";
import { brlCent, num, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import overtakeUrl from "@/assets/sound/overtaking.wav";
import firstPlaceUrl from "@/assets/sound/first-place.wav";
import goalLevelUrl from "@/assets/sound/reached-the-goal.wav";
import challengeUrl from "@/assets/sound/target-met.wav";

type RankSortKey = "place" | "name" | "sales" | "meta" | "gap" | "revenue";
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

export type BoardStore = { id: string; tradeName: string; hours: StoreWeekHours; timeZone?: string | null };

/** Uma filial guarda a chave antiga. Várias filiais usam os ids ordenados. */
export function boardScopeKey(storeIds: readonly string[]): string {
  const unique = [...new Set(storeIds)].sort();
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  return unique.join(",");
}

type PersonLevel = {
  levelNumber: number | null;
  levelLabel: string | null;
  name: string;
  pct: number;
  storePct: number;
  /** Quanto falta para o próximo nível. null = não há próximo, ou a pessoa não tem meta. */
  gap: number | null;
  nextName: string | null;
  /** Já está no último nível. */
  top: boolean;
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
  if (moment.kind === "level") return `${firstName(moment.name, names)} atingiu ${moment.level}!`;
  if (moment.kind === "store-level") return `A loja atingiu ${moment.level}!`;
  return `${firstName(moment.name, names)} ganhou o desafio ${moment.challenge}!`;
}

function winHoldId(key: string, challenge: string): string {
  return `${key}\n${challenge}`;
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

const MOMENT_ENTER_MS = 360;
const MOMENT_HOLD_MS = 2240;
const MOMENT_EXIT_MS = 300;
const MOMENT_PEAK_MS = 320;

function momentFace(
  moment: BoardMoment,
  people: TeamMemberRow[],
): { name: string; employeeId: string; storeId: string; place: 1 | 2 | 3 | null } | null {
  if (moment.kind === "store-level") return null;
  const found = people.find((person) => person.key === moment.key);
  const index = found ? people.indexOf(found) : -1;
  const fromRank = index === 0 ? 1 : index === 1 ? 2 : index === 2 ? 3 : null;
  const place =
    moment.kind === "first"
      ? 1
      : moment.kind === "overtake" && (moment.position === 1 || moment.position === 2 || moment.position === 3)
        ? moment.position
        : fromRank;
  return {
    name: found?.name ?? moment.name,
    employeeId: found?.key ?? moment.key,
    storeId: found?.storeIds[0] ?? "",
    place,
  };
}

function levelLabel(levelNumber: number | null, name: string | null): string | null {
  if (levelNumber == null || !name) return null;
  return `N${levelNumber} · ${name}`;
}

function gapLine(level: PersonLevel | null): string | undefined {
  if (!level) return undefined;
  if (level.top) return "Último nível";
  if (level.gap == null) return undefined;
  return level.nextName ? `Faltam ${brlCent(level.gap)} para ${level.nextName}` : `Faltam ${brlCent(level.gap)}`;
}

function storeTotals(days: SalesDayAgg[], storeIds: readonly string[], from: string, to: string) {
  const ids = new Set(storeIds);
  let revenue = 0;
  let sales = 0;
  for (const row of days) {
    if (!ids.has(row.storeId) || row.brand !== "ALL" || row.day < from || row.day > to) continue;
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
function SoundOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SoundOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

const IconSales = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

type GoalBoard = {
  goal: GoalRecord;
  card: ReturnType<typeof buildGoalCardView>;
  summary: ReturnType<typeof buildGoalSummary>;
  storeName: string;
};

function BoardGoalCard({ board, pulse }: { board: GoalBoard; pulse: boolean }) {
  const { goal, card, summary } = board;
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [boardTheme] = useBoardTheme();
  const support = [`${shortDate(goal.startsOn)} a ${shortDate(goal.endsOn)}`];
  if (goalSpreadsUnidentified(goal)) support.push("Rateio automático");
  const currentTier = summary.levelNumber != null ? goal.tiers[summary.levelNumber - 1] : undefined;
  const currentLevel = currentTier
    ? `N${summary.levelNumber} · ${currentTier.name.replace(/^Goal\s+/i, "")} (${num(currentTier.commissionPct, 1)}%)`
    : null;
  const hasLevels = goal.tiers.length > 0;

  return (
    <Card padding="none" glass="var(--bad-soft)" className="shrink-0 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2.5">
        <CardHero compact color="var(--bad)" background="var(--bad-soft)">
          <TargetIcon size={18} />
        </CardHero>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[15px] font-extrabold leading-tight text-t0">{card.name}</p>
            <RecordStatusBadge label={GOAL_STATUS_LABEL[summary.status]} />
          </div>
          <p className="mt-0.5 truncate text-[12px] text-t2">{support.join(" · ")}</p>
        </div>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <p className={`font-mono text-[22px] font-extrabold leading-none tabular-nums sm:text-[26px] ${summary.achieved < 0 ? "text-bad" : "text-t0"}`} data-secret="">{brlCent(summary.achieved)}</p>
        <div className="text-right">
          <p className={`font-mono text-[22px] font-extrabold leading-none tabular-nums sm:text-[26px] ${progressTextClass(summary.pct)}`}>{num(summary.pct, 1)}%</p>
          <p className="mt-0.5 text-[12px] text-t2">de <span data-secret="">{brlCent(goal.target)}</span></p>
        </div>
      </div>
      <div className="mt-1.5">
          <GlobalGoalBand goal={card.band} tiers={card.tiers} embedded soBarra hideOutsideNote highlightCurrent enter pulseCurrent={pulse} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] leading-snug text-t2">
          {currentLevel ? <span className="font-bold text-acc">{currentLevel}</span> : null}
          {currentLevel && summary.projectedPct != null ? <span className="mx-1.5 text-t3">·</span> : null}
          {summary.projectedPct != null ? <span className="font-semibold text-t1">Projeção {num(summary.projectedPct, 0)}%</span> : null}
          {(currentLevel || summary.projectedPct != null) ? <span className="mx-1.5 text-t3">·</span> : null}
          <span>{prazoRemaining(summary.daysRemaining)}</span>
        </p>
        {hasLevels ? (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setLevelsOpen(true)}>
            Níveis de premiação
          </Button>
        ) : null}
      </div>
      {hasLevels ? (
        <Modal open={levelsOpen} onClose={() => setLevelsOpen(false)} title="Níveis de premiação" size="lg" boardTheme={boardTheme}>
          <GoalLevelGuide goal={goal} sellers={card.sellers} flush hideNote />
        </Modal>
      ) : null}
    </Card>
  );
}

function FullscreenIcon({ exit }: { exit: boolean }) {
  return exit ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function WinBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -bottom-1 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-bg-2 px-1 py-px text-[9px] font-bold leading-none text-t0">
      <span aria-hidden>🏆</span>
      <span>{count}</span>
    </span>
  );
}

function EyeOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeShutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function BoardView({
  stores,
  team,
  goalsData,
  challengesData,
  watermark,
  loading,
  packKey,
}: {
  stores: BoardStore[];
  team: TeamAggInput;
  goalsData: BoardGoalsData;
  challengesData: BoardChallengesData;
  watermark: Date | null;
  loading: boolean;
  packKey: string | null;
}) {
  const [boardTheme] = useBoardTheme();
  const [unlocked, setUnlocked] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [askSound, setAskSound] = useState(false);
  const [current, setCurrent] = useState<BoardMoment | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [lingerKey, setLingerKey] = useState<string | null>(null);
  const queue = useRef<BoardMoment[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const lingerTimer = useRef(0);
  const seenSnap = useRef<string | null>(null);
  const [rankSort, setRankSort] = useState<{ key: RankSortKey; dir: SortDir }>({ key: "place", dir: "asc" });
  const [heldWins, setHeldWins] = useState<Set<string>>(() => new Set());
  const [challengeSlot, setChallengeSlot] = useState(0);
  const [challengeOn, setChallengeOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const today = calendarTodayIso();
  const scopeKey = boardScopeKey(stores.map((store) => store.id));
  const manyStores = stores.length > 1;
  const storeName = new Map(stores.map((store) => [store.id, store.tradeName]));
  const headline = manyStores ? `${stores.length} filiais` : (stores[0]?.tradeName ?? "Filial");
  const boardScope = useMemo<Scope | null>(() => {
    if (!scopeKey) return null;
    return { storeIds: scopeKey.split(","), period: { kind: "thisMonth" }, division: null };
  }, [scopeKey]);
  const view = useMemo(() => {
    if (!boardScope) return null;
    return teamViewWithGoalShare(boardScope, team, goalsData.goals, goalsData.team, today, new Map(stores.map((store) => [store.id, store.tradeName])));
  }, [boardScope, goalsData.goals, goalsData.team, stores, team, today]);

  const goalBoards = useMemo<GoalBoard[]>(() => {
    return goalsData.goals
      .filter((goal) => goalStatus(goal, today) === "active")
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
      .map((goal) => {
        const store = stores.find((item) => item.id === goal.storeId);
        const name = store?.tradeName ?? "Filial";
        const week = store?.hours ?? effectiveWeekHours(defaultWeekHours());
        return {
          goal,
          storeName: name,
          card: buildGoalCardView({
            goal,
            storeNameValue: name,
            dayAggs: goalsData.dayAggs,
            sellerDayAggs: goalsData.sellerAggs,
            namedSellerDayAggs: goalsData.namedAggs,
            team: goalsData.team,
            today,
            week,
          }),
          summary: buildGoalSummary(goal, goalsData.dayAggs, today, week),
        };
      });
  }, [goalsData, stores, today]);

  const challenges = useMemo(() => {
    return challengesData.challenges
      .map((challenge) => ({ challenge, view: buildChallengeView({ challenge, aggs: challengesData.aggs, today }) }))
      .filter((card) => card.view.status === "active")
      .sort((a, b) => a.challenge.endsOn.localeCompare(b.challenge.endsOn) || a.challenge.name.localeCompare(b.challenge.name, "pt-BR"));
  }, [challengesData, today]);

  const levels = useMemo(() => {
    const byStore = new Map<string, PersonLevel>();
    const byKey = new Map<string, PersonLevel>();
    const byName = new Map<string, PersonLevel>();
    for (const board of goalBoards) {
      for (const seller of board.card.sellers) {
        if (seller.noGoal || seller.manager) continue;
        const slot = `${board.goal.storeId}:${seller.employeeId}`;
        if (byStore.has(slot)) continue;
        const row: PersonLevel = {
          name: seller.name,
          levelNumber: seller.currentLevel,
          levelLabel: levelLabel(seller.currentLevel, seller.currentTierName),
          pct: goalLevelPct(seller.attainmentPct, board.goal.tiers.map((t) => t.minAttainmentPct)),
          storePct: seller.storeGoalPct,
          gap: seller.nextTier ? seller.nextTier.gapAmount : null,
          nextName: seller.nextTier?.name ?? null,
          top: seller.currentLevel != null && seller.nextTier == null,
        };
        byStore.set(slot, row);
        if (!byKey.has(seller.employeeId)) byKey.set(seller.employeeId, row);
        const name = seller.name.trim().toLocaleLowerCase("pt-BR");
        if (!byName.has(name)) byName.set(name, row);
      }
    }
    return { byStore, byKey, byName };
  }, [goalBoards]);

  function personLevel(person: TeamMemberRow): PersonLevel | null {
    const home = person.storeIds[0];
    if (home) {
      const hit = levels.byStore.get(`${home}:${person.key}`);
      if (hit) return hit;
    }
    if (manyStores) return null;
    return levels.byKey.get(person.key) ?? levels.byName.get(person.name.trim().toLocaleLowerCase("pt-BR")) ?? null;
  }

  function goalFor(person: TeamMemberRow): GoalBoard | null {
    const home = person.storeIds[0];
    const match = goalBoards.find((board) => board.goal.storeId === home);
    if (match) return match;
    if (!manyStores && goalBoards.length === 1) return goalBoards[0]!;
    return null;
  }

  const snapshot = useMemo<BoardSnapshot | null>(() => {
    if (!view || stores.length === 0) return null;
    const storeBoard = goalBoards.length === 1 && goalBoards[0]!.goal.tierMode !== "INDIVIDUAL" ? goalBoards[0]! : null;
    return {
      ranks: view.people.map((person, index) => ({ key: person.key, name: person.name, position: index + 1 })),
      levels: [...levels.byKey.entries()].map(([key, level]) => ({
        key,
        name: level.name,
        levelNumber: level.levelNumber,
        levelLabel: level.levelLabel,
      })),
      storeLevelNumber: storeBoard?.summary.levelNumber ?? null,
      storeLevelLabel: levelLabel(storeBoard?.summary.levelNumber ?? null, storeBoard?.summary.currentLevel ?? null),
      winners: challenges.flatMap(({ challenge, view: challengeView }) =>
        challengeView.participants
          .filter((person) => person.winner)
          .map((person) => ({ challengeId: challenge.id, challengeName: challenge.name, key: person.key, name: person.name })),
      ),
    };
  }, [challenges, goalBoards, levels, stores.length, view]);

  useEffect(() => {
    if (!snapshot || !scopeKey || packKey !== scopeKey) return;
    const serial = JSON.stringify(snapshot);
    if (seenSnap.current === serial) return;
    seenSnap.current = serial;
    const previous = readSnapshot(scopeKey);
    writeSnapshot(scopeKey, snapshot);
    const moments = boardMoments(previous, snapshot).slice(0, MOMENT_CAP);
    if (moments.length === 0) return;
    const holds = moments.flatMap((moment) => (moment.kind === "challenge" ? [winHoldId(moment.key, moment.challenge)] : []));
    if (holds.length > 0) setHeldWins((prev) => new Set([...prev, ...holds]));
    queue.current.push(...moments);
    setCurrent((showing) => showing ?? queue.current.shift() ?? null);
  }, [packKey, scopeKey, snapshot]);

  useEffect(() => {
    if (readMuted()) return;
    let cancel = false;
    const clip = new Audio(overtakeUrl);
    clip.volume = 0;
    void clip
      .play()
      .then(() => {
        clip.pause();
        if (!cancel) setUnlocked(true);
      })
      .catch(() => {
        if (!cancel) setAskSound(true);
      });
    return () => {
      cancel = true;
      clip.pause();
    };
  }, []);

  useEffect(() => {
    if (!current || !unlocked || muted) return;
    const kind = current.kind;
    audio.current?.pause();
    const timer = window.setTimeout(() => {
      const clip = new Audio(SOUND[kind]);
      clip.volume = 0.85;
      audio.current = clip;
      void clip.play().catch(() => undefined);
    }, MOMENT_PEAK_MS);
    return () => window.clearTimeout(timer);
  }, [current, muted, unlocked]);

  useEffect(() => {
    if (!current) return;
    const showing = current;
    setLeaving(false);
    const exitTimer = window.setTimeout(() => {
      setLeaving(true);
      const key = momentKey(showing);
      if (!key) return;
      setLingerKey(key);
      window.clearTimeout(lingerTimer.current);
      lingerTimer.current = window.setTimeout(() => setLingerKey((value) => (value === key ? null : value)), 900);
    }, MOMENT_ENTER_MS + MOMENT_HOLD_MS);
    const doneTimer = window.setTimeout(() => {
      if (showing.kind === "challenge") {
        const id = winHoldId(showing.key, showing.challenge);
        setHeldWins((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      audio.current?.pause();
      setLeaving(false);
      setCurrent(queue.current.shift() ?? null);
    }, MOMENT_ENTER_MS + MOMENT_HOLD_MS + MOMENT_EXIT_MS);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [current]);

  useEffect(() => {
    if (challenges.length < 2) return;
    let fade: number | null = null;
    const timer = window.setInterval(() => {
      setChallengeOn(false);
      fade = window.setTimeout(() => {
        setChallengeSlot((slot) => (slot + 1) % challenges.length);
        setChallengeOn(true);
      }, 280);
    }, 10000);
    return () => {
      window.clearInterval(timer);
      if (fade != null) window.clearTimeout(fade);
    };
  }, [challenges.length]);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const winCount = useMemo(() => {
    const map = new Map<string, number>();
    const count = (people: { key: string; winner: boolean }[]) => {
      for (const person of people) {
        if (person.winner) map.set(person.key, (map.get(person.key) ?? 0) + 1);
      }
    };
    count(challenges.flatMap((card) => card.view.participants));
    for (const challenge of challengesData.challenges) {
      if (challenges.some((card) => card.challenge.id === challenge.id)) continue;
      count(buildChallengeView({ challenge, aggs: challengesData.aggs, today }).participants);
    }
    return map;
  }, [challenges, challengesData, today]);

  if (loading) {
    return <BoardSkeleton header className="h-full overflow-hidden p-3 sm:p-4" />;
  }

  function toggleRankSort(key: RankSortKey) {
    setRankSort((currentSort) => {
      if (currentSort.key === key) return { key, dir: currentSort.dir === "asc" ? "desc" : "asc" };
      return { key, dir: key === "name" || key === "place" ? "asc" : "desc" };
    });
  }

  function visibleWins(key: string): number {
    const total = winCount.get(key) ?? 0;
    let held = 0;
    for (const id of heldWins) {
      if (id.startsWith(`${key}\n`)) held += 1;
    }
    return Math.max(0, total - held);
  }

  function unlock(nextMuted = muted) {
    const clip = new Audio(overtakeUrl);
    clip.volume = 0;
    void clip.play().then(() => clip.pause()).catch(() => undefined);
    setUnlocked(true);
    setMuted(nextMuted);
    setAskSound(false);
    try {
      localStorage.setItem(MUTE_KEY, nextMuted ? "1" : "0");
    } catch {
      /* segue sem gravar */
    }
  }

  if (stores.length === 0) return null;

  const names = view?.people.map((person) => person.name) ?? [];
  const homeStore = (person: TeamMemberRow) => person.storeIds[0] ?? stores[0]?.id ?? "";
  const podium: RankingRow[] = (view?.people.slice(0, 3) ?? []).map((person, index) => {
    const level = personLevel(person);
    const home = homeStore(person);
    return {
      position: index + 1,
      employeeId: person.key,
      name: firstName(person.name, names),
      avatarName: person.name,
      storeId: home,
      sales: person.sales,
      revenue: person.revenue,
      note: level ? (level.levelLabel ?? "Sem nível") : undefined,
      gap: gapLine(level),
      place: manyStores ? storeName.get(home) : undefined,
      wins: visibleWins(person.key),
    };
  });
  const activeGoal = goalBoards[0] ?? null;
  const month = view ? storeTotals(team.dayAggs, scopeKey.split(","), view.period.start, view.period.end) : { revenue: 0, sales: 0 };
  const todayTotals = storeTotals(team.dayAggs, scopeKey.split(","), today, today);
  const monthRevenue = view?.composition.total ?? month.revenue;
  const celebration: CelebrationFace | null = current ? momentFace(current, view?.people ?? []) : null;
  const passedPerson =
    current?.kind === "overtake" ? (view?.people.find((person) => person.name === current.passed) ?? null) : null;
  const passedFace: CelebrationFace | null =
    current?.kind === "overtake"
      ? {
          name: passedPerson?.name ?? current.passed,
          employeeId: passedPerson?.key ?? "passed",
          storeId: passedPerson?.storeIds[0] ?? "",
        }
      : null;
  const soundLabel = !unlocked ? "Ativar som" : muted ? "Som desligado" : "Som ligado";
  const challengeCard = challenges.length > 0 ? challenges[challengeSlot % challenges.length] : null;
  const pulseGoal = current?.kind === "level" || current?.kind === "store-level";
  const canFull = typeof document !== "undefined" && document.fullscreenEnabled;

  function toggleFull() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-4 overflow-x-hidden overflow-y-auto p-3 sm:p-4 xl:overflow-y-hidden", !peek && "board-secret")}>
      <style>{`@keyframes board-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}@keyframes board-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes board-breathe{0%,100%{box-shadow:0 0 0 3px #f7b84e,0 0 14px rgba(247,184,78,.28)}50%{box-shadow:0 0 0 3px #f7b84e,0 0 26px rgba(247,184,78,.5)}}@keyframes board-pin{0%,100%{filter:none}50%{filter:brightness(1.55)}}.board-in{animation:board-in .7s ease both}.board-breathe{animation:board-breathe 4.8s ease-in-out infinite}.board-pin{animation:board-pin .7s ease-in-out 2}.board-secret [data-secret]{filter:blur(8px);user-select:none;-webkit-user-select:none}@media (prefers-reduced-motion:reduce){.board-in,.board-breathe,.board-pin{animation:none}}`}</style>
      <header className="board-in flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-extrabold leading-tight tracking-tight text-t0 sm:text-[22px]">{headline}</h1>
          <p className="text-[13px] font-medium leading-snug text-t1">
            {monthLabel(today)}
            <span className="mx-1.5">·</span>
            {formatBoardRefreshStatus({ watermark, now, loading, stores })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={cn(
              "inline-flex h-8 w-8 touch-none items-center justify-center rounded-[9px] border transition-colors select-none",
              peek ? "border-acc bg-acc-soft text-acc" : "border-line text-t1 hover:border-acc",
            )}
            aria-pressed={peek}
            aria-label="Segure para mostrar os valores"
            title="Segure para mostrar os valores"
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setPeek(true);
            }}
            onPointerUp={() => setPeek(false)}
            onPointerCancel={() => setPeek(false)}
            onLostPointerCapture={() => setPeek(false)}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              setPeek(true);
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") setPeek(false);
            }}
            onBlur={() => setPeek(false)}
          >
            {peek ? <EyeOpenIcon /> : <EyeShutIcon />}
          </button>
          <BoardThemeSwitch />
          <button
            type="button"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition-colors",
              unlocked && !muted ? "border-acc bg-acc-soft text-acc" : "border-line text-t1 hover:border-acc",
            )}
            aria-label={soundLabel}
            title={soundLabel}
            onClick={() => (unlocked ? unlock(!muted) : unlock(false))}
          >
            {!unlocked || muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </button>
          {canFull ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-t1 transition-colors hover:border-acc"
              aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
              title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
              onClick={toggleFull}
            >
              <FullscreenIcon exit={fullscreen} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="board-in grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4" style={{ animationDelay: "70ms" }}>
        <StatCard dense glass secret label="Faturamento" value={brlCent(monthRevenue)} sub={<>Hoje <span data-secret="">{brlCent(todayTotals.revenue)}</span></>} icon={<IconRevenue />} iconColor={kpiTone("Faturamento").iconColor} iconBg={kpiTone("Faturamento").iconBg} />
        <StatCard dense glass label="Vendas" value={num(month.sales)} sub={<>Hoje {num(todayTotals.sales)}</>} icon={<IconSales />} iconColor={kpiTone("Vendas").iconColor} iconBg={kpiTone("Vendas").iconBg} />
        <StatCard
          dense
          glass
          secret
          label="Meta"
          value={activeGoal ? brlCent(activeGoal.goal.target) : "—"}
          sub={activeGoal ? activeGoal.card.name : "Não configurada"}
          icon={<TargetIcon size={16} />}
          iconColor={PALETTE.blue}
          iconBg={PALETTE.blueSoft}
        />
        <StatCard
          dense
          glass
          label="Progresso da meta"
          value={activeGoal ? `${num(activeGoal.summary.pct, 1)}%` : "—"}
          sub={
            activeGoal
              ? activeGoal.goal.tierMode === "INDIVIDUAL"
                ? "Meta individual"
                : activeGoal.summary.currentLevel
                  ? `N${activeGoal.summary.levelNumber} · ${activeGoal.summary.currentLevel}`
                  : "Sem nível"
              : "Meta não configurada"
          }
          icon={<TrophyIcon size={16} />}
          iconColor={PALETTE.green}
          iconBg={PALETTE.greenSoft}
        />
      </div>

      {activeGoal ? (
        <div className="board-in shrink-0" style={{ animationDelay: "140ms" }}>
          <BoardGoalCard board={activeGoal} pulse={pulseGoal} />
        </div>
      ) : (
        <Card glass="var(--bad-soft)" className="board-in shrink-0 !p-3" style={{ animationDelay: "140ms" }}>
          <EmptyState framed={false} icon="🎯" title="Meta não configurada" description="Cadastre uma meta para acompanhar o desempenho da equipe no período." />
        </Card>
      )}

      <div
        className={cn(
          "board-in grid min-h-0 flex-1 gap-4",
          challengeCard
            ? "grid-rows-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:grid-cols-[minmax(0,65fr)_minmax(220px,35fr)] xl:grid-rows-[minmax(0,1fr)]"
            : "grid-rows-[minmax(0,1fr)]",
        )}
        style={{ animationDelay: "200ms" }}
      >
        <Card padding="sm" glass={PALETTE.amberSoft} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden !px-3 !py-2">
          <div className="mb-0.5 flex shrink-0 items-center gap-2">
            <CardHero compact tone="warn">
              <TrophyIcon size={18} />
            </CardHero>
            <CardTitle>Ranking</CardTitle>
          </div>
          {(view?.people.length ?? 0) === 0 ? (
            <EmptyState framed={false} icon="📊" title="Sem dados no período" description="Nenhuma venda registrada no período selecionado." />
          ) : (
            <>
              <div className="shrink-0">
                <RankingBlock ranking={podium} formatAmount={brlCent} spotlight literalName motion flashId={lingerKey} secret />
              </div>
              {(view?.people.length ?? 0) > 3 && (
                <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
                  <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-t2">Demais posições</p>
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-line">
                        <ThSort label="#" active={rankSort.key === "place"} dir={rankSort.dir} align="left" className="pb-1.5 pr-2" onClick={() => toggleRankSort("place")} />
                        <ThSort label="Pessoa" active={rankSort.key === "name"} dir={rankSort.dir} align="left" className="pb-1.5 pr-2" onClick={() => toggleRankSort("name")} />
                        <ThSort label="Vendas" active={rankSort.key === "sales"} dir={rankSort.dir} align="right" className="pb-1.5 pr-2" onClick={() => toggleRankSort("sales")} />
                        <ThSort label="Meta" active={rankSort.key === "meta"} dir={rankSort.dir} align="right" className="pb-1.5 pr-2" onClick={() => toggleRankSort("meta")} />
                        <ThSort label="Falta" active={rankSort.key === "gap"} dir={rankSort.dir} align="right" className="pb-1.5 pr-2" onClick={() => toggleRankSort("gap")} />
                        <ThSort label="Faturamento" active={rankSort.key === "revenue"} dir={rankSort.dir} align="right" className="pb-1.5" onClick={() => toggleRankSort("revenue")} />
                      </tr>
                    </thead>
                    <tbody>
                      {view!.people
                        .map((person, index) => ({ person, place: index + 1 }))
                        .slice(3)
                        .sort((a, b) => {
                          const metaOf = (person: TeamMemberRow) => {
                            const level = personLevel(person);
                            if (!level) return null;
                            return goalFor(person)?.goal.tierMode === "INDIVIDUAL" ? level.pct : level.storePct;
                          };
                          const value = (row: { person: TeamMemberRow; place: number }): number | string | null => {
                            if (rankSort.key === "place") return row.place;
                            if (rankSort.key === "name") return row.person.name;
                            if (rankSort.key === "sales") return row.person.sales;
                            if (rankSort.key === "revenue") return row.person.revenue;
                            if (rankSort.key === "gap") return personLevel(row.person)?.gap ?? null;
                            return metaOf(row.person);
                          };
                          const left = value(a);
                          const right = value(b);
                          if (left == null && right == null) return a.place - b.place;
                          if (left == null) return 1;
                          if (right == null) return -1;
                          const compared = typeof left === "string" ? left.localeCompare(right as string, "pt-BR") : left - (right as number);
                          if (compared === 0) return a.place - b.place;
                          return rankSort.dir === "asc" ? compared : -compared;
                        })
                        .map(({ person, place }) => {
                          const level = personLevel(person);
                          const board = goalFor(person);
                          const home = homeStore(person);
                          const individual = board?.goal.tierMode === "INDIVIDUAL";
                          const pct = level ? `${num(individual ? level.pct : level.storePct, 1)}%` : null;
                          const wins = visibleWins(person.key);
                          return (
                            <tr key={person.key} className={cn("border-b border-line last:border-b-0", lingerKey === person.key && "board-row-flash")}>
                              <td className="py-1 pr-2 font-bold text-t3">{place}º</td>
                              <td className="py-1 pr-2">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="relative inline-flex">
                                    <PersonAvatar name={person.name} employeeId={person.key} storeId={home} size="sm" />
                                    <WinBadge count={wins} />
                                  </span>
                                  <span className="min-w-0 truncate text-[12.5px] font-bold text-t0">{person.name}</span>
                                </span>
                              </td>
                              <td className="py-1 pr-2 text-right font-mono text-[12.5px] font-bold tabular-nums text-acc">{num(person.sales)}</td>
                              <td className="py-1 pr-2 text-right">
                                <span className={`block font-mono text-[12.5px] font-extrabold tabular-nums ${pct ? "text-acc" : "text-t0"}`}>{pct ?? "—"}</span>
                                {level ? <span className="block text-[11px] text-t2">{level.levelLabel ?? "Sem nível"}</span> : null}
                              </td>
                              <td className="py-1 pr-2 text-right">
                                {level?.top ? (
                                  <span className="text-[12px] font-bold text-acc">Último nível</span>
                                ) : level?.gap == null ? (
                                  <span className="text-t2">—</span>
                                ) : (
                                  <>
                                    <span className="block font-mono text-[12px] font-bold tabular-nums text-t0" data-secret="">{brlCent(level.gap)}</span>
                                    {level.nextName ? <span className="block text-[11px] text-t2">para {level.nextName}</span> : null}
                                  </>
                                )}
                              </td>
                              <td className={`py-1 text-right font-mono text-[12.5px] font-bold tabular-nums ${person.revenue < 0 ? "text-bad" : "text-acc"}`} data-secret="">{brlCent(person.revenue)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        {challengeCard ? (
          <div className={cn("h-full min-h-0 transition-opacity duration-300", challengeOn ? "opacity-100" : "opacity-0")}>
            <ChallengeMiniCard
              challenge={challengeCard.challenge}
              view={challengeCard.view}
              prominent
              showPeople
              floor
              secret
              counter={challenges.length > 1 ? `${(challengeSlot % challenges.length) + 1} / ${challenges.length}` : null}
              hotKey={current?.kind === "challenge" ? current.key : null}
            />
          </div>
        ) : null}
      </div>

      {askSound && !unlocked && !muted
        ? createPortal(
            <div data-board-theme={boardTheme} className="fixed inset-0 z-[130] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby="board-sound-title">
              <div className="absolute inset-0 bg-black/60" />
              <div className="relative w-full max-w-sm rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)]">
                <h3 id="board-sound-title" className="text-[15px] font-bold text-t0">Permitir o som</h3>
                <p className="mt-2 text-[13px] leading-snug text-t1">O placar avisa quando alguém sobe no ranking. Permita o som neste aparelho.</p>
                <Button type="button" className="mt-4 w-full" onClick={() => unlock(false)}>Permitir som</Button>
              </div>
            </div>,
            document.body,
          )
        : null}
      {current
        ? createPortal(
            <BoardCelebration
              moment={current}
              leaving={leaving}
              face={celebration}
              passed={passedFace}
              caption={momentText(current, names)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
