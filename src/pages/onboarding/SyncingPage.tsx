import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Badge, Button, Card, ProgressBar, Spinner, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { paths } from "@/router/paths";
import { useActiveSession, useSession } from "@/session/SessionProvider";
import {
  clearAwaitingInitialSync,
  awaitingInitialSyncSince,
  bumpAwaitingInitialSyncSince,
} from "@/session/awaitingInitialSync";
import {
  countDaysInWindow,
  fetchLatestSeedJob,
  fetchSeedDaysByStore,
  fetchSyncReady,
  fetchTenantStores,
  seedCoverageWindow,
  type SyncStoreRow,
} from "@/data/wedash/salesRepo";
import { calendarTodayIso } from "@/data/wedash/clock";
import { getSupabase } from "@/lib/supabase";
import { BrandMark } from "@/pages/auth/authKit";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { padTopoEBase } from "@/lib/safeArea";

/** Job na fila sem worker pegar  ->  erro (nao espera infinito). */
const STUCK_QUEUED_MS = 90_000;
/** RUNNING sem nenhuma loja pronta por muito tempo (hoje leva segundos). */
const STUCK_RUNNING_MS = 5 * 60_000;

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}min ${rest}s` : `${m}min`;
}

function isBusyError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const t = msg.toLowerCase();
  return (
    t.includes("ultrapassado") ||
    t.includes("já está conectado") ||
    t.includes("ja esta conectado") ||
    t.includes("máximo") ||
    t.includes("maximo") ||
    t.includes("busy")
  );
}

function isInternalJobCancel(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const t = msg.toLowerCase();
  return (
    t.includes("onboarding") ||
    t.includes("pausado") ||
    t.includes("reset") ||
    t.includes("worker reiniciado") ||
    t.includes("abandonado")
  );
}

/**
 * Pos-onboarding: espera so o Atualizar de **hoje** (segundos) e abre o dashboard.
 * Os dias anteriores do mes chegam por tras (indicador no Topbar  -  `useMonthFill`).
 * Progresso = lojas com hoje gravado / total (sem fake %).
 */
export function SyncingPage() {
  const session = useActiveSession();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const { show } = useToast();

  const [stores, setStores] = useState<SyncStoreRow[]>([]);
  const [coverage, setCoverage] = useState<Map<string, Set<string>>>(new Map());
  const [status, setStatus] = useState<"running" | "ready" | "failed">("running");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  const toastBusyShown = useRef(false);
  const toastStuckShown = useRef(false);
  const enqueuedOnce = useRef(false);
  const coverageReseedDone = useRef(false);
  const runningSinceRef = useRef<number | null>(null);
  const daysAtRunStartRef = useRef(0);
  const [timing, setTiming] = useState<{ now: number; since: number | null }>({ now: 0, since: null });

  const today = calendarTodayIso();
  const win = useMemo(() => seedCoverageWindow(today), [today]);

  const storeReady = useMemo(
    () => stores.map((s) => countDaysInWindow(coverage.get(s.id), win.from, win.to) > 0),
    [stores, coverage, win.from, win.to],
  );
  const readyCount = storeReady.filter(Boolean).length;
  const allFetchDone = stores.length > 0 && readyCount >= stores.length;

  const progressPct =
    status === "ready"
      ? 100
      : stores.length === 0
        ? 0
        : Math.min(99, Math.round((readyCount / stores.length) * 100));

  const elapsedMs = timing.since ? timing.now - timing.since : 0;

  const enqueueSeed = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    try {
      await sb.functions.invoke("erp-sync-enqueue", { body: { action: "seed" } });
    } catch (e) {
      console.warn("enqueue seed:", e);
    }
  }, []);

  const check = useCallback(async () => {
    const since = awaitingInitialSyncSince();
    const list = await fetchTenantStores(session.tenantId);
    setStores(list);

    const byStore = await fetchSeedDaysByStore(session.tenantId, win.from, win.to);
    setCoverage(byStore);
    setTiming((t) => ({
      ...t,
      now: Date.now(),
      since: since ? new Date(since).getTime() : null,
    }));

    const ready = await fetchSyncReady(session.tenantId, {
      sinceIso: since,
      seedFrom: win.from,
      seedTo: win.to,
    });
    if (ready) {
      clearAwaitingInitialSync();
      setBusy(false);
      setStatus("ready");
      setJobStatus("SUCCEEDED");
      return;
    }

    const job = await fetchLatestSeedJob(session.tenantId);
    setJobStatus(job?.status ?? null);

    const jobIsCurrent = Boolean(
      since &&
        job?.createdAt &&
        new Date(job.createdAt).getTime() >= new Date(since).getTime() - 5_000,
    );

    if (jobIsCurrent && job?.status === "FAILED") {
      const finishedOk =
        job.finishedAt && since
          ? new Date(job.finishedAt).getTime() >= new Date(since).getTime()
          : Boolean(job.finishedAt);
      if (finishedOk) {
        if (isInternalJobCancel(job.error)) {
          setBusy(false);
          setStatus("running");
          enqueuedOnce.current = false;
          await enqueueSeed();
          enqueuedOnce.current = true;
          return;
        }
        const erpBusy = isBusyError(job.error);
        setBusy(erpBusy);
        setStatus("failed");
        if (erpBusy) {
          setErrorMsg(
            "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
          );
          if (!toastBusyShown.current) {
            toastBusyShown.current = true;
            show(
              "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
              "warning",
            );
          }
        } else {
          setErrorMsg("Não foi possível concluir a sincronização. Tente novamente.");
        }
        return;
      }
    }

    setBusy(false);
    const waitedMs = since ? Date.now() - new Date(since).getTime() : 0;
    const totalDays = [...byStore.values()].reduce((a, set) => a + set.size, 0);

    if (!jobIsCurrent || !job || job.status === "QUEUED") {
      runningSinceRef.current = null;
      if (waitedMs >= STUCK_QUEUED_MS) {
        setStatus("failed");
        setErrorMsg(
          "A sincronização está demorando mais que o normal para começar. Tente novamente. Se o problema continuar, fale com o suporte.",
        );
        if (!toastStuckShown.current) {
          toastStuckShown.current = true;
          show("A sincronização não começou. Tente novamente.", "danger");
        }
        return;
      }
      setStatus("running");
      if (!enqueuedOnce.current) {
        enqueuedOnce.current = true;
        await enqueueSeed();
      }
      return;
    }

    if (job.status === "RUNNING") {
      if (runningSinceRef.current == null) {
        runningSinceRef.current = Date.now();
        daysAtRunStartRef.current = totalDays;
      } else if (totalDays > daysAtRunStartRef.current) {
        runningSinceRef.current = Date.now();
        daysAtRunStartRef.current = totalDays;
      }
      if (Date.now() - runningSinceRef.current >= STUCK_RUNNING_MS) {
        setStatus("failed");
        setErrorMsg("A sincronização não está avançando. Tente novamente.");
        if (!toastStuckShown.current) {
          toastStuckShown.current = true;
          show("A sincronização não está avançando. Tente novamente.", "danger");
        }
        return;
      }
      setStatus("running");
      return;
    }

    runningSinceRef.current = null;
    setStatus("running");

    if (job.status === "SUCCEEDED") {
      const finishedOk =
        Boolean(since) &&
        Boolean(job.finishedAt) &&
        new Date(job.finishedAt!).getTime() >= new Date(since!).getTime();
      if (!finishedOk) {
        if (!enqueuedOnce.current) {
          enqueuedOnce.current = true;
          await enqueueSeed();
        }
        return;
      }
      if (totalDays <= 0 || !coverageReseedDone.current) {
        // SEED "ok" mas cobertura incompleta  ->  um reseed.
        if (!coverageReseedDone.current) {
          coverageReseedDone.current = true;
          await enqueueSeed();
        }
      }
      return;
    }

    if (!enqueuedOnce.current) {
      enqueuedOnce.current = true;
      await enqueueSeed();
    }
  }, [session.tenantId, show, enqueueSeed, win.from, win.to]);

  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), 3_000);
    return () => window.clearInterval(id);
  }, [check]);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => {
      void (async () => {
        enqueuedOnce.current = false;
        await enqueueSeed();
        await check();
      })();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [busy, enqueueSeed, check]);

  useEffect(() => {
    if (status !== "ready") return;
    const t = window.setTimeout(() => {
      navigate(`${paths.overview}?periodo=hoje`, { replace: true });
    }, 900);
    return () => window.clearTimeout(t);
  }, [status, navigate]);

  async function retrySeed() {
    toastBusyShown.current = false;
    toastStuckShown.current = false;
    enqueuedOnce.current = false;
    coverageReseedDone.current = false;
    runningSinceRef.current = null;
    daysAtRunStartRef.current = 0;
    bumpAwaitingInitialSyncSince();
    setStatus("running");
    setErrorMsg(null);
    setBusy(false);
    await enqueueSeed();
    enqueuedOnce.current = true;
    await check();
  }

  function sair() {
    signOut();
    navigate(paths.access.login);
  }

  const preparing = status === "running" && (allFetchDone || jobStatus === "SUCCEEDED");
  const lojasTxt =
    stores.length === 1 ? "da sua loja" : stores.length > 1 ? `das ${stores.length} lojas` : "das suas lojas";
  const subtitle =
    status === "ready"
      ? "Vendas de hoje prontas. Abrindo o dashboard…"
      : status === "failed"
        ? errorMsg
        : busy
          ? "Aguardando a sessão do Millennium ficar disponível…"
          : preparing
            ? "Quase lá — abrindo o dashboard."
            : `Buscando as vendas de hoje ${lojasTxt} no Millennium. Isso pode levar alguns instantes.`;

  return (
    <div
      className="pad-topo pad-base flex min-h-screen w-full flex-col bg-bg-0 px-6 pb-10 sm:px-14"
      style={padTopoEBase("2.5rem", "2.5rem")}
    >
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark size={34} />
          <span className="text-[16px] font-extrabold text-t0">{PRODUCT_NAME}</span>
        </div>
        <button
          type="button"
          onClick={sair}
          className="min-h-11 min-w-11 px-2 text-xs font-semibold text-t2 hover:text-t0"
        >
          Sair
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-4">
        <h1 className="text-[22px] font-bold text-t0">
          {status === "ready"
            ? "Tudo pronto!"
            : busy
              ? "Aguardando o Millennium"
              : status === "failed"
                ? "Sincronização interrompida"
                : "Preparando seu dashboard"}
        </h1>
        <p className={cn("mt-2 text-[14px]", status === "failed" ? "text-bad" : "text-t2")}>{subtitle}</p>

        <Card className="mt-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-t3">Vendas de hoje</div>
              <div className="mt-1 text-[34px] font-extrabold leading-none text-t0 tabular-nums">
                {progressPct}%
              </div>
            </div>
            {status === "running" && elapsedMs > 0 && (
              <div className="text-right text-[12px] text-t2">
                Tempo decorrido: <span className="font-semibold text-t1 tabular-nums">{fmtDuration(elapsedMs)}</span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <ProgressBar value={progressPct} color={status === "failed" ? "var(--bad)" : "var(--acc)"} />
          </div>

          {stores.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 text-[13.5px] text-t2">
              <Spinner size={18} />
              Montando a lista de lojas…
            </div>
          ) : (
            <ul className="mt-4 max-h-[36vh] divide-y divide-line overflow-y-auto">
              {stores.map((s, i) => {
                const done = status === "ready" || storeReady[i];
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={s.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-t0">{s.name}</span>
                    {done ? (
                      <Badge variant="success">Concluído</Badge>
                    ) : status === "running" ? (
                      <Spinner size={16} />
                    ) : (
                      <span className="text-[12px] text-t3">Pendente</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {status === "failed" ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => void retrySeed()}>Tentar novamente</Button>
          </div>
        ) : (
          <p className="mt-4 text-center text-[12px] text-t3">
            Depois de entrar, o histórico do mês continuará sendo carregado. Você poderá acompanhar o progresso no topo da tela.
          </p>
        )}
      </div>
    </div>
  );
}

export default SyncingPage;
