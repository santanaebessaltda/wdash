import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Tooltip,
  Checkbox,
  FormField,
  Input,
  Modal,
  ProgressBar,
  RadialProgress,
  Spinner,
  useToast,
} from "@/components/ui";
import { ConnectionCard, ConnectionSkeleton } from "@/components/wedash/ConnectionList";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import { ErpReportChecks } from "@/components/wedash/ErpReportChecks";
import { calendarTodayIso } from "@/data/wedash/clock";
import {
  connectErpAccount,
  fetchErpAccounts,
  refreshErpRegistry,
  releaseErpSession,
  type ErpAccount,
  type ErpReportCheck,
} from "@/data/wedash/erp";
import { fetchErpAccountSync, type AccountSyncView } from "@/data/wedash/erpAccountSync";
import { requestTodaySync } from "@/data/wedash/initialSync";
import { fetchSeedDaysByStore, monthFillProgress } from "@/data/wedash/salesRepo";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useSession, useActiveSession } from "@/session/SessionProvider";

function accountStatus(account: ErpAccount): string {
  if (account.syncPaused) return "Desconectado";
  if (account.status === "INVALID") return "Senha inválida";
  if (account.status === "VALID") return "Conectado";
  return "Desconectado";
}

function filialLabel(count: number): string {
  if (count === 1) return "1 filial";
  return `${count} filiais`;
}

const ERROR_CREDENCIAL: Record<string, string> = {
  password: "Usuário ou senha incorretos. Confira os dados e tente novamente.",
  busy: "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
  stores: "O acesso ao Millennium foi confirmado, mas não foi possível identificar as filiais deste usuário. Tente novamente.",
  no_stores: "Este usuário não possui filiais vinculadas no Millennium. Verifique os vínculos no Millennium e tente novamente.",
  no_new_stores: "Todas as filiais deste usuário já estão vinculadas a outro acesso do Millennium. Nada foi alterado.",
  other: "Não foi possível conectar ao Millennium. Tente novamente em alguns minutos.",
  persist: "A conexão foi testada, mas não foi possível salvá-la. Tente novamente.",
  reports: "Este usuário não tem acesso a todos os relatórios necessários no Millennium.",
};

/**
 * Conta > ERP. Vários usuários Millennium, no formato da lista de Adquirentes.
 * Cada filial fica em uma conta. Conectar um usuário novo só enfileira as filiais novas.
 */
