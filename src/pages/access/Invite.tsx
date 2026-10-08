import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { paths } from "@/router/paths";
import {
  AcessoPagina,
  CampoSenha,
  CamposNome,
  ForcaSenha,
  IconeCard,
  acessoLink,
  acessoSubtitulo,
  acessoTitulo,
  nomePessoaValido,
  type NomePessoa,
} from "./AccessKit";
import { Skeleton, Button, useToast } from "@/components/ui";
import { roleLabel, useSession } from "@/session/SessionProvider";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { SENHA_REGRA_TEXTO, senhaValida } from "@/lib/password";
import { destinationAfterAuth, mensagemErroSenhaAuth, sessionFromPersistedAuth } from "@/session/authApi";
import { acceptInvite, fetchInviteInfo, type InviteInfo } from "@/data/wedash/systemUsers";

type State =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "invalid"; detail?: string }
  | { kind: "active" }
  | { kind: "form"; info: InviteInfo };

/** O link do e-mail so vale 1 vez: StrictMode / remount nao podem verificar de novo. */
const opened = new Map<string, Promise<{ ok: true } | { ok: false; detail: string }>>();

/**
 * Abre a sessao do convite. `/invite/{token_hash}` (template com TokenHash)  ->  verifyOtp;
 * `/invite/link#access_token=...` (link padrao do Supabase)  ->  setSession.
 *
 * TokenHash so e verificado sob clique: preview de e-mail / antvirus que abre o URL
 * sem interacao nao pode gastar o convite.
 */
function openInviteSession(token: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  const cached = opened.get(token);
  if (cached) return cached;
  const run = (async () => {
    const sb = getSupabase();
    if (!sb) return { ok: false as const, detail: "missing_config" };
    if (token === "link") {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      window.history.replaceState(null, "", window.location.pathname);
      if (access_token && refresh_token) {
        const { error } = await sb.auth.setSession({ access_token, refresh_token });
        return error ? { ok: false as const, detail: error.message } : { ok: true as const };
      }
      // Sem token no link: pode ser a mesma aba voltando depois de ja ter aberto.
      const { data } = await sb.auth.getSession();
      return data.session ? { ok: true as const } : { ok: false as const, detail: "missing_session" };
    }
    const { error } = await sb.auth.verifyOtp({ type: "invite", token_hash: token });
    if (error) return { ok: false as const, detail: error.message || error.code || "otp_failed" };
    return { ok: true as const };
  })();
  opened.set(token, run);
  return run;
}

async function loadInviteForm(
  token: string,
): Promise<State> {
  const openedSession = await openInviteSession(token);
  if (!openedSession.ok) {
    return { kind: "invalid", detail: openedSession.detail };
  }
  const r = await fetchInviteInfo();
  if (r.ok) return { kind: "form", info: r.info };
  return { kind: r.code === "already_active" ? "active" : "invalid", detail: r.code };
}

