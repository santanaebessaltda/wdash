import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGoals, fetchGoalTeam } from "@/data/wedash/goalsRepo";
import { emptyChallengeAggInput, fetchChallengeInput, fetchChallenges } from "@/data/wedash/challengesRepo";
import { fetchNamedSellerDayAggs, fetchSalesDayAggs, fetchSalesSellerDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { resolvePeriod, type Scope, type TeamAggInput } from "@/data/wedash/dashboard";
import { fetchTeamAggInput } from "@/pages/dashboard/TeamMemberDetail";
import { useScope } from "@/pages/dashboard/useScope";
import { searchForRoute } from "@/pages/dashboard/periodQuery";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { defaultWeekHours, effectiveWeekHours } from "@/data/wedash/storeHours";
import { storesForSession } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { paths } from "@/router/paths";
import { BoardView, type BoardChallengesData, type BoardGoalsData } from "./BoardView";

const REFRESH_MS = 30 * 60 * 1000;
const WATERMARK_MS = 60 * 1000;

const GOALS_EMPTY: BoardGoalsData = { goals: [], dayAggs: [], sellerAggs: [], namedAggs: [], team: [] };
const CHALLENGES_EMPTY: BoardChallengesData = { challenges: [], aggs: emptyChallengeAggInput() };

export function BoardPage() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const { scope, setScope } = useScope();
  const storeId = scope.storeIds[0] ?? null;
  const [team, setTeam] = useState<TeamAggInput>({ dayAggs: [] });
  const [goalsData, setGoalsData] = useState<BoardGoalsData>(GOALS_EMPTY);
  const [challengesData, setChallengesData] = useState<BoardChallengesData>(CHALLENGES_EMPTY);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [packStore, setPackStore] = useState<string | null>(null);
  const reloadGen = useRef(0);
  const watermarkMs = useRef<number | null>(null);

  const boardScope = useMemo<Scope | null>(() => {
    if (!storeId) return null;
    return { storeIds: [storeId], period: { kind: "thisMonth" }, division: null };
  }, [storeId]);

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

  const stores = storesForSession(session.stores);
  const store = stores.find((item) => item.id === storeId);
  return (
    <BoardView
      storeId={storeId}
      storeName={store?.tradeName ?? null}
      week={effectiveWeekHours(store?.hours ?? defaultWeekHours())}
      team={team}
      goalsData={goalsData}
      challengesData={challengesData}
      watermark={watermark}
      loading={loading}
      packStore={packStore}
      picker={{
        stores: stores.map((item) => ({ id: item.id, tradeName: item.tradeName })),
        onPick: (id) => setScope({ storeIds: [id], period: scope.period, division: null }),
      }}
      onLeave={storeId ? () => navigate(`${paths.team}${searchForRoute(paths.team, `?store=${storeId}`)}`) : undefined}
    />
  );
}
