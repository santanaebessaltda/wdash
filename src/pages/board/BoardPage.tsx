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
import { BoardView, type BoardChallengesData, type BoardGoalsData } from "./BoardView";
import { ShareBoardButton } from "./ShareBoardButton";

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
  const storeId = scope.storeIds.length === 1 ? scope.storeIds[0]! : null;
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
    if (tv && !storeId) exitTv();
  }, [exitTv, storeId, tv]);

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
    if (packStore === storeId) return;
    setLoading(true);
    if (packStore != null) {
      setTeam({ dayAggs: [] });
      setGoalsData(GOALS_EMPTY);
      setChallengesData(CHALLENGES_EMPTY);
    }
  }, [packStore, storeId]);

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
  const noStores = session.stores.length === 0;

  return (
    <>
      {!tv && (
        <PageHeader
          title="Placar"
          subtitle="Acompanhe o desempenho da filial, ranking, metas e desafios em tempo real."
          actions={
            storeId ? (
              <>
                <ShareBoardButton storeId={storeId} />
                <Button type="button" icon={<MonitorUpIcon />} onClick={enterTv}>
                  Exibir na TV
                </Button>
              </>
            ) : undefined
          }
        />
      )}
      {!storeId ? (
        <Card>
          <EmptyState
            framed={false}
            icon="🏬"
            title={noStores ? "Nenhuma filial disponível" : "Selecione uma filial"}
            description={
              noStores
                ? "Não há filiais disponíveis para este acesso."
                : "Escolha uma filial no seletor do topo para visualizar o placar."
            }
          />
        </Card>
      ) : (
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
          controls={tv ? "tv" : "page"}
          onExitTv={exitTv}
        />
      )}
    </>
  );
}