export function ErpIntegrationPage() {
  const session = useActiveSession();
  const { update } = useSession();
  const { show } = useToast();
  const [accounts, setAccounts] = useState<ErpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pending, setPending] = useState<ErpAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [syncLoaded, setSyncLoaded] = useState(false);
  const [syncByAccount, setSyncByAccount] = useState<Map<string, AccountSyncView>>(new Map());
  const [seededAccounts, setSeededAccounts] = useState<Set<string>>(new Set());
  const [readyStores, setReadyStores] = useState<Set<string>>(new Set());
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const canEdit = session.role === "OWNER" || session.role === "MANAGER";
  const canRefresh = accounts.some((account) => account.status === "VALID" && !account.syncPaused) && session.role === "OWNER";
  const syncing = [...syncByAccount.values()].some((view) => view.seed != null || view.fill != null);

  const reload = useCallback(async () => {
    const rows = await fetchErpAccounts(session.tenantId);
    if (rows) setAccounts(rows);
    else show("Não foi possível carregar os acessos do Millennium. Tente novamente.", "danger");
    setLoading(false);
  }, [session.tenantId, show]);

  const refreshSync = useCallback(async () => {
    const today = calendarTodayIso();
    const [state, days] = await Promise.all([
      fetchErpAccountSync(session.tenantId),
      fetchSeedDaysByStore(session.tenantId, today, today),
    ]);
    if (!state) return;
    setSyncByAccount(state.views);
    setSeededAccounts(state.seeded);
    setSyncLoaded(true);
    const ready = new Set<string>();
    for (const [storeId, covered] of days) {
      if (covered.size > 0) ready.add(storeId);
    }
    setReadyStores(ready);
  }, [session.tenantId]);

  useEffect(() => {
    void reload();
    void refreshSync();
  }, [reload, refreshSync]);

  useEffect(() => {
    if (!syncing) return;
    const id = window.setInterval(() => void refreshSync(), 3_000);
    return () => window.clearInterval(id);
  }, [syncing, refreshSync]);

  async function disconnect() {
    if (!pending) return;
    setDisconnecting(true);
    try {
      await releaseErpSession({ pauseSync: true, credentialId: pending.id });
      await reload();
      show("Millennium desconectado.", "success");
      setPending(null);
    } catch {
      show("Não foi possível desconectar. Tente novamente.", "danger");
    } finally {
      setDisconnecting(false);
    }
  }

  async function retrySync(account: ErpAccount) {
    setRetryingId(account.id);
    const ok = await requestTodaySync(account.storeIds);
    setRetryingId(null);
    if (!ok) {
      show("Não foi possível iniciar a sincronização. Tente novamente.", "danger");
      return;
    }
    await refreshSync();
  }

  async function refreshRecords() {
    setAtualizando(true);
    const r = await refreshErpRegistry();
    setAtualizando(false);
    if (!r.ok) return show(r.message, "danger");
    show("Cadastros atualizados.", "success");
  }

  return (
    <div>
      {showSkeleton ? (
        <ConnectionSkeleton label="Carregando acessos do Millennium…" />
      ) : accounts.length === 0 ? (
        <Card className="flex min-h-[280px] flex-col">
          <EmptyBlock
            icon="🗄️"
            title="Nenhum acesso do Millennium conectado"
            description="Conecte um acesso do Millennium para sincronizar vendas, produtos e cadastros."
            action={
              <Button size="sm" onClick={() => setConnectOpen(true)} disabled={!canEdit}>
                Conectar acesso
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            {canRefresh ? (
              <Tooltip label="Busca no Millennium as atualizações de produtos, equipe e outros cadastros." side="bottom">
                <Button variant="outline" size="sm" onClick={() => void refreshRecords()} disabled={atualizando}>
                  {atualizando ? "Atualizando…" : "Atualizar cadastros"}
                </Button>
              </Tooltip>
            ) : null}
            <Button size="sm" onClick={() => setConnectOpen(true)} disabled={!canEdit}>
              Conectar acesso
            </Button>
          </div>
          <ConnectionCard
            title="Millennium"
            hint="Cada acesso pode atender uma ou mais filiais. Filiais já vinculadas a outro acesso não são transferidas."
            rows={accounts.map((account) => ({
              key: account.id,
              name: account.username,
              detail: filialLabel(account.storeCount),
              status: accountStatus(account),
              mark: <img src="/linx.png" alt="" className="h-[22px] w-[22px] object-contain" />,
              onDisconnect: () => setPending(account),
              extra: (
                <AccountLoad
                  account={account}
                  view={syncByAccount.get(account.id) ?? null}
                  pendingStart={syncLoaded && !seededAccounts.has(account.id)}
                  readyStores={readyStores}
                  retrying={retryingId === account.id}
                  onRetry={() => void retrySync(account)}
                />
              ),
            }))}
          />
        </>
      )}

      <ConnectModal
        open={connectOpen}
        canEdit={canEdit}
        onClose={() => setConnectOpen(false)}
        onConnected={async (result) => {
          if (result.storeIds.length > 0) update({ stores: result.storeIds });
          await reload();
          await refreshSync();
          window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
          const skipped = result.skipped.map((store) => store.name);
          if (result.added === 0 && skipped.length === 0) {
            show("Millennium conectado.", "success");
          } else if (skipped.length > 0) {
            show(
              `Millennium conectado. ${skipped.length === 1 ? "1 filial já estava vinculada a outro acesso e não foi transferida" : `${skipped.length} filiais já estavam vinculadas a outro acesso e não foram transferidas`}.`,
              "success",
            );
          } else if (!result.queued) {
            show("Millennium conectado, mas a sincronização das vendas não foi iniciada. Tente novamente nesta tela.", "warning");
          } else {
            show("Millennium conectado. A sincronização das vendas está na fila.", "success");
          }
          setConnectOpen(false);
        }}
      />

      <Modal
        open={pending != null}
        onClose={() => {
          if (!disconnecting) setPending(null);
        }}
        title="Desconectar acesso do Millennium"
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)} disabled={disconnecting}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void disconnect()} disabled={disconnecting}>
              {disconnecting ? "Desconectando…" : "Desconectar"}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-t1">
          O acesso <strong className="font-semibold text-t0">{pending?.username}</strong> deixará de sincronizar com o
          Millennium. As vendas já salvas serão mantidas e os outros acessos não serão afetados.
        </p>
      </Modal>
    </div>
  );
}

