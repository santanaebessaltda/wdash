import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui";
import { paths } from "@/router/paths";
import { BrandMark } from "@/pages/auth/authKit";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { users } from "@/data/wedash/team";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loginWithEmail, MENSAGEM_LOGIN, destinationAfterAuth } from "@/session/authApi";
import { useSession } from "@/session/SessionProvider";
import { acessoBotao, CampoEmail, CampoSenha, Checkbox, useFocoNoEnvioAposAutofill } from "./AccessKit";

function emailValido(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Evita toast duplicado (React StrictMode remonta o effect). */
const avisosJaExibidos = new Set<string>();

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { session, ready, applySession, signIn } = useSession();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [carregando, setCarregando] = useState(false);
  const formRef = useFocoNoEnvioAposAutofill();

  const podeEnviar = email.trim().length > 0 && senha.length > 0 && !carregando;

  // Se a sessao voltou depois (race PWA) ou ja estava logado, nao fica na tela.
  useEffect(() => {
    if (!ready || !session) return;
    navigate(destinationAfterAuth(session), { replace: true });
  }, [ready, session, navigate]);

  useEffect(() => {
    const state = location.state as { aviso?: string; avisoId?: string; de?: string } | null;
    if (!state?.aviso) return;
    const id = state.avisoId ?? state.aviso;
    const de = state.de;
    // Limpa o state antes de qualquer coisa  -  o 2 run do StrictMode nao reprocessa.
    navigate(location.pathname, { replace: true, state: de ? { de } : {} });
    if (avisosJaExibidos.has(id)) return;
    avisosJaExibidos.add(id);
    show(state.aviso, "success");
  }, [location.state, location.pathname, navigate, show]);

  useEffect(() => {
    const como = new URLSearchParams(location.search).get("como");
    if (!como || isSupabaseConfigured()) return;
    const usuario = users.find((u) => u.membershipId === como);
    if (!usuario) return;
    const session = signIn(usuario);
    navigate(destinationAfterAuth(session), { replace: true });
  }, [location.search, signIn, navigate]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!podeEnviar) return;
    if (!emailValido(email)) {
      show("Informe um e-mail válido.", "danger");
      return;
    }
    setCarregando(true);
    const r = await loginWithEmail(email, senha);
    setCarregando(false);
    if (!r.ok) {
      show(`${r.error || MENSAGEM_LOGIN} Confira os dados e tente novamente.`, "danger");
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
        style={{ background: "linear-gradient(150deg,#14103a,#1b1650 45%,#0f2d54)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(70% 60% at 75% 15%,rgba(124,92,255,.4),transparent 60%)" }}
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

          <form ref={formRef} onSubmit={enviar} className="flex flex-col gap-3.5" noValidate>
            <CampoEmail label="E-mail" value={email} onChange={setEmail} autoFocus />
            <CampoSenha label="Senha" value={senha} onChange={setSenha} />

            <div className="flex items-center justify-between">
              <Checkbox label="Manter conectado" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
              <Link to={paths.access.forgot} className="text-xs font-semibold text-acc">
                Esqueci minha senha
              </Link>
            </div>

            <button
              type="submit"
              disabled={!podeEnviar || carregando}
              className={`mt-1 ${acessoBotao}`}
              style={{ boxShadow: "0 10px 24px -10px var(--acc)" }}
            >
              {carregando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
