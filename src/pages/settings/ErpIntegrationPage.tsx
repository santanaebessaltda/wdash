import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormField,
  Input,
  Modal,
  Skeleton,
  useToast,
} from "@/components/ui";
import { paths } from "@/router/paths";
import { useSession, useActiveSession } from "@/session/SessionProvider";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { markAwaitingInitialSync } from "@/session/awaitingInitialSync";
import {
  applyErpCredentialChange,
  cancelErpCredentialChange,
  erpChangeNeedsConfirm,
  fetchErpIntegrationStatus,
  prepareErpCredentialChange,
  refreshErpRegistry,
  releaseErpSession,
  type ErpCredentialChangeResult,
  type PreparedErpChange,
  type ErpIntegrationStatus,
  type ErpReportCheck,
} from "@/data/wedash/erp";
import { ErpReportChecks } from "@/components/wedash/ErpReportChecks";
import { noAutofill, secretStyle } from "@/lib/noAutofill";

type ErpLinkState = "disconnected" | "paused" | "connected" | "password";

function linkStateOf(info: ErpIntegrationStatus | null): ErpLinkState {
  if (!info || info.status === "NOT_CONFIGURED") return "disconnected";
  if (info.syncPaused) return "paused";
  if (info.status === "INVALID") return "password";
  return "connected";
}

const LINK_STATE_UI: Record<ErpLinkState, { label: string; cls: string; dot: string }> = {
  connected: { label: "Conectado", cls: "text-ok", dot: "bg-ok" },
  paused: { label: "Desconectado", cls: "text-t2", dot: "bg-t2" },
  password: { label: "Senha inválida", cls: "text-bad", dot: "bg-bad" },
  disconnected: { label: "Desconectado", cls: "text-t2", dot: "bg-t2" },
};

const ERROR_CREDENCIAL: Record<Extract<ErpCredentialChangeResult, { ok: false }>["reason"], string> = {
  password: "Usuário ou senha incorretos. Confira os dados e tente novamente.",
  busy: "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
  stores: "Conseguimos acessar o Millennium, mas não foi possível identificar as filiais deste usuário. Tente novamente.",
  no_stores: "Este usuário não possui filiais vinculadas no Millennium. Verifique os vínculos no Millennium e tente novamente.",
  other: "Não foi possível conectar ao Millennium. Tente novamente em alguns minutos.",
  persist: "A conexão foi testada, mas não foi possível salvá-la. Tente novamente.",
  reports: "Este usuário não tem acesso a todos os relatórios necessários para a WDash.",
};

/**
 * Configuracoes > Integracoes  -  card Millennium (padrao Integrations do Vela).
 * Desconectar libera o Millennium; logout WDash NAO faz isso.
 */