const IDLE_SYNC: AccountSyncView = { seed: null, busy: false, fill: null };

/** Filiais da conta e o mesmo andamento do pós-onboarding (hoje + histórico). */
function AccountLoad({
  account,
  view,
  pendingStart,
  readyStores,
  retrying,
  onRetry,
}: {
  account: ErpAccount;
  view: AccountSyncView | null;
  pendingStart: boolean;
  readyStores: Set<string>;
  retrying: boolean;
  onRetry: () => void;
}) {
  const sync = view ?? IDLE_SYNC;
  const seed = sync.seed;
  const trackingToday = seed === "running" || seed === "queued" || seed === "waiting" || seed === "stuck";
  const readyCount = account.stores.filter((store) => readyStores.has(store.id)).length;
  const progressPct =
    account.stores.length === 0 ? 0 : Math.min(99, Math.round((readyCount / account.stores.length) * 100));
  const fill = sync.fill;
  const fillProgress = fill ? monthFillProgress(fill, calendarTodayIso()) : null;
  const fillPct = fillProgress ? Math.round((fillProgress.done / fillProgress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      {seed === "running" || seed === "queued" || seed === "waiting" ? (
        <Alert
          variant="accent"
          title={seed === "running" ? "Buscando vendas de hoje" : "Sincronização na fila"}
          icon={
            <span className="mt-0.5 shrink-0">
              <Spinner size={18} />
            </span>
          }
        >
          {seed === "running"
            ? "As vendas aparecem automaticamente quando a sincronização terminar."
            : seed === "waiting"
              ? "Há outra sincronização em andamento. Estas filiais começam assim que ela terminar."
              : "A busca das vendas de hoje começa em instantes."}
        </Alert>
      ) : null}
      {seed === "stuck" ? (
        <Alert variant="warning" title="A sincronização está demorando mais que o normal">
          A busca das vendas de hoje ainda não começou. Se o problema continuar, fale com o suporte.
        </Alert>
      ) : null}
      {seed === "failed" ? (
        <Alert
          variant="danger"
          title="Não foi possível buscar as vendas de hoje"
          action={
            <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
              {retrying ? "Tentando…" : "Tentar novamente"}
            </Button>
          }
        >
          {sync.busy
            ? "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente."
            : "Tente novamente em instantes."}
        </Alert>
      ) : null}
      {pendingStart && seed == null && !fill && account.stores.length > 0 ? (
        <Alert
          variant="warning"
          title="A sincronização ainda não começou"
          action={
            <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
              {retrying ? "Tentando…" : "Tentar novamente"}
            </Button>
          }
        >
          O acesso está conectado, mas a busca das vendas de hoje não foi iniciada.
        </Alert>
      ) : null}
      {fill ? (
        <Alert
          variant="accent"
          className="items-center"
          icon={
            <span className="shrink-0">
              <RadialProgress value={fillPct} size={44} stroke={4} color="var(--acc)" />
            </span>
          }
          title={
            <>
              Carregando histórico de vendas · <span className="tabular-nums">{fillPct}%</span>
            </>
          }
        >
          As vendas dos dias anteriores serão adicionadas automaticamente. Você pode continuar usando a WDash.
        </Alert>
      ) : null}
      {seed === "running" && account.stores.length > 0 ? (
        <ProgressBar value={progressPct} color="var(--acc)" label="Vendas de hoje" />
      ) : null}
      {account.stores.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {account.stores.map((store) => {
            const done = trackingToday && readyStores.has(store.id);
            const running = trackingToday && !done && seed === "running";
            return (
              <StoreDivisionTitle
                key={store.id}
                className="inline-flex items-center gap-1.5"
                title={done ? "Concluído" : running ? "Buscando vendas de hoje" : trackingToday ? "Na fila" : undefined}
              >
                {store.name}
                {running ? <Spinner size={12} /> : null}
              </StoreDivisionTitle>
            );
          })}
        </div>
      ) : (
        <p className="text-[12.5px] text-t2">Nenhuma filial vinculada a este acesso.</p>
      )}
    </div>
  );
}

