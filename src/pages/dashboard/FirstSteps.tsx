import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, CardTitle, ProgressBar, useToast } from "@/components/ui";
import {
  buildFirstSteps,
  completeFirstSteps,
  fetchFirstStepsData,
  fetchFirstStepsDone,
  storesForFirstStepsView,
  type FirstStep,
  type FirstStepsData,
} from "@/data/wedash/firstSteps";
import { storesForSession } from "@/data/wedash/stores";
import { isGestor } from "@/layout/nav-wedash";
import { cn } from "@/lib/cn";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";

/** loading = ainda nao sabe; hidden = concluido ou nao e Gestor; visible = mostra o card. */
export type FirstStepsStatus = "loading" | "hidden" | "visible";

/**
 * Primeiros passos da empresa (so Gestor). Os passos se marcam sozinhos pelos dados ja salvos;
 * ao chegar a 100% grava no banco e o card nao volta mais.
 */
export function useFirstSteps(filialIds: string[] = []) {
  const session = useActiveSession();
  const { show } = useToast();
  const gestor = isGestor(session.role);
  const [doneFlag, setDoneFlag] = useState<boolean | null>(null);
  const [data, setData] = useState<FirstStepsData | null>(null);
  const [storesTick, setStoresTick] = useState(0);
  const completing = useRef(false);

  useEffect(() => {
    if (!gestor) return;
    let cancelled = false;
    void fetchFirstStepsDone(session.tenantId).then((d) => {
      if (!cancelled) setDoneFlag(d);
    });
    return () => {
      cancelled = true;
    };
  }, [gestor, session.tenantId]);

  const stores = useMemo(
    () => storesForSession(session.stores),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.stores, storesTick],
  );
  const storesKey = stores.map((s) => s.id).join(",");

  const reload = useCallback(async () => {
    const d = await fetchFirstStepsData(session.tenantId, storesKey ? storesKey.split(",") : []);
    setData(d);
  }, [session.tenantId, storesKey]);

  useEffect(() => {
    if (!gestor || doneFlag !== false) return;
    void reload();
    const onStores = () => setStoresTick((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("wedash:stores", onStores);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("wedash:stores", onStores);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [gestor, doneFlag, reload]);

  const viewStores = useMemo(() => storesForFirstStepsView(stores, filialIds), [stores, filialIds]);
  const steps = useMemo(() => (data ? buildFirstSteps({ stores: viewStores, ...data }) : []), [viewStores, data]);
  const doneCount = steps.filter((s) => s.done).length;
  const pendingCount = steps.length - doneCount;
  // 100% definitivo e da rede inteira, mesmo com uma loja selecionada.
  const allDone = useMemo(
    () => data != null && stores.length > 0 && buildFirstSteps({ stores, ...data }).every((s) => s.done),
    [stores, data],
  );

  useEffect(() => {
    if (!allDone || doneFlag !== false || completing.current) return;
    completing.current = true;
    void completeFirstSteps(session.tenantId).then((ok) => {
      completing.current = false;
      if (!ok) return;
      setDoneFlag(true);
      show("Primeiros passos concluídos.", "success");
    });
  }, [allDone, doneFlag, session.tenantId, show]);

  const status: FirstStepsStatus = !gestor || doneFlag === true || allDone ? "hidden" : data == null ? "loading" : "visible";
  return { status, steps, doneCount, pendingCount, tenantId: session.tenantId };
}

function stepAction(step: FirstStep): { label: string; to: string } | null {
  switch (step.id) {
    case "hours":
      return { label: "Configurar funcionamento", to: paths.operation.store };
    case "groups":
      return step.needsGroups
        ? { label: "Criar grupos", to: paths.operation.groups }
        : { label: "Vincular vendedores", to: paths.operation.sellers };
    case "franchise":
      return { label: "Configurar franquia", to: paths.operation.franchise };
    case "rent":
      return { label: "Configurar aluguel", to: paths.operation.rent };
    case "taxes":
      return { label: "Configurar impostos", to: paths.operation.productsTaxes };
    case "goal":
      return { label: "Criar meta", to: paths.goalNew };
    case "challenge":
      return { label: "Criar desafio", to: paths.management.challengeNew };
    default:
      return null;
  }
}

const collapsedKey = (tenantId: string) => `wedash.firstSteps.collapsed:${tenantId}`;

const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function FirstStepsCard({ steps, doneCount, tenantId }: { steps: FirstStep[]; doneCount: number; tenantId: string }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedKey(tenantId)) === "1");
  const pct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  const nextId = steps.find((s) => !s.done)?.id;

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(collapsedKey(tenantId), c ? "0" : "1");
      return !c;
    });
  }

  return (
    <Card className="mt-4 print:hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <CardTitle>Primeiros passos</CardTitle>
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="text-[12px] font-semibold text-t1">
            {doneCount} de {steps.length} concluídos
          </span>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("shrink-0 text-t2 transition-transform", !collapsed && "rotate-180")}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div className="mt-2.5">
        <ProgressBar value={pct} color="var(--acc)" height={4} />
      </div>

      {!collapsed && (
        <div className="mt-3 flex flex-col gap-2 animate-vela-fade">
          {steps.map((step) => {
            const action = step.done ? null : stepAction(step);
            const proximo = step.id === nextId;
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border border-line bg-bg-2 px-4 py-3.5 shadow-[var(--shadow-vela)] hover:border-line-2",
                  proximo && "border-l-[3px] border-l-acc",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border-2",
                    step.done ? "border-ok bg-ok" : proximo ? "border-acc" : "border-line-2",
                  )}
                >
                  {step.done && <CheckIcon />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-t0">{step.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2.5">
                    <span className="text-[11.5px] text-t2">{step.description}</span>
                    {step.detail && <span className="text-[11px] font-bold text-warn">{step.detail}</span>}
                  </div>
                </div>
                {proximo && action && (
                  <Button size="sm" className="shrink-0" onClick={() => navigate(action.to)}>
                    {action.label}
                  </Button>
                )}
                {!proximo && action && (
                  <button
                    type="button"
                    onClick={() => navigate(action.to)}
                    className="shrink-0 text-[12px] font-semibold text-t2 hover:text-acc"
                  >
                    {action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
