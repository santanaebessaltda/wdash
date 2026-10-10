import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { AcessoPagina, AvisoCard, IconeCard, acessoTitulo } from "./AccessKit";
import { Button } from "@/components/ui";
import { useSession } from "@/session/SessionProvider";
import { homeForRole } from "@/session/RequireSession";
import { cn } from "@/lib/cn";
import { installPromptDisponivel, ouvirInstallPrompt, pedirInstalacao } from "@/push/installPrompt";

type Plataforma = "ios" | "android" | "desktop";

function detectarPlataforma(): Plataforma {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const passos: Record<Exclude<Plataforma, "desktop">, string[]> = {
  ios: [
    "Toque em Compartilhar, o ícone de um quadrado com uma seta para cima, na barra do Safari.",
    "Role a lista e toque em \"Adicionar à Tela de Início\".",
    "Confirme em \"Adicionar\". O ícone da WDash aparecerá junto aos outros apps.",
    "Abra a WDash pelo ícone e permita as notificações quando solicitado.",
  ],
  android: [
    "Toque em \"Instalar app\" quando o aviso aparecer ou abra o menu de três pontos do Chrome.",
    "Escolha \"Instalar aplicativo\" e confirme.",
    "Abra a WDash pelo ícone e permita as notificações quando solicitado.",
  ],
};

export function Install() {
  const navigate = useNavigate();
  const { session, update } = useSession();
  const detectada = useMemo(detectarPlataforma, []);
  const [plataforma, setPlataforma] = useState<Plataforma>(detectada);
  const [podeInstalar, setPodeInstalar] = useState(installPromptDisponivel);
  const [instalando, setInstalando] = useState(false);

  useEffect(() => ouvirInstallPrompt(() => setPodeInstalar(installPromptDisponivel())), []);

  const destino = session ? (session.onboardingStep !== null ? paths.onboarding : homeForRole(session.role)) : paths.access.login;

  async function instalar() {
    setInstalando(true);
    const aceitou = await pedirInstalacao();
    setInstalando(false);
    setPodeInstalar(installPromptDisponivel());
    if (aceitou) concluir(true);
  }

  function concluir(instalou: boolean) {
    if (session && instalou) update({ appInstalled: true });
    navigate(destino, { replace: true });
  }

  return (
    <AcessoPagina largura={460}>
      <IconeCard tom="acc">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M12 18h.01" />
        </svg>
      </IconeCard>
      <h1 className={acessoTitulo}>Instale o app no celular</h1>
      <p className="mb-5 text-sm leading-relaxed text-t1">
        {session?.role === "SELLER"
          ? "Instale o app para receber avisos quando avançar para um novo nível de premiação."
          : "Instale o app para receber no celular os avisos da WDash."}
      </p>

      <div className="mb-5 flex gap-1 rounded-[var(--radius-vela-md)] bg-bg-3 p-1">
        {(["ios", "android", "desktop"] as Plataforma[]).map((p) => (
          <button key={p} onClick={() => setPlataforma(p)} className={cn("flex-1 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors", plataforma === p ? "bg-bg-1 text-t0 shadow-[var(--shadow-vela)]" : "text-t1 hover:text-t0")}>
            {p === "ios" ? "iPhone" : p === "android" ? "Android" : "Computador"}
          </button>
        ))}
      </div>

      {podeInstalar && (
        <Button size="lg" fullWidth className="!mb-4 !h-[46px] font-bold" disabled={instalando} onClick={() => void instalar()}>
          {instalando ? "Abrindo a instalação…" : "Instalar app"}
        </Button>
      )}

      {plataforma === "desktop" ? (
        <div className="flex flex-col gap-3">
          {!podeInstalar && (
            <AvisoCard tom="info" titulo="Instalar neste computador">
              No Chrome e no Edge, o botão Instalar aparece aqui quando o navegador libera. No iPhone, a instalação continua pelos passos da aba iPhone.
            </AvisoCard>
          )}
          <Button size="lg" fullWidth variant="outline" className="!h-[46px] font-bold" onClick={() => concluir(false)}>Continuar no computador</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {plataforma === "ios" && (
            <AvisoCard tom="info" titulo="No iPhone, a instalação é manual">
              O Safari não oferece um botão para criar o atalho. Use os passos abaixo.
            </AvisoCard>
          )}
          {(plataforma === "ios" || !podeInstalar) && (
            <ol className="flex flex-col gap-3">
              {passos[plataforma].map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-acc-soft text-xs font-extrabold text-acc">{i + 1}</span>
                  <span className="text-sm leading-relaxed text-t0">{p}</span>
                </li>
              ))}
            </ol>
          )}
          {plataforma === "ios" && (
            <AvisoCard tom="warn" titulo="Notificações no iPhone">
              No iPhone, as notificações só funcionam com a WDash instalada pela Tela de Início.
            </AvisoCard>
          )}
          <Button size="lg" fullWidth className="!h-[46px] font-bold" onClick={() => concluir(true)}>Já instalei</Button>
          <Button size="lg" fullWidth variant="outline" className="!h-[46px] font-bold" onClick={() => concluir(false)}>Agora não</Button>
          <p className="text-center text-xs text-t2">Você pode abrir este guia novamente pelo menu.</p>
        </div>
      )}
    </AcessoPagina>
  );
}

