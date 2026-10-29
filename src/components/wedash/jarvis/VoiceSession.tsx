import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { useJarvis } from "./JarvisProvider";
import { VoiceOrb } from "./VoiceOrb";

/** Overlay de conversa por voz — escuta ao vivo e envia sozinho ao silenciar. */
export function VoiceSession() {
  const { voiceOpen, closeVoice, finishVoice, mode, draftText, micHint } = useJarvis();
  if (!voiceOpen || typeof document === "undefined") return null;

  const status =
    mode === "listening"
      ? "Tô te ouvindo…"
      : mode === "thinking"
        ? "Entendendo…"
        : mode === "speaking"
          ? "Falando…"
          : "Pode falar";

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-bg-0/92 backdrop-blur-md print:hidden">
      <button
        type="button"
        onClick={closeVoice}
        className="absolute right-5 top-5 rounded-[10px] border border-line bg-bg-2 px-3 py-1.5 text-[13px] font-semibold text-t1 hover:bg-bg-3 hover:text-t0"
      >
        Fechar
      </button>
      <button
        type="button"
        onClick={() => {
          if (mode === "listening") finishVoice();
          else if (mode === "idle") finishVoice();
        }}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        aria-label={mode === "listening" ? "Enviar o que falei" : "Começar a falar"}
      >
        <VoiceOrb
          state={
            mode === "listening"
              ? "listening"
              : mode === "thinking"
                ? "thinking"
                : mode === "speaking"
                  ? "speaking"
                  : "idle"
          }
        />
      </button>
      <p className="mt-6 text-[15px] font-semibold text-t0">{status}</p>
      {draftText ? (
        <p className="mt-2 max-w-md px-6 text-center text-[13px] text-t2">“{draftText}”</p>
      ) : null}
      {micHint ? (
        <p className="mt-3 max-w-md px-6 text-center text-[12px] leading-snug text-warn">{micHint}</p>
      ) : null}
      <div className="mt-8 flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => finishVoice()}
          disabled={mode === "thinking" || mode === "speaking"}
        >
          {mode === "listening" ? "Enviar agora" : "Falar"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={closeVoice}>
          Voltar ao chat
        </Button>
      </div>
      <p className="mt-10 max-w-sm px-6 text-center text-[11px] text-t2">
        Na primeira vez, toque em Falar e aceite o microfone no popup do Chrome. Depois fala e para — eu envio sozinho.
      </p>
    </div>,
    document.body,
  );
}
