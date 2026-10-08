import { useCallback, useEffect, useRef, useState } from "react";
import { Dropdown, Tooltip, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { canForceSyncRefresh, formatForceCooldownLabel } from "@/data/wedash/syncUi";
import { AUTO_REFRESH_MIN, nextAutoRefreshAt, storePhase } from "@/data/wedash/autoRefresh";
import { lastUpdatedLines } from "@/pages/dashboard/LastUpdated";
import { fetchErpIntegrationStatus, fetchLastAutoRefreshAt, type ErpIntegrationStatus } from "@/data/wedash/erp";
import { storesForSession } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT, useForceRefresh } from "@/pages/dashboard/useForceRefresh";
const WATERMARK_POLL_MS = 60_000;
/** Loja aberta sem busca das vendas ha mais que isso (2 rodadas automaticas) = dado atrasado. */
const STALE_OPEN_MS = 2 * AUTO_REFRESH_MIN * 60_000;

/**
 * Atualizar global (Topbar, todas as telas): FORCE de hoje na loja do StorePicker.
 * Ao terminar dispara `SALES_SYNCED_EVENT`  -  a tela aberta recarrega os proprios dados.
 * Rodada automatica que terminou (watermark avancou no poll) dispara o mesmo evento.
 * Tooltip = horario da ultima busca das vendas de hoje + proxima rodada; bolinha amarela =
 * vendas de hoje ainda nao buscadas ou busca atrasada com loja aberta.
 */
export function TopbarRefresh({ storeIds }: { storeIds: string[] }) {
  const session = useActiveSession();
  const { show } = useToast();
  const pode = canForceSyncRefresh(session.role);
  const [erp, setErp] = useState<ErpIntegrationStatus | null>(null);
  const [lastAutoAt, setLastAutoAt] = useState<Date | null>(null);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastWatermark = useRef<number | null>(null);
  const semHover = useMediaQuery("(hover: none)");

  const loadWatermark = useCallback(
    async (notifyIfNewer: boolean) => {
      if (!pode) return;
      try {
        const [wm, st, lastAuto] = await Promise.all([
          fetchSyncWatermark(session.tenantId),
          fetchErpIntegrationStatus(session.tenantId),
          fetchLastAutoRefreshAt(session.tenantId),
        ]);
        const prev = lastWatermark.current;
        lastWatermark.current = wm?.getTime() ?? null;
        setErp(st);
        setLastAutoAt(lastAuto);
        setWatermark(wm);
        setLoaded(true);
        if (notifyIfNewer && prev != null && wm && wm.getTime() > prev) {
          window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
        }
      } catch (e) {
        console.warn("TopbarRefresh watermark:", e);
      }
    },
    [session.tenantId, pode],
  );

  useEffect(() => {
    void loadWatermark(false);
    const id = window.setInterval(() => void loadWatermark(true), WATERMARK_POLL_MS);
    // PWA em segundo plano congela o intervalo: ao voltar, confere na hora se houve rodada nova.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadWatermark(true);
    };
    const onOnline = () => void loadWatermark(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [loadWatermark]);

  const reload = useCallback(async () => {
    await loadWatermark(false);
    window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
  }, [loadWatermark]);

  const disconnected = erp != null && (erp.status !== "VALID" || erp.syncPaused);
  const { canForce, refreshing, forceError, forceDoneAt, forceCooldownSec, forcarAtualizacao } = useForceRefresh({
    storeIds,
    reload,
    disconnected,
  });

  useEffect(() => {
    if (forceError) show(forceError, "danger");
  }, [forceError, show]);

  useEffect(() => {
    if (forceDoneAt) show("Vendas atualizadas.", "success");
  }, [forceDoneAt, show]);

  const now = new Date();
  const autoOn = erp != null && !disconnected && erp.autoRefreshEnabled;
  const lojas = storesForSession(session.stores).filter((s) => storeIds.length === 0 || storeIds.includes(s.id));
  const proxima = autoOn
    ? nextAutoRefreshAt({
        stores: lojas.map((s) => ({ hours: s.horas, timezone: s.fuso })),
        now,
        intervalMin: AUTO_REFRESH_MIN,
        lastAutoAt,
      })
    : null;
  if (!pode || !canForce) return null;

  const algumaAberta = lojas.some((s) => storePhase(s.horas, now, s.fuso) === "open");
  const atrasado =
    loaded &&
    !refreshing &&
    !disconnected &&
    (!watermark ||
      watermark.toDateString() !== now.toDateString() ||
      (algumaAberta && now.getTime() - watermark.getTime() > STALE_OPEN_MS));

  const statusLines = disconnected
    ? [erp?.status === "INVALID" && !erp.syncPaused ? "A senha do Millennium não é mais válida" : "Millennium desconectado"]
    : watermark
      ? lastUpdatedLines(watermark, now)
      : [];
  const proximaLine = proxima
    ? `Próxima atualização às ${proxima.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`
    : null;
  const tooltip = [
    ...(watermark || disconnected ? statusLines : loaded ? ["Vendas de hoje ainda não atualizadas"] : []),
    ...(proximaLine ? [proximaLine] : []),
  ].join("\n");

  const ariaLabel = refreshing
    ? "Buscando as vendas de hoje no Millennium…"
    : forceCooldownSec != null
      ? `Próxima atualização em ${formatForceCooldownLabel(forceCooldownSec)}`
      : storeIds.length === 1
        ? "Atualizar as vendas de hoje da loja selecionada"
        : "Atualizar as vendas de hoje de todas as lojas";

  const bloqueado = refreshing || forceCooldownSec != null;
  const icone = (
    <>
      <RefreshIcon className={cn("shrink-0", refreshing && "animate-spin text-acc")} />
      {atrasado && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warn">
          <span className="sr-only">As vendas de hoje precisam ser atualizadas</span>
        </span>
      )}
    </>
  );
  const buttonClass =
    "relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 disabled:cursor-default disabled:hover:bg-transparent";

  // Celular / tablet (sem hover): o toque abre o horario da ultima busca + "Atualizar agora".
  if (semHover) {
    const [linha1, ...resto] = [...statusLines, ...(proximaLine ? [proximaLine] : [])];
    return (
      <Dropdown
        trigger={
          <button type="button" aria-label="Atualização das vendas" className={buttonClass}>
            {icone}
          </button>
        }
        header={
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold text-t0">
              {refreshing ? "Buscando as vendas de hoje…" : watermark || disconnected ? linha1 : "Vendas de hoje"}
            </span>
            {!refreshing &&
              (watermark || disconnected ? resto : proximaLine ? [proximaLine] : []).map((l) => (
                <span key={l} className="text-[12px] text-t2">
                  {l}
                </span>
              ))}
          </div>
        }
        items={[
          {
            label: refreshing ? "Atualizando…" : "Atualizar agora",
            icon: <RefreshIcon className={cn("shrink-0", refreshing && "animate-spin")} />,
            highlight: true,
            disabled: bloqueado,
            onClick: () => void forcarAtualizacao(),
          },
        ]}
        menuClassName="w-[240px]"
      />
    );
  }

  const button = (
    <button
      type="button"
      onClick={() => void forcarAtualizacao()}
      disabled={bloqueado}
      aria-label={ariaLabel}
      className={buttonClass}
    >
      {icone}
    </button>
  );

  if (!tooltip || refreshing) return button;
  return (
    <Tooltip label={tooltip} side="bottom">
      {button}
    </Tooltip>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}
