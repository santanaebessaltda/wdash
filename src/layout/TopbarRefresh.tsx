import { useCallback, useEffect, useRef, useState } from "react";
import { Dropdown, Tooltip, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { fetchSyncWatermark, salesChangedSince } from "@/data/wedash/salesRepo";
import { canForceSyncRefresh, formatForceCooldownLabel } from "@/data/wedash/syncUi";
import { AUTO_REFRESH_MIN, storePhase } from "@/data/wedash/autoRefresh";
import { fetchErpIntegrationStatus, type ErpIntegrationStatus } from "@/data/wedash/erp";
import { storesForSession } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { readScreenRefresh, refreshMomentTitle, useScreenRefreshGeneration } from "@/pages/dashboard/screenRefresh";
import { SALES_SYNCED_EVENT, useForceRefresh } from "@/pages/dashboard/useForceRefresh";
import { CHECK_SALES_EVENT, salesChanged, shouldRefreshScreen, watermarkAfterRead } from "@/push/resumeSales";
const WATERMARK_POLL_MS = 60_000;
/** Loja aberta sem busca das vendas ha mais que isso (2 rodadas automaticas) = dado atrasado. */
const STALE_OPEN_MS = 2 * AUTO_REFRESH_MIN * 60_000;

/**
 * Atualizar global (Topbar). Sem tela registrada: FORCE de hoje na loja do StorePicker.
 * Tela registrada (`useScreenRefresh`): busca só o que aquela tela mostra; o tooltip é o dela.
 * Ao terminar um FORCE de vendas dispara `SALES_SYNCED_EVENT` — a tela aberta recarrega os próprios dados.
 * Rodada automatica que terminou (watermark avancou no poll, ao voltar ou pelo aviso) dispara o mesmo evento.
 * Tooltip e menu: título = estado da última busca; subtítulo = o que este clique busca.
 * Bolinha amarela = vendas de hoje ainda nao buscadas ou busca atrasada com loja aberta.
 */
export function TopbarRefresh({ storeIds }: { storeIds: string[] }) {
  const session = useActiveSession();
  const { show } = useToast();
  const pode = canForceSyncRefresh(session.role);
  const [erp, setErp] = useState<ErpIntegrationStatus | null>(null);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastWatermark = useRef<number | null>(null);
  const semHover = useMediaQuery("(hover: none)");
  const telaGen = useScreenRefreshGeneration();
  const [telaBusy, setTelaBusy] = useState(false);

  const loadWatermark = useCallback(
    async (notifyIfNewer: boolean): Promise<boolean> => {
      if (!pode) return false;
      try {
        const [wm, st] = await Promise.all([
          fetchSyncWatermark(session.tenantId),
          fetchErpIntegrationStatus(session.tenantId),
        ]);
        const prev = lastWatermark.current;
        const stored = watermarkAfterRead(prev, wm);
        let changed: boolean | null = null;
        if (notifyIfNewer && salesChanged(prev, stored)) {
          changed = await salesChangedSince(session.tenantId, new Date(prev as number).toISOString());
        }
        lastWatermark.current = stored;
        setErp(st);
        setWatermark(stored != null ? new Date(stored) : null);
        setLoaded(true);
        if (shouldRefreshScreen(prev, stored, changed)) {
          window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
        }
        return true;
      } catch (e) {
        console.warn("TopbarRefresh watermark:", e);
        return false;
      }
    },
    [session.tenantId, pode],
  );

  useEffect(() => {
    void loadWatermark(false);
    const id = window.setInterval(() => void loadWatermark(true), WATERMARK_POLL_MS);
    // PWA em segundo plano congela o intervalo. No iPhone, abrir pelo aviso
    // muitas vezes não muda visibilityState: pageshow e focus cobrem isso.
    // Leitura que falha tenta de novo — senão a marca some e a tela não recarrega.
    let cancel = false;
    let resumeTimer = 0;
    let retryTimer = 0;
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        void loadWatermark(true).then((ok) => {
          if (cancel || ok || document.visibilityState !== "visible") return;
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => void loadWatermark(true), 1500);
        });
      }, 200);
    };
    const onSynced = () => void loadWatermark(false);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener(CHECK_SALES_EVENT, onResume);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => {
      cancel = true;
      window.clearInterval(id);
      window.clearTimeout(resumeTimer);
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      window.removeEventListener(CHECK_SALES_EVENT, onResume);
      window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
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
    if (forceDoneAt && !readScreenRefresh()) show("Vendas atualizadas.", "success");
  }, [forceDoneAt, show]);

  const clicar = async () => {
    const tela = readScreenRefresh();
    if (tela && !tela.sales) {
      if (telaBusy) return;
      if (disconnected) {
        show("O Millennium está desconectado. Conecte a integração para atualizar esta tela.", "danger");
        return;
      }
      setTelaBusy(true);
      try {
        await tela.run();
      } catch (e) {
        console.warn("screen refresh:", e);
      } finally {
        setTelaBusy(false);
      }
      return;
    }
    if (!disconnected && tela?.sales) void tela.run();
    await forcarAtualizacao();
  };

  const now = new Date();
  const lojas = storesForSession(session.stores).filter((s) => storeIds.length === 0 || storeIds.includes(s.id));
  if (!pode || !canForce) return null;

  // telaGen re-renderiza quando a tela assume ou solta o botão.
  const tela = telaGen >= 0 ? readScreenRefresh() : null;
  const proprio = tela != null && !tela.sales;
  const ocupado = proprio ? telaBusy : refreshing;

  const algumaAberta = lojas.some((s) => storePhase(s.horas, now, s.fuso) === "open");
  const atrasado =
    !proprio &&
    loaded &&
    !ocupado &&
    !disconnected &&
    (!watermark ||
      watermark.toDateString() !== now.toDateString() ||
      (algumaAberta && now.getTime() - watermark.getTime() > STALE_OPEN_MS));

  const salesTip =
    storeIds.length === 1
      ? "Busca no Millennium as vendas de hoje da filial selecionada."
      : "Busca no Millennium as vendas de hoje de todas as filiais.";
  const tip = tela?.tip ?? salesTip;
  const busyLabel = tela?.busyLabel ?? "Buscando as vendas de hoje…";
  const disconnectTitle =
    erp?.status === "INVALID" && !erp.syncPaused ? "A senha do Millennium não é mais válida" : "Millennium desconectado";
  const idleTitle = tela ? tela.status : refreshMomentTitle(!loaded ? undefined : watermark ? watermark.toISOString() : null);
  const title = ocupado ? busyLabel : disconnected ? disconnectTitle : idleTitle;
  const tooltip = `${title}\n${tip}`;

  const ariaLabel = ocupado
    ? busyLabel
    : !proprio && forceCooldownSec != null
      ? `Próxima atualização em ${formatForceCooldownLabel(forceCooldownSec)}`
      : tela
        ? tela.label
        : storeIds.length === 1
          ? "Atualizar as vendas de hoje da filial selecionada"
          : "Atualizar as vendas de hoje de todas as filiais";

  const bloqueado = ocupado || (!proprio && forceCooldownSec != null);
  const icone = (
    <>
      <RefreshIcon className={cn("shrink-0", ocupado && "animate-spin")} />
      {atrasado && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warn">
          <span className="sr-only">As vendas de hoje precisam ser atualizadas</span>
        </span>
      )}
    </>
  );
  const buttonClass =
    "relative flex h-9 w-9 items-center justify-center rounded-[10px] bg-acc text-white shadow-[0_10px_24px_-10px_var(--acc-soft)] hover:bg-acc-2 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-acc";

  // Celular / tablet (sem hover): o toque abre o horario da ultima busca + "Atualizar agora".
  if (semHover) {
    return (
      <Dropdown
        trigger={
          <button type="button" aria-label={ariaLabel} className={buttonClass}>
            {icone}
          </button>
        }
        header={
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold text-t0">{title}</span>
            <span className="text-[12px] font-normal text-t2">{tip}</span>
          </div>
        }
        items={[
          {
            label: ocupado ? "Atualizando…" : "Atualizar agora",
            icon: <RefreshIcon className={cn("shrink-0", ocupado && "animate-spin")} />,
            highlight: true,
            disabled: bloqueado,
            onClick: () => void clicar(),
          },
        ]}
        menuClassName="w-[280px]"
      />
    );
  }

  const button = (
    <button type="button" onClick={() => void clicar()} disabled={bloqueado} aria-label={ariaLabel} className={buttonClass}>
      {icone}
    </button>
  );

  if (!tooltip || ocupado) return button;
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