export function ErpIntegrationPage() {
  const session = useActiveSession();
  const [info, setInfo] = useState<ErpIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    const st = await fetchErpIntegrationStatus(session.tenantId);
    setInfo(st);
    setLoading(false);
  }, [session.tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { show } = useToast();
  const [atualizando, setAtualizando] = useState(false);
  const status = linkStateOf(info);
  const ui = LINK_STATE_UI[status];
  const canEdit = session.role === "OWNER" || session.role === "MANAGER";
  const canRefresh = status === "connected" && session.role === "OWNER";

  async function refreshRecords() {
    setAtualizando(true);
    const r = await refreshErpRegistry();
    setAtualizando(false);
    if (!r.ok) return show(r.message, "danger");
    show("Cadastros atualizados.", "success");
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <div className="mb-3.5 flex items-center gap-3">
            <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-bg-inset">
              <img src="/linx.png" alt="Linx" className="h-[26px] w-[26px] object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold text-t0">Millennium</p>
              <p className="mt-0.5 text-[11.5px] text-t2">ERP Linx · vendas, custos, lojas e equipe</p>
            </div>
          </div>
          {showSkeleton ? (
            <div className="flex items-center justify-between border-t border-line pt-3" aria-busy="true" aria-label="Carregando">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-8 w-24 rounded-[var(--radius-vela-sm)]" />
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className={`flex items-center gap-1.5 text-xs font-bold ${ui.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
                {ui.label}
              </span>
              {status === "connected" ? (
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                  Gerenciar
                </Button>
              ) : (
                <Button size="sm" onClick={() => setOpen(true)} disabled={!canEdit}>
                  Conectar
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>

      <MillenniumModal
        open={open}
        onClose={() => setOpen(false)}
        info={info}
        status={status}
        canEdit={canEdit}
        canRefresh={canRefresh}
        atualizando={atualizando}
        onRefresh={refreshRecords}
        onChanged={reload}
      />
    </>
  );
}

/**
 * Conectado  ->  credenciais so leitura + Desconectar (danger).
 * Nao conectado / desconectado / senha invalida  ->  formulario + Conectar
 * (mesmos checks do onboarding). Trocar senha/usuario = desconectar e conectar de novo.
 */
function MillenniumModal({
  open,
  onClose,
  info,
  status,
  canEdit,
  canRefresh,
  atualizando,
  onRefresh,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  info: ErpIntegrationStatus | null;
  status: ErpLinkState;
  canEdit: boolean;
  canRefresh: boolean;
  atualizando: boolean;
  onRefresh: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const session = useActiveSession();
  const { update } = useSession();
  const navigate = useNavigate();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dedicada, setDedicada] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [aceiteExchange, setAceiteExchange] = useState(false);
  const [relatorios, setRelatorios] = useState<ErpReportCheck[] | null>(null);
  /** Login ok, mas a troca remove lojas  -  aguardando confirmacao. */
  const [pending, setPending] = useState<PreparedErpChange | null>(null);
  useEffect(() => {
    if (!open) return;
    setRelatorios(null);
    setPending(null);
    setUsername(info?.username ?? "");
    setPassword("");
    setShowPassword(false);
    setDedicada(info?.dedicated ?? false);
    setAutorizo(false);
    setAceiteExchange(false);
  }, [open, info]);

  const conectado = status === "connected";
  const usernamePrevious = (info?.username ?? "").trim().toUpperCase();
  const usernameNew = username.trim().toUpperCase();
  const canConectar = canEdit && usernameNew.length > 0 && password.length > 0 && autorizo && !busy;

  function descartarPending() {
    if (!pending) return;
    void cancelErpCredentialChange(pending);
    setPending(null);
    setAceiteExchange(false);
  }

  function close() {
    if (busy) return;
    descartarPending();
    onClose();
  }

  async function desconectar() {
    setBusy(true);
    try {
      await releaseErpSession({ pauseSync: true });
      show("Millennium desconectado.", "success");
      await onChanged();
    } catch {
      show("Não foi possível desconectar. Tente novamente.", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function conectar() {
    if (!canConectar) return;
    setBusy(true);
    setRelatorios(null);
    const prep = await prepareErpCredentialChange({
      tenantId: session.tenantId,
      membershipId: session.membershipId,
      currentUsername: info?.username ?? null,
      username: username,
      password: password,
      dedicated: dedicada,
    });
    if (!prep.ok) {
      setBusy(false);
      if (prep.reason === "reports" && prep.reports) setRelatorios(prep.reports);
      show(ERROR_CREDENCIAL[prep.reason], "danger");
      return;
    }
    if (erpChangeNeedsConfirm(prep.change.plan)) {
      setBusy(false);
      setAceiteExchange(false);
      setPending(prep.change);
      return;
    }
    await apply(prep.change);
  }

  async function apply(change: PreparedErpChange) {
    setBusy(true);
    const r = await applyErpCredentialChange(change);
    setBusy(false);
    setPending(null);
    if (!r.ok) {
      show(ERROR_CREDENCIAL[r.reason], "danger");
      return;
    }
    if (change.plan.kind === "partial") update({ stores: r.storeIds });
    if (r.wiped) {
      // Dados apagados + SEED enfileirado: mesma tela de carga inicial do onboarding.
      markAwaitingInitialSync();
      update({ stores: r.storeIds });
      onClose();
      navigate(paths.syncing, { replace: true });
      return;
    }
    show("Millennium conectado.", "success");
    await onChanged();
    onClose();
  }

  const travado = conectado || busy || !canEdit;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Millennium"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          {canEdit &&
            (conectado ? (
              <Button variant="danger" onClick={() => void desconectar()} disabled={busy || atualizando}>
                {busy ? "Desconectando…" : "Desconectar"}
              </Button>
            ) : pending ? (
              <Button variant="danger" onClick={() => void apply(pending)} disabled={!aceiteExchange || busy}>
                {busy ? "Trocando…" : "Confirmar troca"}
              </Button>
            ) : (
              <Button onClick={() => void conectar()} disabled={!canConectar}>
                {busy ? "Testando conexão…" : "Conectar"}
              </Button>
            ))}
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {conectado ? (
          <p className="text-[13.5px] leading-relaxed text-t1">
            A WDash está conectada ao Millennium com o usuário{" "}
            <strong className="font-semibold text-t0">{usernamePrevious}</strong>. As sincronizações acontecem
            automaticamente enquanto a conexão estiver ativa.
          </p>
        ) : status === "password" ? (
          <Alert variant="danger" title="A senha do Millennium não é mais válida.">
            Conecte novamente com a senha atual para retomar a sincronização.
          </Alert>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-t1">
            Informe o usuário e a senha do Millennium que a WDash usará para sincronizar os dados. Antes de conectar,
            verificamos o acesso às lojas e aos relatórios necessários.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <FormField label="Usuário do Millennium" required>
            <Input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toUpperCase());
                descartarPending();
              }}
              placeholder="Ex.: ESSENCIA.INTEGRACAO"
              {...noAutofill}
              className="uppercase"
              disabled={travado}
            />
          </FormField>
          <FormField label="Senha do Millennium" required={!conectado}>
            <div className="relative">
              <Input
                type="text"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  descartarPending();
                }}
                placeholder={conectado ? "Senha já cadastrada" : "Digite a senha"}
                {...noAutofill}
                style={secretStyle(showPassword && !conectado)}
                disabled={travado}
                className={conectado ? undefined : "pr-12"}
              />
              {!conectado && (
                <button
                  type="button"
                  onClick={() => setShowPassword((m) => !m)}
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
              )}
            </div>
          </FormField>
        </div>
        {conectado ? (
          canRefresh && (
            <div className="text-[12.5px] leading-relaxed">
              <p className="font-semibold text-t0">Cadastros</p>
              <Button className="mt-2" size="sm" onClick={() => void onRefresh()} disabled={atualizando || busy}>
                {atualizando ? "Atualizando…" : "Atualizar cadastros"}
              </Button>
              <p className="mt-2 text-t2">Atualiza lojas e tabelas de custo do Millennium. Não busca vendas.</p>
            </div>
          )
        ) : (
          <>
            <Checkbox
              className="items-start"
              label={
                <span>
                  Este usuário será usado somente pela WDash
                  <span className="mt-0.5 block text-xs text-t2">
                    O Millennium permite apenas uma sessão por usuário. Use um usuário exclusivo para evitar interrupções
                    e permitir que a WDash se reconecte automaticamente se a sessão cair.
                  </span>
                </span>
              }
              checked={dedicada}
              onChange={(e) => setDedicada(e.target.checked)}
              disabled={travado}
            />
            <Checkbox
              label="Autorizo a WDash a usar este acesso para realizar a sincronização."
              checked={autorizo}
              onChange={(e) => setAutorizo(e.target.checked)}
              disabled={travado}
            />
          </>
        )}
        {pending && (pending.plan.kind === "partial" || pending.plan.kind === "full") && (
          <Alert
            variant="danger"
            title={
              pending.plan.kind === "partial"
                ? `${pending.username} não tem acesso a ${pending.plan.removed.length === 1 ? "1 filial" : `${pending.plan.removed.length} filiais`}`
                : `${pending.username} não tem acesso a nenhuma das filiais atuais`
            }
            footer={
              <>
                {pending.plan.kind === "partial" && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] font-semibold text-t0">
                    {pending.plan.removed.map((s) => (
                      <li key={s.storeId}>{s.name}</li>
                    ))}
                  </ul>
                )}
                <Checkbox
                  className="mt-3 items-start text-bad"
                  label={
                    pending.plan.kind === "partial"
                      ? `Entendo que essas filiais serão removidas e quero trocar para ${pending.username}.`
                      : `Entendo que os dados atuais serão removidos e quero trocar para ${pending.username}.`
                  }
                  checked={aceiteExchange}
                  onChange={(e) => setAceiteExchange(e.target.checked)}
                  disabled={busy}
                />
              </>
            }
          >
            {pending.plan.kind === "partial" ? (
              "As filiais abaixo deixarão de ser sincronizadas e serão removidas da WDash. As demais continuam normalmente."
            ) : (
              <>
                <span className="block">
                  A troca substituirá as filiais e os dados sincronizados atualmente na WDash. As filiais disponíveis para o
                  novo usuário serão cadastradas novamente e uma nova carga inicial será realizada.
                </span>
                <span className="mt-1.5 block">Configurações como fuso e horário das filiais voltarão ao padrão.</span>
              </>
            )}
          </Alert>
        )}
        {relatorios && !conectado && <ErpReportChecks reports={relatorios} username={usernameNew} />}
        {!canEdit && <p className="text-xs text-t2">Você não tem permissão para alterar esta integração.</p>}
      </div>
    </Modal>
  );
}

export default ErpIntegrationPage;
