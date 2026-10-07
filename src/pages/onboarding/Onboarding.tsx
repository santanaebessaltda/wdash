import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WizardSteps, useToast } from "@/components/ui";
import { BrandMark } from "@/pages/auth/authKit";
import { paths } from "@/router/paths";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { logoutErp, type StoreErp } from "@/data/wedash/erp";
import { requestTodaySync } from "@/data/wedash/initialSync";
import { padTopoEBase } from "@/lib/safeArea";
import { useSession, useActiveSession } from "@/session/SessionProvider";
import { saveOnboardingStep, persistErpCredentialAndStores } from "@/session/authApi";
import { Step2Credentials } from "./Step2Credentials";
import { ONBOARDING_STEPS } from "./steps";
import { gravarRascunho, limparRascunho, lerRascunho, lerSenhaErp, rascunhoVazio, type RascunhoOnboarding } from "./draft";

/** Etapa do ERP no indicador e em `membership.onboarding_step` (1 = Crie seu acesso, antes do /onboarding). */
const ETAPA_ERP = 2;

const bullets = ["Conexão testada antes de continuar", "Lojas adicionadas automaticamente", "Dados de acesso protegidos"];

/** Onboarding  -  shell RegisterSplit: form a esquerda, hero a direita. Unica etapa = Integracao ERP. */
export function Onboarding() {
  const session = useActiveSession();
  const { update, signOut } = useSession();
  const navigate = useNavigate();
  const { show } = useToast();
  const membershipId = session.membershipId;

  const [draft, setDraft] = useState<RascunhoOnboarding>(() => lerRascunho(membershipId) ?? rascunhoVazio());
  const [conectando, setConectando] = useState(false);

  useEffect(() => {
    gravarRascunho(membershipId, draft);
  }, [draft, membershipId]);

  // Legado (1 = antiga Empresa, 3 = antiga Lojas)  ->  ERP.
  useEffect(() => {
    if (session.onboardingStep === null || session.onboardingStep === ETAPA_ERP) return;
    update({ onboardingStep: ETAPA_ERP });
    void saveOnboardingStep(membershipId, ETAPA_ERP);
  }, [session.onboardingStep, update, membershipId]);

  /**
   * Grava credencial + todas as lojas do usuario (token do teste  -  worker reusa sem novo login),
   * pede as vendas de hoje e abre o board sem esperar: os numeros chegam sozinhos em segundos.
   */
  async function conectar(stores: StoreErp[], millenniumSession: string | undefined) {
    const password = lerSenhaErp(membershipId);
    if (!draft.erp.usuario.trim() || !password) {
      show("Informe novamente o usuário e a senha do Millennium.", "danger");
      return;
    }
    setConectando(true);
    const persisted = await persistErpCredentialAndStores({
      tenantId: session.tenantId,
      membershipId,
      username: draft.erp.usuario.trim(),
      password,
      dedicated: draft.erp.dedicada,
      stores,
      millenniumSession,
    });
    if (!persisted.ok) {
      console.warn("persistErpCredentialAndStores:", persisted.error);
      await logoutErp(millenniumSession);
      setConectando(false);
      show("A conexão foi testada, mas não foi possível salvá-la. Tente novamente.", "danger");
      return;
    }

    // Onboarding fecha no banco ANTES do pedido (o worker cancela jobs com onboarding aberto).
    await saveOnboardingStep(membershipId, null);
    await requestTodaySync();

    limparRascunho(membershipId);
    update({ onboardingStep: null, stores: persisted.storeIds });
    show("Millennium conectado.", "success");
    navigate(`${paths.overview}?periodo=hoje`, { replace: true });
  }

  function sairOnboarding() {
    limparRascunho(membershipId);
    signOut();
    navigate(paths.access.login);
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
            onClick={sairOnboarding}
            className="min-h-11 min-w-11 px-2 text-xs font-semibold text-t2 hover:text-t0"
          >
            Sair
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-4">
          <WizardSteps steps={ONBOARDING_STEPS} current={ETAPA_ERP} />
          <Step2Credentials
            membershipId={membershipId}
            inicial={draft.erp}
            onErpChange={(erp) => setDraft((d) => ({ ...d, erp }))}
            onConectar={(r) => void conectar(r.stores, r.session)}
            conectando={conectando}
          />
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
            Seus dados do Millennium
            <br />
            na WDash.
          </h2>
          <p className="mb-6 max-w-[380px] text-[15px] leading-relaxed text-white/70">
            A conexão mantém vendas, custos e cadastros atualizados automaticamente.
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
