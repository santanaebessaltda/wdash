import { Spinner, useToast } from "@/components/ui";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { paths } from "@/router/paths";
import { AuthGlow } from "@/pages/auth/authKit";
import {
  CampoSenha,
  ForcaSenha,
  acessoBotao,
  acessoLink,
  acessoRodape,
  acessoSubtitulo,
  acessoTitulo,
} from "./AccessKit";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  canResetPassword,
  limparRecovery,
  normalizeRecoveryOtp,
  readRecoveryEmail,
  RECOVERY_OTP_LENGTH,
  requestPasswordReset,
  updatePassword,
  verifyRecoveryOtp,
} from "@/session/authApi";
import { SENHA_REGRA_TEXTO, senhaValida } from "@/lib/password";
import { cn } from "@/lib/cn";

/** Caixinhas 1 caractere cada  -  quantidade = length do OTP. */
function OtpBoxes({
  length,
  value,
  onChange,
  disabled,
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  function setAt(index: number, char: string) {
    const next = chars.map((d, i) => (i === index ? char : d));
    const joined = normalizeRecoveryOtp(next.join(""));
    onChange(joined);
    if (char && index < length - 1) refs.current[index + 1]?.focus();
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (chars[i]) {
        setAt(i, "");
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        setAt(i - 1, "");
      }
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowRight" && i < length - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = normalizeRecoveryOtp(e.clipboardData.getData("text"));
    if (!pasted) return;
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, length - 1);
    refs.current[focusIdx]?.focus();
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label={`Código de ${length} dígitos`}>
      {chars.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // iOS/Android sugerem o codigo do e-mail/SMS no 1 campo (QuickType).
          // maxLength no 1 precisa caber o OTP inteiro  -  senao o autofill corta em 1 digito.
          autoComplete={i === 0 ? "one-time-code" : "off"}
          name={i === 0 ? "one-time-code" : undefined}
          autoFocus={i === 0}
          maxLength={i === 0 ? length : 1}
          disabled={disabled}
          value={d}
          aria-label={`Dígito ${i + 1}`}
          onChange={(e) => {
            const raw = normalizeRecoveryOtp(e.target.value);
            if (!raw) {
              setAt(i, "");
              return;
            }
            if (raw.length > 1) {
              onChange(raw);
              refs.current[Math.min(raw.length, length - 1)]?.focus();
              return;
            }
            setAt(i, raw);
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-12 w-11 rounded-xl border border-line bg-bg-1 text-center text-[18px] font-bold tabular-nums text-t0 outline-none transition",
            "focus:border-acc focus:ring-2 focus:ring-acc/25",
            "disabled:opacity-50",
          )}
        />
      ))}
    </div>
  );
}

type Step = "otp" | "password";

/** Alinha com o intervalo minimo do SMTP/Auth no Supabase (60s). */
const RESEND_COOLDOWN_SEC = 60;

