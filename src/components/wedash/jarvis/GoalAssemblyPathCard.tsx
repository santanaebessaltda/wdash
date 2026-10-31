import { Button } from "@/components/ui";
import type { GoalAssemblyPath } from "./goalDraft";

const OPTIONS: { path: GoalAssemblyPath; label: string; hint: string }[] = [
  {
    path: "copy",
    label: "Copiar anterior",
    hint: "Reutiliza níveis, grupos e premiação",
  },
  {
    path: "recommended",
    label: "Com recomendações",
    hint: "Propõe com base no histórico",
  },
  {
    path: "fresh",
    label: "Criar do zero",
    hint: "Você define com o JARVIS",
  },
];

/**
 * Escolha estruturada do caminho de montagem — tema Vela / rosa primário.
 * Só aparece quando path ainda está pendente.
 */
export function GoalAssemblyPathCard({
  hasPrior,
  priorLabel,
  busy,
  selected,
  onSelect,
}: {
  hasPrior: boolean;
  priorLabel?: string | null;
  busy?: boolean;
  selected?: GoalAssemblyPath | null;
  onSelect: (path: GoalAssemblyPath) => void;
}) {
  const opts = hasPrior ? OPTIONS : OPTIONS.filter((o) => o.path !== "copy");
  return (
    <div
      className="mt-1 w-full max-w-[85%] rounded-[14px] border border-line bg-bg-2 p-3 sm:max-w-[78%]"
      role="group"
      aria-label="Como montar a configuração da meta"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Como montar</p>
      <p className="mt-1 text-[12.5px] text-t1">
        Escolha um caminho. Nada é aplicado sem a sua autorização.
      </p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {opts.map((opt) => {
          const active = selected === opt.path;
          const label =
            opt.path === "copy" && priorLabel
              ? `Copiar ${priorLabel}`
              : opt.label;
          return (
            <Button
              key={opt.path}
              type="button"
              size="sm"
              variant={active ? "primary" : "outline"}
              fullWidth
              disabled={busy}
              aria-pressed={active}
              onClick={() => onSelect(opt.path)}
              className="h-auto min-h-8 justify-start py-2 text-left"
            >
              <span className="flex flex-col items-start gap-0.5">
                <span>{label}</span>
                <span className={active ? "text-[11px] font-medium text-white/80" : "text-[11px] font-medium text-t2"}>
                  {opt.hint}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
