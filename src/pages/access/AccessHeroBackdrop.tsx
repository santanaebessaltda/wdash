import { cn } from "@/lib/cn";

/**
 * Fundo do painel de "Crie seu acesso".
 * O degradê fica no elemento e o brilho azul numa camada por cima, do mesmo jeito daquela tela.
 */
export function AccessHeroBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 print:hidden", className)}
      style={{ background: "linear-gradient(150deg,#0f2d54,#1b1650 55%,#14103a)" }}
    >
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(70% 60% at 25% 80%,rgba(86,168,255,.35),transparent 60%)" }}
      />
    </div>
  );
}
