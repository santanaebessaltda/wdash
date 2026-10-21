import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { padTopAndBottom } from "@/lib/safeArea";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Substitui o padding e a rolagem padrão do corpo. */
  bodyClassName?: string;
  /** O portal sai da tela. No placar, repete o tema claro ou escuro da tela. */
  boardTheme?: "light" | "dark";
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, children, footer, size = "md", bodyClassName, boardTheme }: ModalProps) {
  if (!open) return null;

  return createPortal(
    <div
      data-board-theme={boardTheme}
      className="pad-topo pad-base fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={padTopAndBottom("1rem", "1rem")}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-vela-fade" onClick={onClose} />
      <div
        className={cn(
          "relative flex max-h-full w-full flex-col overflow-hidden rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 shadow-[var(--shadow-vela)] animate-vela-pop sm:max-h-[90vh]",
          sizeClasses[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h3 className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-bold text-t0">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-t1 hover:bg-bg-3 hover:text-t0"
            >
              ✕
            </button>
          </div>
        )}
        <div className={cn("min-h-0 flex-1", bodyClassName ?? "overflow-y-auto p-5")}>{children}</div>
        {footer ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-line px-5 py-4",
              "[&_button]:!h-10 [&_button]:!min-w-[7.5rem] [&_button]:!rounded-[var(--radius-vela-md)] [&_button]:!px-4 [&_button]:!text-[13px]",
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
