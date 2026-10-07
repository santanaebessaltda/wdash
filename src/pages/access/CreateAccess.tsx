import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { WizardSteps, useToast } from "@/components/ui";
import { BrandMark } from "@/pages/auth/authKit";
import { CampoFoto, CampoSenha, CamposNome, ForcaSenha, acessoBotao, nomePessoaValido, type NomePessoa } from "@/pages/access/AccessKit";
import { ONBOARDING_STEPS } from "@/pages/onboarding/steps";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { SENHA_REGRA_TEXTO, senhaValida } from "@/lib/password";
import { padTopoEBase } from "@/lib/safeArea";
import { paths } from "@/router/paths";
import { destinationAfterAuth, createAccess } from "@/session/authApi";
import { useSession, useActiveSession } from "@/session/SessionProvider";

const bullets = [
  "Seu nome identifica você na WDash",
  "Sua senha pessoal substitui a senha temporária",
  "Depois, conecte o Millennium para adicionar suas lojas",
];

/**
 * Primeiro acesso com senha temporaria = "Crie seu acesso" (etapa 1 do onboarding):
 * nome, sobrenome (sempre em branco) e a nova senha.
 */
export function CreateAccess() {
  const session = useActiveSession();
  const { update, signOut } = useSession();
  const navigate = useNavigate();
  const { show } = useToast();

  const [nome, setNome] = useState<NomePessoa>({ nome: "", sobrenome: "" });
  const [foto, setFoto] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [carregando, setCarregando] = useState(false);

  const comOnboarding = session.onboardingStep !== null;
  const erroConfirma = confirma.length > 0 && confirma !== senha ? "As senhas não coincidem." : null;
  const pode = nomePessoaValido(nome) && senhaValida(senha) && confirma === senha && !carregando;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pode) return;
    setCarregando(true);
    const r = await createAccess({ firstName: nome.nome, lastName: nome.sobrenome, password: senha, photo: foto });
    setCarregando(false);
    if (!r.ok) {
      show(r.error, "danger");
      return;
    }
    const patch = { temporaryPassword: false, name: r.name, ...(r.avatarUrl ? { avatarUrl: r.avatarUrl } : {}) };
    update(patch);
    show("Acesso criado.", "success");
    navigate(destinationAfterAuth({ ...session, ...patch }), { replace: true });
  }

  return (
    <div className="grid min-h-screen w-full bg-bg-0 lg:grid-cols-2">
      <div
        className="pad-topo pad-base flex flex-col px-6 pb-10 sm:px-14 lg:overflow-y-auto"
        style={padTopoEBase("2.5rem", "2.5rem")}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark size={34} />
            <span className="text-[16px] font-extrabold text-t0">{PRODUCT_NAME}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              signOut();
              navigate(paths.access.login);
            }}
            className="min-h-11 min-w-11 px-2 text-xs font-semibold text-t2 hover:text-t0"
          >
            Sair
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-4">
          {comOnboarding && <WizardSteps steps={ONBOARDING_STEPS} current={1} />}

          <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-t0">Crie seu acesso</h1>
          <p className="mb-7 text-sm text-t2">Informe seu nome e crie a senha que você usará para acessar a WDash.</p>

          <form onSubmit={salvar} className="flex flex-col gap-3.5" noValidate>
            <CampoFoto nome={nome} foto={foto} onChange={setFoto} />
            <CamposNome valor={nome} onChange={(p) => setNome((n) => ({ ...n, ...p }))} autoFocus />
            {/* Escondido: gerenciador de senhas associa a senha nova a este login. */}
            <input type="email" name="username" autoComplete="username" value={session.email} readOnly tabIndex={-1} aria-hidden className="sr-only" />
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
              erro={erroConfirma}
            />
            <ForcaSenha senha={senha} />
            <button type="submit" disabled={!pode} className={`mt-1 ${acessoBotao}`} style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}>
              {carregando ? "Salvando…" : "Salvar e continuar"}
            </button>
          </form>
        </div>
      </div>

      <div
        className="relative hidden flex-col justify-center overflow-hidden p-12 lg:flex"
        style={{ background: "linear-gradient(150deg,#0f2d54,#1b1650 55%,#14103a)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(70% 60% at 25% 80%,rgba(86,168,255,.35),transparent 60%)" }}
        />
        <div className="relative">
          <h2 className="mb-6 text-[26px] font-extrabold leading-[1.3] tracking-tight text-white">
            Seu acesso à WDash
            <br />
            começa aqui.
          </h2>
          <p className="mb-6 max-w-[380px] text-[15px] leading-relaxed text-white/70">
            Informe seus dados e crie uma senha pessoal para substituir a senha temporária.
          </p>
          <div className="flex flex-col gap-4">
            {bullets.map((b) => (
              <div key={b} className="flex items-center gap-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px]" style={{ background: "rgba(255,255,255,.12)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="text-sm font-semibold text-white/90">{b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