function ConnectModal({
  open,
  canEdit,
  onClose,
  onConnected,
}: {
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  onConnected: (result: { added: number; skipped: { storeId: number; name: string }[]; storeIds: string[]; queued: boolean }) => Promise<void>;
}) {
  const session = useActiveSession();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dedicada, setDedicada] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [relatorios, setRelatorios] = useState<ErpReportCheck[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setDedicada(false);
    setAutorizo(false);
    setRelatorios(null);
  }, [open]);

  const usernameNew = username.trim().toUpperCase();
  const canConectar = canEdit && usernameNew.length > 0 && password.length > 0 && autorizo && !busy;

  function close() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
    if (!canConectar) return;
    setBusy(true);
    setRelatorios(null);
    const result = await connectErpAccount({
      tenantId: session.tenantId,
      membershipId: session.membershipId,
      username,
      password,
      dedicated: dedicada,
    });
    if (!result.ok) {
      setBusy(false);
      if (result.reason === "reports" && result.reports) setRelatorios(result.reports);
      show(ERROR_CREDENCIAL[result.reason] ?? ERROR_CREDENCIAL.other!, "danger");
      return;
    }
    setBusy(false);
    await onConnected(result);
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Conectar acesso do Millennium"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          {canEdit ? (
            <Button onClick={() => void conectar()} disabled={!canConectar}>
              {busy ? "Conectando…" : "Conectar"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[13.5px] leading-relaxed text-t1">
          Informe o usuário e a senha do Millennium. A WDash verificará o acesso às filiais e aos dados necessários para a
          sincronização. Filiais já vinculadas a outro acesso não serão transferidas.
        </p>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <FormField label="Usuário do Millennium" required>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toUpperCase())}
              placeholder="Ex.: USUARIO.INTEGRACAO"
              {...noAutofill}
              className="uppercase"
              disabled={busy || !canEdit}
            />
          </FormField>
          <FormField label="Senha do Millennium" required>
            <div className="relative">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite a senha"
                {...noAutofill}
                style={secretStyle(showPassword)}
                disabled={busy || !canEdit}
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                disabled={busy}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
              >
                {showPassword ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </FormField>
        </div>
        <Checkbox
          className="items-start"
          label={
            <span>
              Este acesso será usado somente pela WDash
              <span className="mt-0.5 block text-xs text-t2">
                O Millennium permite apenas uma sessão por usuário. Recomendamos um acesso exclusivo para evitar
                interrupções na sincronização.
              </span>
            </span>
          }
          checked={dedicada}
          onChange={(e) => setDedicada(e.target.checked)}
          disabled={busy || !canEdit}
        />
        <Checkbox
          label="Autorizo a WDash a usar este acesso para sincronizar dados com o Millennium."
          checked={autorizo}
          onChange={(e) => setAutorizo(e.target.checked)}
          disabled={busy || !canEdit}
        />
        {relatorios ? <ErpReportChecks reports={relatorios} username={usernameNew} /> : null}
        {!canEdit ? <p className="text-xs text-t2">Você não tem permissão para alterar esta integração.</p> : null}
      </div>
    </Modal>
  );
}

export default ErpIntegrationPage;
