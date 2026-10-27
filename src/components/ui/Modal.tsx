import { useLayoutEffect, useState, type ReactNode } from "react";
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
  /** Quando muda (ex.: etapa do wizard), o corpo volta ao topo — evita content “sumido” no mobile. */
  scrollKey?: string | number;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/** Largura do tamanho escolhido. A tabela que passa disso alarga o modal. */
const sizePx = { sm: 384, md: 512, lg: 672, xl: 896 };

/** Quanto a tabela ainda passa do quadro que rola. `width: max-content` não revela isso. */
function tableScrollDeficit(root: HTMLElement): number {
  let deficit = 0;
  for (const table of root.querySelectorAll("table")) {
    let el: HTMLElement | null = table.parentElement;
    while (el && el !== root.parentElement) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
        deficit = Math.max(deficit, el.scrollWidth - el.clientWidth);
      }
      el = el.parentElement;
    }
  }
  return deficit;
}

export function Modal({ open, onClose, title, children, footer, size = "md", bodyClassName, boardTheme, scrollKey }: ModalProps) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [fitPx, setFitPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open || !body) return;
    body.scrollTop = 0;
  }, [open, body, scrollKey]);

  useLayoutEffect(() => {
    if (!open || !body) {
      setFitPx(null);
      return;
    }
    const panel = body.parentElement;
    if (!panel) return;
    const cap = Math.floor(window.innerWidth - 32);
    const base = sizePx[size];
    let width = Math.max(panel.getBoundingClientRect().width, base);

    for (let pass = 0; pass < 6; pass++) {
      panel.style.maxWidth = `${Math.min(Math.ceil(width), cap)}px`;
      const deficit = tableScrollDeficit(body);
      if (deficit <= 1 || width >= cap - 1) break;
      width = Math.min(cap, width + deficit + 4);
    }

    const fitted = Math.ceil(width);
    const next = fitted > base + 8 ? fitted : null;
    if (next == null) panel.style.maxWidth = "";
    setFitPx((current) => (current === next ? current : next));
  }, [open, body, size, children]);

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
          fitPx == null && sizeClasses[size],
        )}
        style={fitPx != null ? { maxWidth: `min(${fitPx}px, calc(100vw - 2rem))` } : undefined}
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
        <div ref={setBody} className={cn("min-h-0 flex-1", bodyClassName ?? "overflow-y-auto p-5")}>{children}</div>
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
