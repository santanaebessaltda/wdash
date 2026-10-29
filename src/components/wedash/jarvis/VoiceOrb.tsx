import { cn } from "@/lib/cn";

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

/** Orbe CSS reativo — estados do modo voz (estilo Néctar / assistente). */
export function VoiceOrb({ state, className }: { state: VoiceOrbState; className?: string }) {
  return (
    <div
      className={cn("relative flex h-44 w-44 items-center justify-center", className)}
      role="img"
      aria-label={
        state === "listening"
          ? "Ouvindo"
          : state === "thinking"
            ? "Pensando"
            : state === "speaking"
              ? "Falando"
              : "JARVIS"
      }
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-acc/20 blur-2xl transition-opacity duration-500",
          state === "idle" ? "opacity-40" : "opacity-80",
          state === "speaking" || state === "listening" ? "animate-pulse" : null,
        )}
      />
      <span
        className={cn(
          "absolute h-36 w-36 rounded-full border border-acc/30 transition-transform duration-700",
          state === "listening" ? "scale-110 animate-[ping_2s_ease-out_infinite] border-acc/50" : "scale-100",
          state === "thinking" ? "animate-spin border-dashed border-acc/60 [animation-duration:3s]" : null,
        )}
      />
      <span
        className={cn(
          "relative h-28 w-28 rounded-full bg-gradient-to-br from-acc to-acc-2 shadow-[0_0_40px_-8px_var(--acc)] transition-transform duration-300",
          state === "speaking" ? "scale-105" : null,
          state === "listening" ? "scale-110" : null,
          state === "idle" ? "animate-[pulse_3s_ease-in-out_infinite]" : null,
        )}
      >
        <span className="absolute inset-[18%] rounded-full bg-white/25 blur-md" />
        <span className="absolute inset-[32%] rounded-full bg-white/40" />
      </span>
    </div>
  );
}
