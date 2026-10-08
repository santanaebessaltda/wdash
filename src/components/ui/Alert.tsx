import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type AlertVariant = "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<AlertVariant, { color: string; bg: string; icon: string }> = {
  success: { color: "var(--ok)", bg: "var(--ok-soft)", icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" },
  warning: {
    color: "var(--warn)",
    bg: "var(--warn-soft)",
    icon: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  },
  danger: { color: "var(--bad)", bg: "var(--bad-soft)", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6" },
  info: { color: "var(--info)", bg: "var(--info-soft)", icon: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
  accent: { color: "var(--acc)", bg: "var(--acc-soft)", icon: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
};

export interface AlertProps {
  variant?: AlertVariant;
  title?: ReactNode;
  /** Texto abaixo do titulo. */
  children?: ReactNode;
  /** Substitui o icone padrao da variante (ex.: Spinner, RadialProgress). */
  icon?: ReactNode;
  /** Acoes a direita (desktop) / abaixo do texto (celular). */
  action?: ReactNode;
  /** Conteudo extra em largura total abaixo do texto (ex.: lista expandida). */
  footer?: ReactNode;
  className?: string;
}

/** Alerta do Vela (Components > Alerts): fundo suave da cor, icone e titulo na cor, texto em t1. */
export function Alert({ variant = "info", title, children, icon, action, footer, className }: AlertProps) {
  const tone = TONES[variant];
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl px-4 py-3.5", className)}
      style={{ background: tone.bg }}
    >
      {icon ?? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={tone.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0"
        >
          <path d={tone.icon} />
        </svg>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            {title && (
              <p className="text-[13px] font-bold" style={{ color: tone.color }}>
                {title}
              </p>
            )}
            {children && <div className={cn("text-[12.5px] leading-relaxed text-t1", title && "mt-0.5")}>{children}</div>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div>}
        </div>
        {footer}
      </div>
    </div>
  );
}

/** Link de acao dentro do Alert. */
export function AlertLink({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "text-[12.5px] font-bold text-t0 underline-offset-2 hover:underline disabled:cursor-default disabled:text-t2 disabled:no-underline",
        className,
      )}
      {...rest}
    />
  );
}
