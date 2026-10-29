import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { paths } from "@/router/paths";
import { useSession } from "@/session/SessionProvider";
import { jarvisNavTargets } from "./navigateBrief";
import { useJarvis } from "./JarvisProvider";

/** Pill flutuante estilo Néctar — acompanha a voz fora do Chat IA. */
export function VoiceDock() {
  const j = useJarvis();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useSession();

  if (!j.voiceOpen || !j.allowed || typeof document === "undefined") return null;
  // No hub do Chat IA o composer já mostra OUVINDO… / waveform.
  if (location.pathname === paths.jarvis || location.pathname === paths.legacy.jarvis) return null;

  const routeLabel =
    (session
      ? jarvisNavTargets(session.role).find(
          (t) => location.pathname === t.to || location.pathname.startsWith(`${t.to}/`),
        )?.label
      : null) ?? "WDash";

  const lastJarvis = [...j.messages].reverse().find((m) => m.from === "jarvis")?.text ?? "";
  const status = j.voicePaused
    ? "ÁUDIO PAUSADO. TOQUE PARA RETOMAR"
    : j.mode === "listening"
      ? "OUVINDO…"
      : j.mode === "thinking"
        ? "PENSANDO…"
        : j.mode === "speaking"
          ? "FALANDO…"
          : "PRONTO";

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[85] flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))] print:hidden">
      <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-[22px] border border-line/70 bg-bg-2/95 px-3 py-2.5 shadow-[0_16px_48px_-18px_rgba(0,0,0,0.65)] backdrop-blur-md sm:gap-4 sm:px-4 sm:py-3">
        <button
          type="button"
          onClick={() => navigate(paths.jarvis)}
          className="relative h-11 w-11 shrink-0 rounded-full border border-acc/35 bg-bg-3/80"
          aria-label="Abrir Chat IA"
          title="Abrir Chat IA"
        >
          <span className="absolute inset-[5px] rounded-full border border-dashed border-acc/50 animate-[spin_14s_linear_infinite]" />
          <span className="absolute inset-[11px] rounded-full bg-acc/70 shadow-[0_0_12px_var(--acc)]" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.22em] text-acc">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  j.voicePaused ? "bg-warn" : "animate-pulse bg-acc",
                )}
              />
              {status}
            </span>
            <span className="rounded-full border border-line/70 px-2 py-0.5 text-[10px] font-medium text-t2">
              {routeLabel}
            </span>
          </div>
          {j.voicePaused ? (
            <button
              type="button"
              onClick={j.resumeVoice}
              className="mt-1.5 rounded-full border border-acc/50 px-3 py-1 text-[12px] font-semibold text-acc hover:bg-acc/10"
            >
              Retomar voz
            </button>
          ) : lastJarvis ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-t0">{lastJarvis}</p>
          ) : (
            <p className="mt-1 text-[12px] text-t2">Conversa por voz ativa</p>
          )}
        </div>

        <div className="hidden h-8 w-24 shrink-0 items-end justify-center gap-[2px] sm:flex">
          {j.voiceLevels.slice(0, 24).map((lvl, i) => (
            <span
              key={i}
              className="w-[2px] rounded-full bg-acc/80 transition-[height] duration-75"
              style={{
                height: `${Math.max(3, Math.round(3 + lvl * 22))}px`,
                opacity: j.mode === "listening" || j.mode === "speaking" ? 0.9 : 0.35,
              }}
            />
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => (j.voicePaused ? j.resumeVoice() : j.finishVoice())}
            disabled={!j.voicePaused && (j.mode === "thinking" || j.mode === "speaking")}
            aria-label={j.voicePaused ? "Retomar voz" : "Enviar agora"}
            title={j.voicePaused ? "Retomar voz" : "Enviar / ouvir"}
            className="flex h-9 w-9 items-center justify-center rounded-full text-t1 hover:bg-bg-3 hover:text-acc disabled:opacity-40"
          >
            <MicIcon />
          </button>
          <button
            type="button"
            onClick={j.closeVoice}
            aria-label="Encerrar voz"
            title="Encerrar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-t2 hover:bg-bg-3 hover:text-t0"
          >
            <PowerIcon />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2v10M6.3 6.3a8 8 0 1 0 11.4 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
