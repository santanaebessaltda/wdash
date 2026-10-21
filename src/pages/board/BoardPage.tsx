import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { fetchGoals, fetchGoalTeam } from "@/data/wedash/goalsRepo";
import { emptyChallengeAggInput, fetchChallengeInput, fetchChallenges } from "@/data/wedash/challengesRepo";
import { fetchNamedSellerDayAggs, fetchSalesDayAggs, fetchSalesSellerDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { resolvePeriod, type Scope, type TeamAggInput } from "@/data/wedash/dashboard";
import { fetchTeamAggInput } from "@/pages/dashboard/TeamMemberDetail";
import { useScope } from "@/pages/dashboard/useScope";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { defaultWeekHours, effectiveWeekHours } from "@/data/wedash/storeHours";
import { storesForSession } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { BoardView, boardScopeKey, type BoardChallengesData, type BoardGoalsData, type BoardStore } from "./BoardView";
import { ShareBoardButton } from "./ShareBoardButton";
import { BoardThemeSwitch } from "./boardTheme";

const REFRESH_MS = 30 * 60 * 1000;
const WATERMARK_MS = 60 * 1000;

const GOALS_EMPTY: BoardGoalsData = { goals: [], dayAggs: [], sellerAggs: [], namedAggs: [], team: [] };
const CHALLENGES_EMPTY: BoardChallengesData = { challenges: [], aggs: emptyChallengeAggInput() };

/** Lucide MonitorUp. */
function MonitorUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 10 3-3 3 3" />
      <path d="M12 13V7" />
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function BoardPage() {
  const session = useActiveSession();
  const [params, setParams] = useSearchParams();
  const tv = params.get("tv") === "1";
  const { scope } = useScope();
  const sessionStores = useMemo(() => storesForSession(session.stores), [session.stores]);
  const picked = useMemo(() => {
    const allowed = new Map(sessionStores.map((store) => [store.id, store]));
    const ids = scope.storeIds.length > 0 ? scope.storeIds : sessionStores.map((store) => store.id);
    return ids.flatMap((id) => {
      const store = allowed.get(id);
      return store ? [store] : [];
    });
  }, [scope.storeIds, sessionStores]);
  const scopeKey = boardScopeKey(picked.map((store) => store.id));
  const boardStores = useMemo<BoardStore[]>(
    () =>
      picked.map((store) => ({
        id: store.id,
        tradeName: store.tradeName,
        hours: effectiveWeekHours(store.hours ?? defaultWeekHours()),
      })),
    [picked],
  );
  const [team, setTeam] = useState<TeamAggInput>({ dayAggs: [] });
  const [goalsData, setGoalsData] = useState<BoardGoalsData>(GOALS_EMPTY);
  const [challengesData, setChallengesData] = useState<BoardChallengesData>(CHALLENGES_EMPTY);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [packStore, setPackStore] = useState<string | null>(null);
  const reloadGen = useRef(0);
  const watermarkMs = useRef<number | null>(null);

  const boardScope = useMemo<Scope | null>(() => {
    if (picked.length === 0) return null;
    return { storeIds: picked.map((store) => store.id), period: { kind: "thisMonth" }, division: null };
  }, [picked]);

  const exitTv = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    const next = new URLSearchParams(params);
    if (!next.has("tv")) return;
    next.delete("tv");
    setParams(next, { replace: true });
  }, [params, setParams]);

  function enterTv() {
    const next = new URLSearchParams(params);
    next.set("tv", "1");
    setParams(next);
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  useEffect(() => {
    if (tv && picked.length === 0) exitTv();
  }, [exitTv, picked.length, tv]);

  useEffect(() => {
    if (!tv) return;
    let sawFullscreen = Boolean(document.fullscreenElement);
    const onChange = () => {
      if (document.fullscreenElement) {
        sawFullscreen = true;
        return;
      }
      if (sawFullscreen) exitTv();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [exitTv, tv]);

  const reload = useCallback(async () => {
    if (!boardScope) return;
    const gen = ++reloadGen.current;
    const ids = boardScope.storeIds;
    const today = calendarTodayIso();
    const period = resolvePeriod(boardScope.period, today);
    try {
      const [nextTeam, stamp, goals, challengeRows] = await Promise.all([
        fetchTeamAggInput(session.tenantId, boardScope),
        fetchSyncWatermark(session.tenantId).catch(() => null),
        fetchGoals({ tenantId: session.tenantId, storeIds: ids, from: period.start, to: period.end }),
        fetchChallenges({ tenantId: session.tenantId, storeIds: ids, from: period.start, to: period.end }),
      ]);
      let goalPack = GOALS_EMPTY;
      if (goals.length > 0) {
        const from = goals.reduce((min, goal) => (goal.startsOn < min ? goal.startsOn : min), goals[0]!.startsOn);
        const end = goals.reduce((max, goal) => (goal.endsOn > max ? goal.endsOn : max), goals[0]!.endsOn);
        const to = end < today ? end : today;
        const historyFrom = goalWeightFrom(from);
        const [dayAggs, sellerAggs, namedAggs, teamRows] = await Promise.all([
          historyFrom <= to
            ? fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: ids, from: historyFrom, to, brand: "ALL" })
            : Promise.resolve([]),
          from <= to ? fetchSalesSellerDayAggs({ tenantId: session.tenantId, storeIds: ids, from, to }) : Promise.resolve([]),
          from <= to ? fetchNamedSellerDayAggs({ tenantId: session.tenantId, storeIds: ids, from, to }) : Promise.resolve([]),
          fetchGoalTeam(session.tenantId, ids),
        ]);
        goalPack = { goals, dayAggs, sellerAggs, namedAggs, team: teamRows };
      }
      const challengePack: BoardChallengesData =
        challengeRows.length === 0
          ? CHALLENGES_EMPTY
          : { challenges: challengeRows, aggs: await fetchChallengeInput({ tenantId: session.tenantId, challenges: challengeRows, today }) };
      if (gen !== reloadGen.current) return;
      setTeam(nextTeam);
      setGoalsData(goalPack);
      setChallengesData(challengePack);
      setWatermark(stamp);
      watermarkMs.current = stamp?.getTime() ?? null;
      setPackStore(boardScopeKey(ids));
      setLoading(false);
    } catch (error) {
      if (gen !== reloadGen.current) return;
      console.error("Board reload:", error);
      setLoading(false);
    }
  }, [boardScope, session.tenantId]);

  useEffect(() => {
    if (picked.length === 0) {
      setLoading(false);
      return;
    }
    if (packStore === scopeKey) return;
    setLoading(true);
    if (packStore != null) {
      setTeam({ dayAggs: [] });
      setGoalsData(GOALS_EMPTY);
      setChallengesData(CHALLENGES_EMPTY);
    }
  }, [packStore, picked.length, scopeKey]);

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
    if (picked.length === 0) return;
    const tick = window.setInterval(() => {
      void fetchSyncWatermark(session.tenantId)
        .then((stamp) => {
          const ms = stamp?.getTime() ?? null;
          if (ms != null && ms !== watermarkMs.current) void reload();
        })
        .catch(() => undefined);
    }, WATERMARK_MS);
    return () => window.clearInterval(tick);
  }, [picked.length, reload, session.tenantId]);

  return (
    <>
      {!tv && (
        <PageHeader
          title="Placar"
          subtitle="Acompanhe o desempenho das filiais, o ranking, as metas e os desafios em tempo real."
          actions={
            <>
              <BoardThemeSwitch />
              {picked.length > 0 ? (
                <>
                  <ShareBoardButton stores={boardStores.map((store) => ({ id: store.id, tradeName: store.tradeName }))} />
                  <Button type="button" icon={<MonitorUpIcon />} onClick={enterTv}>
                    Exibir na TV
                  </Button>
                </>
              ) : null}
            </>
          }
        />
      )}
      {picked.length === 0 ? (
        <Card>
          <EmptyState
            framed={false}
            icon="🏬"
            title="Nenhuma filial disponível"
            description="Não há filiais disponíveis para este acesso."
          />
        </Card>
      ) : (
        <BoardView
          stores={boardStores}
          team={team}
          goalsData={goalsData}
          challengesData={challengesData}
          watermark={watermark}
          loading={loading}
          packKey={packStore}
          controls={tv ? "tv" : "page"}
          onExitTv={exitTv}
        />
      )}
    </>
  );
}
