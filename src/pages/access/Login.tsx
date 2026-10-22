import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui";
import { paths } from "@/router/paths";
import { BrandMark } from "@/pages/auth/authKit";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { users } from "@/data/wedash/team";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loginWithEmail, MESSAGE_LOGIN, destinationAfterAuth } from "@/session/authApi";
import { useSession } from "@/session/SessionProvider";
import { accessButton, EmailField, PasswordField, Checkbox, useFocusSubmitAfterAutofill } from "./AccessKit";

function emailValid(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Evita toast duplicado (React StrictMode remonta o effect). */
const noticesAlreadyExibidos = new Set<string>();

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { session, ready, applySession, signIn } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [loading, setLoading] = useState(false);
  const formRef = useFocusSubmitAfterAutofill();

  const canSend = email.trim().length > 0 && password.length > 0 && !loading;

  // Se a sessao voltou depois (race PWA) ou ja estava logado, nao fica na tela.
  useEffect(() => {
    if (!ready || !session) return;
    navigate(destinationAfterAuth(session), { replace: true });
  }, [ready, session, navigate]);

  useEffect(() => {
    const state = location.state as { notice?: string; noticeId?: string; from?: string } | null;
    if (!state?.notice) return;
    const id = state.noticeId ?? state.notice;
    const from = state.from;
    // Limpa o state antes de qualquer coisa  -  o 2 run do StrictMode nao reprocessa.
    navigate(location.pathname, { replace: true, state: from ? { from } : {} });
    if (noticesAlreadyExibidos.has(id)) return;
    noticesAlreadyExibidos.add(id);
    show(state.notice, "success");
  }, [location.state, location.pathname, navigate, show]);

  useEffect(() => {
    const how = new URLSearchParams(location.search).get("como");
    if (!how || isSupabaseConfigured()) return;
    const username = users.find((u) => u.membershipId === how);
    if (!username) return;
    const session = signIn(username);
    navigate(destinationAfterAuth(session), { replace: true });
  }, [location.search, signIn, navigate]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    if (!emailValid(email)) {
      show("Informe um e-mail válido.", "danger");
      return;
    }
    setLoading(true);
    const r = await loginWithEmail(email, password);
    setLoading(false);
    if (!r.ok) {
      show(`${r.error || MESSAGE_LOGIN} Confira os dados e tente novamente.`, "danger");
      return;
    }
    applySession(r.session);
    navigate(destinationAfterAuth(r.session), { replace: true });
  }

  return (
    <div className="grid min-h-screen w-full bg-bg-0 lg:grid-cols-2">
      {/* Hero  -  layout LoginSplit */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "linear-gradient(165deg,#1b1640,#0c0e15 70%)" }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-[340px] w-[340px] rounded-full"
          style={{ background: "radial-gradient(circle,rgba(124,92,255,.35),transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-10 h-[300px] w-[300px] rounded-full"
          style={{ background: "radial-gradient(circle,rgba(86,168,255,.22),transparent 70%)" }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark size={38} light />
          <span className="text-[17px] font-extrabold text-white">{PRODUCT_NAME}</span>
        </div>
        <div className="relative">
          <h2 className="mb-3.5 text-[30px] font-extrabold leading-[1.25] tracking-tight text-white">
            Sua operação.
            <br />
            Mais clara em um só lugar.
          </h2>
          <p className="max-w-[400px] text-[15px] leading-relaxed text-white/70">
            Acompanhe resultados, metas e desempenho na WDash.
          </p>
        </div>
        <div className="relative flex gap-2">
          <span className="h-1 w-8 rounded-sm bg-white" />
          <span className="h-1 w-2.5 rounded-sm bg-white/40" />
          <span className="h-1 w-2.5 rounded-sm bg-white/40" />
        </div>
      </div>

      {/* Form  -  layout LoginSplit */}
      <div className="flex flex-col items-center justify-center px-6 py-12 sm:px-14">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <BrandMark size={34} />
          <span className="text-[16px] font-extrabold text-t0">{PRODUCT_NAME}</span>
        </div>

        <div className="w-full max-w-[380px]">
          <h1 className="mb-2 text-[26px] font-extrabold tracking-tight text-t0">Acesse a WDash</h1>
          <p className="mb-7 text-sm text-t1">Entre com seu e-mail e senha.</p>

          <form ref={formRef} onSubmit={send} className="flex flex-col gap-3.5" noValidate>
            <EmailField label="E-mail" value={email} onChange={setEmail} autoFocus />
            <PasswordField label="Senha" value={password} onChange={setPassword} />

            <div className="flex items-center justify-between">
              <Checkbox label="Manter conectado" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
              <Link to={paths.access.forgot} className="text-xs font-semibold text-acc">
                Esqueci minha senha
              </Link>
            </div>

            <button
              type="submit"
              disabled={!canSend || loading}
              className={`mt-1 ${accessButton}`}
              style={{ boxShadow: "0 10px 24px -10px var(--acc)" }}
            >
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