export function Invite() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { applySession } = useSession();
  const { show } = useToast();
  // Link padrao do Supabase ja traz a sessao no hash: abre sozinho.
  // TokenHash do e-mail espera o clique (anti-prefetch).
  const [state, setState] = useState<State>(() => (token === "link" ? { kind: "loading" } : { kind: "ready" }));
  const [nome, setNome] = useState<NomePessoa>({ nome: "", sobrenome: "" });
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const showSkeleton = useMinSkeleton(state.kind === "loading");

  useEffect(() => {
    if (token !== "link") return;
    let ativo = true;
    (async () => {
      const next = await loadInviteForm(token);
      if (ativo) setState(next);
    })();
    return () => {
      ativo = false;
    };
  }, [token]);

  async function continuar() {
    if (!token || state.kind === "loading") return;
    if (!isSupabaseConfigured()) {
      setState({ kind: "invalid", detail: "missing_config" });
      return;
    }
    setState({ kind: "loading" });
    setState(await loadInviteForm(token));
  }

  if (showSkeleton || state.kind === "loading") {
    return (
      <AcessoPagina>
        <Skeleton className="mb-5 h-16 w-16 rounded-[18px]" />
        <Skeleton className="mb-3 h-7 w-2/3" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-6 h-4 w-5/6" />
        <Skeleton className="h-[46px] w-full rounded-xl" />
      </AcessoPagina>
    );
  }

  if (state.kind === "ready") {
    return (
      <AcessoPagina>
        <IconeCard tom="ok">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </IconeCard>
        <h1 className={acessoTitulo}>Crie seu acesso</h1>
        <p className={acessoSubtitulo}>Para proteger seu convite, confirme que é você antes de criar a senha.</p>
        <Button type="button" size="lg" fullWidth className="!h-[46px] font-bold" onClick={() => void continuar()}>
          Continuar
        </Button>
      </AcessoPagina>
    );
  }

  if (state.kind === "invalid" || state.kind === "active") {
    const active = state.kind === "active";
    const missingConfig = state.kind === "invalid" && state.detail === "missing_config";
    const incomplete = state.kind === "invalid" && state.detail === "not_found";
    return (
      <AcessoPagina>
        <IconeCard tom={active ? "ok" : "warn"}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {active ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01" />}
          </svg>
        </IconeCard>
        <h1 className={acessoTitulo}>
          {active
            ? "Seu acesso já está ativo"
            : missingConfig
              ? "Não foi possível abrir o convite"
              : incomplete
                ? "Este convite está incompleto"
                : "Este convite não é mais válido"}
        </h1>
        <p className={acessoSubtitulo}>
          {active
            ? "Entre com seu e-mail e a senha que você criou."
            : missingConfig
              ? "O site ainda não está conectado ao banco. Peça ao responsável para tentar de novo em alguns minutos."
              : incomplete
                ? "O e-mail abriu, mas o acesso ainda não foi criado na WDash. Peça um novo convite em Configurações > Usuários."
                : "O link expirou ou já foi usado. Peça um novo convite ao responsável pelo seu acesso."}
        </p>
        <Link to={paths.access.login} className={cn("block text-center", acessoLink)}>
          Ir para o login
        </Link>
      </AcessoPagina>
    );
  }

  const { info } = state;
  const erroConfirma = confirma.length > 0 && confirma !== senha ? "As senhas não coincidem." : null;
  const pode = nomePessoaValido(nome) && senhaValida(senha) && confirma === senha && !carregando;

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!pode) return;
    const sb = getSupabase();
    if (!sb) return;
    setCarregando(true);
    setErro(null);
    const { error } = await sb.auth.updateUser({ password: senha });
    if (error) {
      setErro(mensagemErroSenhaAuth(error));
      setCarregando(false);
      return;
    }
    const aceito = await acceptInvite({ firstName: nome.nome, lastName: nome.sobrenome });
    const session = aceito ? await sessionFromPersistedAuth() : null;
    if (!session) {
      setErro("Não foi possível ativar seu acesso. Tente novamente.");
      setCarregando(false);
      return;
    }
    applySession(session);
    show("Acesso criado.", "success");
    navigate(destinationAfterAuth(session), { replace: true });
  }

  return (
    <AcessoPagina>
      <IconeCard tom="ok">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </IconeCard>
      <h1 className={acessoTitulo}>Crie seu acesso</h1>
      <p className={acessoSubtitulo}>
        {info.kind === "franchisee" ? (
          <>
            Informe seu nome e crie uma senha para começar. Depois você conecta o Millennium e traz as lojas da sua
            franquia.
          </>
        ) : info.role === "SELLER" ? (
          <>
            Informe seu nome e crie uma senha para acessar a WDash como parte da equipe de vendas
            {info.storeName ? (
              <>
                {" "}
                da loja <span className="font-bold text-t0">{info.storeName}</span>
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            Informe seu nome e crie uma senha para acessar a WDash como {roleLabel[info.role].toLowerCase()}
            {info.companyName ? (
              <>
                {" "}
                da <span className="font-bold text-t0">{info.companyName}</span>
              </>
            ) : null}
            .
          </>
        )}
      </p>
      <form onSubmit={criar} className="flex flex-col gap-4" noValidate>
        <CamposNome valor={nome} onChange={(p) => setNome((n) => ({ ...n, ...p }))} autoFocus />
        {/* Escondido: gerenciador de senhas associa a senha nova a este login. */}
        <input type="email" name="username" autoComplete="username" value={info.email} readOnly tabIndex={-1} aria-hidden className="sr-only" />
        <CampoSenha
          label="Nova senha"
          value={senha}
          onChange={setSenha}
          placeholder={SENHA_REGRA_TEXTO}
          autoComplete="new-password"
        />
        <CampoSenha
          label="Confirme a nova senha"
          value={confirma}
          onChange={setConfirma}
          placeholder="Digite novamente"
          autoComplete="new-password"
          erro={erroConfirma ?? erro}
        />
        <ForcaSenha senha={senha} />
        <Button type="submit" size="lg" fullWidth className="!h-[46px] font-bold" disabled={!pode}>
          {carregando ? "Salvando…" : "Salvar e entrar"}
        </Button>
      </form>
    </AcessoPagina>
  );
}
