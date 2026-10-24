import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
  /** Fundo em degradê com halo no canto, como o card de insight. A string é a cor do halo. */
  glass?: string;
}

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({ className, children, padding = "md", glass, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 shadow-[var(--shadow-vela)] print:break-inside-avoid",
        glass != null && "relative overflow-hidden bg-gradient-to-br from-bg-3 to-bg-2",
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {glass != null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 rounded-full"
          style={{ background: `radial-gradient(circle, ${glass}, transparent 70%)` }}
        />
      ) : null}
      {children}
    </div>
  );
}

/** Ícone do hero, o mesmo bloco do detalhe de meta e de desafio. */
export function CardHero({ children, tone = "acc", compact = false }: { children: ReactNode; tone?: "acc" | "info" | "warn" | "muted"; compact?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        compact ? "h-9 w-9 rounded-xl" : "h-12 w-12 rounded-2xl",
        tone === "info" && "bg-info-soft text-info",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "acc" && "bg-acc-soft text-acc",
        tone === "muted" && "bg-bg-3 text-t1",
      )}
    >
      {children}
    </span>
  );
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-[15px] font-bold text-t0", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardSubtitle({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-0.5 text-xs text-t1", className)} {...props}>
      {children}
    </p>
  );
}
