import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui";
import { paths } from "@/router/paths";
import { AuthGlow } from "@/pages/auth/authKit";
import { requestPasswordReset } from "@/session/authApi";
import {
  CampoEmail,
  acessoBotao,
  acessoLink,
  acessoRodape,
  acessoSubtitulo,
  acessoTitulo,
  useFocoNoEnvioAposAutofill,
} from "./AccessKit";

function emailValido(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const mailIcon = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
  </svg>
);

/** Recuperacao de senha por OTP  -  tipografia unificada com o Login. */
export function Forgot() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const emailInicial = (location.state as { email?: string } | null)?.email ?? "";
  const [email, setEmail] = useState(emailInicial);
  const [carregando, setCarregando] = useState(false);
  const formRef = useFocoNoEnvioAposAutofill();

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!emailValido(email)) {
      show("Informe um e-mail válido.", "danger");
      return;
    }
    setCarregando(true);
    await requestPasswordReset(email);
    setCarregando(false);
    // Mesma tela de sucesso para qualquer e-mail (anti-enumeration); segue para digitar o OTP.
    navigate(paths.access.reset, {
      replace: true,
      state: { email: email.trim().toLowerCase() },
    });
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg-0 p-10">
      <AuthGlow />
      <div className="relative w-full max-w-[420px]">
        <div className="rounded-[22px] border border-line bg-bg-2 p-9 text-center" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,.6)" }}>
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[18px] bg-acc-soft">{mailIcon}</div>
          <h2 className={acessoTitulo}>Recupere sua senha</h2>
          <p className={acessoSubtitulo}>
            Informe seu e-mail para receber um código de verificação.
          </p>
          <form ref={formRef} onSubmit={enviar} className="text-left" noValidate>
            <CampoEmail label="E-mail" value={email} onChange={setEmail} autoFocus />
            <div className="mb-4 mt-3.5">
              <button
                type="submit"
                disabled={email.trim().length === 0 || carregando}
                className={acessoBotao}
              >
                {carregando ? "Enviando…" : "Enviar código"}
              </button>
            </div>
          </form>
          <p className={acessoRodape}>
            <Link to={paths.access.login} className={acessoLink}>
              Voltar ao login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