/** Recovery: etapa OTP  ->  etapa nova senha. */
export function Reset() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const tokenDemoInvalido =
    token === "expired" ||
    token === "used" ||
    token === "invalid" ||
    token === "expirado" ||
    token === "usado" ||
    token === "invalido";

  const emailFromState = (location.state as { email?: string } | null)?.email;
  const [email] = useState(() => emailFromState || readRecoveryEmail() || "");
  const [step, setStep] = useState<Step>("otp");
  const [otp, setOtp] = useState("");
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  /** Segundos restantes ate poder reenviar (ja chega com codigo do /forgot). */
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SEC);
  const [pronto, setPronto] = useState(tokenDemoInvalido);

  const erroConfirma = confirma.length > 0 && confirma !== senha ? "As senhas não coincidem." : null;
  const otpOk = otp.length === RECOVERY_OTP_LENGTH && /^[A-Z0-9]+$/.test(otp);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const podeSenha = senhaValida(senha) && confirma === senha && !carregando;

  useEffect(() => {
    if (tokenDemoInvalido) return;
    let ativo = true;
    (async () => {
      const ok = await canResetPassword();
      // Link legado: ja tem sessao Auth e nao veio do fluxo OTP  ->  pula pro passo senha.
      if (ativo && ok && isSupabaseConfigured()) {
        const hasEmail = Boolean(emailFromState || readRecoveryEmail());
        if (!hasEmail) setStep("password");
      }
      if (ativo) setPronto(true);
    })();
    return () => {
      ativo = false;
    };
  }, [tokenDemoInvalido, emailFromState]);

  // Contagem regressiva do reenvio
  useEffect(() => {
    if (step !== "otp" || resendIn <= 0) return;
    const id = window.setInterval(() => {
      setResendIn((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [step, resendIn]);

  function voltarTrocarEmail() {
    limparRecovery();
    navigate(paths.access.forgot, { replace: true, state: { email } });
  }

  async function reenviarCodigo() {
    if (!emailOk || reenviando || resendIn > 0) return;
    setReenviando(true);
    await requestPasswordReset(email);
    setOtp("");
    setReenviando(false);
    setResendIn(RESEND_COOLDOWN_SEC);
    show("Se houver uma conta com esse e-mail, um novo código será enviado.", "success");
  }

  async function confirmarCodigo(e: FormEvent) {
    e.preventDefault();
    if (!otpOk || !emailOk || carregando) return;
    setCarregando(true);
    const r = await verifyRecoveryOtp(email, otp);
    setCarregando(false);
    if (!r.ok) {
      show(r.error, "danger");
      setOtp("");
      return;
    }
    setStep("password");
  }

  async function salvarSenha(e: FormEvent) {
    e.preventDefault();
    if (!podeSenha) return;
    setCarregando(true);
    const r = await updatePassword(senha);
    setCarregando(false);
    if (!r.ok) {
      show(r.error ?? "Não foi possível salvar sua senha. Tente novamente.", "danger");
      return;
    }
    navigate(paths.access.login, {
      replace: true,
      state: {
        aviso: "Senha alterada. Entre com a nova senha.",
        avisoId: `senha-${Date.now()}`,
      },
    });
  }

  if (tokenDemoInvalido) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg-0 p-10">
        <AuthGlow />
        <div className="relative w-full max-w-[420px]">
          <div className="rounded-[22px] border border-line bg-bg-2 p-9 text-center" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,.6)" }}>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[18px] bg-warn-soft">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <h2 className={acessoTitulo}>Código ou link inválido</h2>
            <p className={acessoSubtitulo}>Solicite um novo código para continuar.</p>
            <Link to={paths.access.forgot} className="block">
              <button type="button" className={acessoBotao}>
                Solicitar novo código
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!pronto) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg-0 p-10">
        <AuthGlow />
        <Spinner size={28} />
      </div>
    );
  }

  // Sem e-mail no fluxo OTP  ->  manda pedir de novo
  if (step === "otp" && !emailOk) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg-0 p-10">
        <AuthGlow />
        <div className="relative w-full max-w-[420px]">
          <div className="rounded-[22px] border border-line bg-bg-2 p-9 text-center" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,.6)" }}>
            <h2 className={acessoTitulo}>Informe seu e-mail</h2>
            <p className={acessoSubtitulo}>Comece pela recuperação de senha para receber um código de verificação.</p>
            <Link to={paths.access.forgot} className="mb-4 block">
              <button type="button" className={acessoBotao}>
                Recuperar senha
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg-0 p-10">
      <AuthGlow />
      <div className="relative w-full max-w-[420px]">
        <div className="rounded-[22px] border border-line bg-bg-2 p-9 text-center" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,.6)" }}>
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[18px] bg-ok-soft">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {step === "otp" ? (
                <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
              ) : (
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              )}
            </svg>
          </div>

          {step === "otp" ? (
            <>
              <h2 className={acessoTitulo}>Digite o código</h2>
              <p className={acessoSubtitulo}>
                Enviamos um código de {RECOVERY_OTP_LENGTH} dígitos para{" "}
                <span className="font-semibold text-t0">{email}</span>.{" "}
                <button type="button" onClick={voltarTrocarEmail} className={acessoLink}>
                  Trocar e-mail
                </button>
              </p>

              <form onSubmit={confirmarCodigo} className="flex flex-col gap-4" noValidate>
                <OtpBoxes length={RECOVERY_OTP_LENGTH} value={otp} onChange={setOtp} disabled={carregando} />
                <button type="submit" disabled={!otpOk || carregando} className={acessoBotao}>
                  {carregando ? "Verificando…" : "Continuar"}
                </button>
              </form>

              <p className={cn(acessoRodape, "mt-4")}>
                Não recebeu?{" "}
                <button
                  type="button"
                  onClick={() => void reenviarCodigo()}
                  disabled={reenviando || resendIn > 0}
                  className={cn(acessoLink, "disabled:opacity-50")}
                >
                  {reenviando
                    ? "Reenviando…"
                    : resendIn > 0
                      ? `Reenviar em ${resendIn}s`
                      : "Reenviar código"}
                </button>
              </p>
            </>
          ) : (
            <>
              <h2 className={acessoTitulo}>Crie uma nova senha</h2>
              <p className={acessoSubtitulo}>Escolha a senha que você usará para acessar a WDash.</p>

              <form onSubmit={salvarSenha} className="flex flex-col gap-3.5 text-left" noValidate>
                {/* Escondido: gerenciador de senhas associa a senha nova a este login. */}
                <input type="email" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden className="sr-only" />
                <CampoSenha
                  label="Nova senha"
                  value={senha}
                  onChange={setSenha}
                  placeholder={SENHA_REGRA_TEXTO}
                  autoComplete="new-password"
                  autoFocus
                />
                <CampoSenha
                  label="Confirme a nova senha"
                  value={confirma}
                  onChange={setConfirma}
                  placeholder="Digite novamente"
                  autoComplete="new-password"
                  erro={erroConfirma}
                />
                <ForcaSenha senha={senha} />
                <button type="submit" disabled={!podeSenha} className={acessoBotao}>
                  {carregando ? "Salvando…" : "Salvar senha"}
                </button>
              </form>
            </>
          )}

          <p className={cn(acessoRodape, "mt-4")}>
            <Link to={paths.access.login} className={acessoLink}>
              Voltar ao login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
