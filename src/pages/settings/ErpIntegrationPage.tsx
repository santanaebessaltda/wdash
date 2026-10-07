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
  Tooltip,
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

type Estado = "desconectado" | "pausado" | "conectado" | "senha";

function estadoDe(info: ErpIntegrationStatus | null): Estado {
  if (!info || info.status === "NOT_CONFIGURED") return "desconectado";
  if (info.syncPaused) return "pausado";
  if (info.status === "INVALID") return "senha";
  return "conectado";
}

const ESTADO_UI: Record<Estado, { label: string; cls: string; dot: string }> = {
  conectado: { label: "Conectado", cls: "text-ok", dot: "bg-ok" },
  pausado: { label: "Desconectado", cls: "text-t2", dot: "bg-t2" },
  senha: { label: "Senha inválida", cls: "text-bad", dot: "bg-bad" },
  desconectado: { label: "Não configurado", cls: "text-t2", dot: "bg-t2" },
};

const ERRO_CREDENCIAL: Record<Extract<ErpCredentialChangeResult, { ok: false }>["reason"], string> = {
  password: "Usuário ou senha incorretos. Confira os dados e tente novamente.",
  busy: "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
  stores: "Conseguimos acessar o Millennium, mas não foi possível identificar as lojas deste usuário. Tente novamente.",
  no_stores: "Este usuário não possui lojas vinculadas no Millennium. Verifique os vínculos no Millennium e tente novamente.",
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
  const [aberto, setAberto] = useState(false);

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
  const estado = estadoDe(info);
  const ui = ESTADO_UI[estado];
  const canEdit = session.role === "OWNER" || session.role === "MANAGER";
  const podeAtualizar = estado === "conectado" && session.role === "OWNER";

  async function atualizarCadastros() {
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
              {estado === "conectado" ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
                    Gerenciar
                  </Button>
                  {podeAtualizar && (
                    <Tooltip label="Atualiza lojas e tabelas de custo do Millennium. Não busca vendas.">
                      <Button size="sm" onClick={() => void atualizarCadastros()} disabled={atualizando}>
                        {atualizando ? "Atualizando…" : "Atualizar cadastros"}
                      </Button>
                    </Tooltip>
                  )}
                </div>
              ) : (
                <Button size="sm" onClick={() => setAberto(true)} disabled={!canEdit}>
                  Conectar
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>

      <MillenniumModal
        open={aberto}
        onClose={() => setAberto(false)}
        info={info}
        estado={estado}
        canEdit={canEdit}
        atualizando={atualizando}
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
  estado,
  canEdit,
  atualizando,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  info: ErpIntegrationStatus | null;
  estado: Estado;
  canEdit: boolean;
  atualizando: boolean;
  onChanged: () => Promise<void>;
}) {
  const session = useActiveSession();
  const { update } = useSession();
  const navigate = useNavigate();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [dedicada, setDedicada] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [aceiteTroca, setAceiteTroca] = useState(false);
  const [relatorios, setRelatorios] = useState<ErpReportCheck[] | null>(null);
  /** Login ok, mas a troca remove lojas  -  aguardando confirmacao. */
  const [pendente, setPendente] = useState<PreparedErpChange | null>(null);
  useEffect(() => {
    if (!open) return;
    setRelatorios(null);
    setPendente(null);
    setUsuario(info?.username ?? "");
    setSenha("");
    setMostrarSenha(false);
    setDedicada(info?.dedicated ?? false);
    setAutorizo(false);
    setAceiteTroca(false);
  }, [open, info]);

  const conectado = estado === "conectado";
  const usuarioAnterior = (info?.username ?? "").trim();
  const usuarioNovo = usuario.trim();
  const podeConectar = canEdit && usuarioNovo.length > 0 && senha.length > 0 && autorizo && !busy;

  function descartarPendente() {
    if (!pendente) return;
    void cancelErpCredentialChange(pendente);
    setPendente(null);
    setAceiteTroca(false);
  }

  function fechar() {
    if (busy) return;
    descartarPendente();
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
    if (!podeConectar) return;
    setBusy(true);
    setRelatorios(null);
    const prep = await prepareErpCredentialChange({
      tenantId: session.tenantId,
      membershipId: session.membershipId,
      currentUsername: info?.username ?? null,
      username: usuario,
      password: senha,
      dedicated: dedicada,
    });
    if (!prep.ok) {
      setBusy(false);
      if (prep.reason === "reports" && prep.reports) setRelatorios(prep.reports);
      show(ERRO_CREDENCIAL[prep.reason], "danger");
      return;
    }
    if (erpChangeNeedsConfirm(prep.change.plan)) {
      setBusy(false);
      setAceiteTroca(false);
      setPendente(prep.change);
      return;
    }
    await aplicar(prep.change);
  }

  async function aplicar(change: PreparedErpChange) {
    setBusy(true);
    const r = await applyErpCredentialChange(change);
    setBusy(false);
    setPendente(null);
    if (!r.ok) {
      show(ERRO_CREDENCIAL[r.reason], "danger");
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
      onClose={fechar}
      title="Millennium"
      footer={
        <>
          <Button variant="outline" onClick={fechar} disabled={busy}>
            Cancelar
          </Button>
          {canEdit &&
            (conectado ? (
              <Button variant="danger" onClick={() => void desconectar()} disabled={busy || atualizando}>
                {busy ? "Desconectando…" : "Desconectar"}
              </Button>
            ) : pendente ? (
              <Button variant="danger" onClick={() => void aplicar(pendente)} disabled={!aceiteTroca || busy}>
                {busy ? "Trocando…" : "Confirmar troca"}
              </Button>
            ) : (
              <Button onClick={() => void conectar()} disabled={!podeConectar}>
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
            <strong className="font-semibold text-t0">{usuarioAnterior}</strong>. As sincronizações acontecem
            automaticamente enquanto a conexão estiver ativa.
          </p>
        ) : estado === "senha" ? (
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
              value={usuario}
              onChange={(e) => {
                setUsuario(e.target.value);
                descartarPendente();
              }}
              placeholder="Ex.: ESSENCIA.INTEGRACAO"
              {...noAutofill}
              disabled={travado}
            />
          </FormField>
          <FormField label="Senha do Millennium" required>
            <div className="relative">
              <Input
                type="text"
                value={conectado ? "••••••••" : senha}
                onChange={(e) => {
                  setSenha(e.target.value);
                  descartarPendente();
                }}
                placeholder="Digite a senha"
                {...noAutofill}
                style={secretStyle(mostrarSenha && !conectado)}
                disabled={travado}
                className="pr-12"
              />
              {!conectado && (
                <button
                  type="button"
                  onClick={() => setMostrarSenha((m) => !m)}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  disabled={busy}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
                >
                  {mostrarSenha ? (
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
          <div className="space-y-3 text-[12.5px] leading-relaxed">
            <div>
              <p className="font-semibold text-t0">Alterar usuário ou senha</p>
              <p className="mt-0.5 text-t2">Para trocar o usuário ou a senha, desconecte e conecte novamente com os novos dados.</p>
            </div>
            <div>
              <p className="font-semibold text-t0">Desconexão</p>
              <p className="mt-0.5 text-t2">
                Ao desconectar, a WDash para de sincronizar os dados e encerra a sessão deste usuário no Millennium.
              </p>
            </div>
          </div>
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
        {pendente && (pendente.plan.kind === "partial" || pendente.plan.kind === "full") && (
          <Alert
            variant="danger"
            title={
              pendente.plan.kind === "partial"
                ? `${pendente.username} não tem acesso a ${pendente.plan.removed.length === 1 ? "1 loja" : `${pendente.plan.removed.length} lojas`}`
                : `${pendente.username} não tem acesso a nenhuma das lojas atuais`
            }
            footer={
              <>
                {pendente.plan.kind === "partial" && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] font-semibold text-t0">
                    {pendente.plan.removed.map((s) => (
                      <li key={s.storeId}>{s.name}</li>
                    ))}
                  </ul>
                )}
                <Checkbox
                  className="mt-3 items-start text-bad"
                  label={
                    pendente.plan.kind === "partial"
                      ? `Entendo que essas lojas serão removidas e quero trocar para ${pendente.username}.`
                      : `Entendo que os dados atuais serão removidos e quero trocar para ${pendente.username}.`
                  }
                  checked={aceiteTroca}
                  onChange={(e) => setAceiteTroca(e.target.checked)}
                  disabled={busy}
                />
              </>
            }
          >
            {pendente.plan.kind === "partial" ? (
              "As lojas abaixo deixarão de ser sincronizadas e serão removidas da WDash. As demais continuam normalmente."
            ) : (
              <>
                <span className="block">
                  A troca substituirá as lojas e os dados sincronizados atualmente na WDash. As lojas disponíveis para o
                  novo usuário serão cadastradas novamente e uma nova carga inicial será realizada.
                </span>
                <span className="mt-1.5 block">Configurações como fuso e horário das lojas voltarão ao padrão.</span>
              </>
            )}
          </Alert>
        )}
        {relatorios && !conectado && <ErpReportChecks reports={relatorios} username={usuarioNovo} />}
        {!canEdit && <p className="text-xs text-t2">Você não tem permissão para alterar esta integração.</p>}
      </div>
    </Modal>
  );
}

export default ErpIntegrationPage;
