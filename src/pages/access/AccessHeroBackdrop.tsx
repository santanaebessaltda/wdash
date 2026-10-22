import { cn } from "@/lib/cn";

/**
 * Fundo do painel de "Crie seu acesso".
 * O degradê fica no elemento e o brilho azul numa camada por cima, do mesmo jeito daquela tela.
 */
export function AccessHeroBackdrop({ className, drift = false }: { className?: string; drift?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 print:hidden", className)}
      style={{ background: "linear-gradient(150deg,#0f2d54,#1b1650 55%,#14103a)" }}
    >
      <div
        className={cn("absolute inset-0", drift && "board-glow-drift")}
        style={{ background: "radial-gradient(70% 60% at 25% 80%,rgba(86,168,255,.35),transparent 60%)" }}
      />
      {drift ? (
        <style>{`@keyframes board-glow-drift{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(1.5%,-1%,0)}}.board-glow-drift{animation:board-glow-drift 28s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.board-glow-drift{animation:none}}`}</style>
      ) : null}
    </div>
  );
}
