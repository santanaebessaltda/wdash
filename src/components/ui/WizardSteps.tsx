import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

export type WizardStep = { num: number; label: string };

/** Indicador de etapas  -  tipografia identica ao Multi-Step Wizard do Vela. */
export function WizardSteps({ steps, current }: { steps: WizardStep[]; current: number }) {
  return (
    <div className="mb-8 flex items-center justify-center">
      {steps.map((s, i) => {
        const done = s.num < current;
        const active = s.num === current;
        return (
          <div key={s.num} className="flex items-center">
            <div className="flex min-w-[80px] flex-col items-center gap-2">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2 text-[13px] font-extrabold",
                  done && "border-acc bg-acc text-white",
                  active && "border-acc bg-acc-soft text-acc",
                  !done && !active && "border-line bg-bg-inset text-t2",
                )}
              >
                {done ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  s.num
                )}
              </div>
              <span className={cn("whitespace-nowrap text-[11.5px] font-semibold", active ? "text-t0" : "text-t2")}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("mb-5 h-0.5 w-10 sm:w-16", s.num < current ? "bg-acc" : "bg-line")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Titulo/subtitulo  -  mesmo markup do Multi-Step Wizard. */
export function WizardCardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h3 className="text-lg font-bold text-t0">{title}</h3>
      <p className="mt-1 mb-6 text-[13.5px] text-t2">{subtitle}</p>
    </>
  );
}

const iconPrev = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
);

const iconNext = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

/** Rodape Previous / Next  -  mesmos botoes do Multi-Step Wizard. */
export function WizardNav({
  onPrevious,
  onNext,
  previousLabel = "Voltar",
  nextLabel = "Continuar",
  previousDisabled,
  nextDisabled,
  hidePrevious,
  nextType = "button",
}: {
  onPrevious?: () => void;
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: ReactNode;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  hidePrevious?: boolean;
  nextType?: "button" | "submit";
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      {hidePrevious ? (
        <span />
      ) : (
        <Button variant="outline" onClick={onPrevious} disabled={previousDisabled} icon={iconPrev}>
          {previousLabel}
        </Button>
      )}
      <Button type={nextType} onClick={onNext} disabled={nextDisabled} iconRight={iconNext}>
        {nextLabel}
      </Button>
    </div>
  );
}
