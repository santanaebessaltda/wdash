import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface DropdownItem {
  label: string;
  /** Texto menor abaixo do rotulo (ex.: corpo de uma notificacao). */
  description?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
  /** Rotulo de secao (nao clicavel). */
  heading?: boolean;
  /** Destaca a opcao selecionada (bg-acc-soft + texto acc). */
  active?: boolean;
  /** Opcao nao clicavel (ex.: filtro ainda indisponivel). */
  disabled?: boolean;
  /** Conteudo a direita do rotulo (ex.: switch visual). */
  trailing?: ReactNode;
  /** Nao fecha o menu ao clicar (toggles). */
  keepOpen?: boolean;
  /** Texto na cor primaria sem fundo (ex.: notificacao nao lida). */
  highlight?: boolean;
}

export interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  /** Bloco fixo acima dos itens (ex.: usuario logado no menu do avatar). */
  header?: ReactNode;
  align?: "left" | "right";
  /** Classes extras do menu (ex.: altura maxima com scroll). */
  menuClassName?: string;
  /** Classes da area dos itens  -  rolagem so nos itens, com o `header` fixo. */
  bodyClassName?: string;
  /** Renderiza o menu no `body` (posicao fixa)  -  para triggers dentro de containers com overflow (tabelas). */
  portal?: boolean;
}

const GAP = 8;

export function Dropdown({ trigger, items, header, align = "right", menuClassName, bodyClassName, portal = false }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useLayoutEffect(() => {
    if (!portal || !open) {
      setPos(null);
      return;
    }
    function place() {
      const trig = ref.current?.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 0;
      if (!trig) return;
      const below = window.innerHeight - trig.bottom;
      const up = below < menuH + GAP && trig.top > below;
      setPos({
        position: "fixed",
        top: up ? Math.max(GAP, trig.top - menuH - GAP) : trig.bottom + GAP,
        ...(align === "right" ? { right: window.innerWidth - trig.right } : { left: trig.left }),
      });
    }
    place();
    const close = () => setOpen(false);
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [portal, open, align]);

  const menuClass = cn(
    "z-40 min-w-[190px] rounded-[var(--radius-vela-md)] border border-line bg-bg-2 p-1.5 shadow-[var(--shadow-vela)] animate-vela-pop",
    !portal && cn("absolute mt-2", align === "right" ? "right-0" : "left-0"),
    menuClassName,
  );

  const menu = open && (
        <div
          ref={menuRef}
          className={menuClass}
          style={portal ? (pos ?? { position: "fixed", top: 0, left: 0, visibility: "hidden" }) : undefined}
        >
          {header && <div className="mb-1.5 border-b border-line px-3 pb-3 pt-2">{header}</div>}
          <div className={bodyClassName}>
          {items.map((item, i) =>
            item.divider ? (
              <div key={i} className="my-1.5 h-px bg-line" />
            ) : item.heading ? (
              <p key={i} className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-t2">
                {item.label}
              </p>
            ) : (
              <button
                key={i}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick?.();
                  if (!item.keepOpen) setOpen(false);
                }}
                className={cn(
                  "flex w-full gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] font-medium",
                  item.description ? "items-start" : "items-center",
                  item.disabled
                    ? "cursor-not-allowed text-t2 opacity-50"
                    : item.active
                      ? "bg-acc-soft text-acc"
                      : item.danger
                        ? "text-bad hover:bg-bg-3"
                        : item.highlight
                          ? "text-acc hover:bg-bg-3"
                          : "text-t0 hover:bg-bg-3",
                )}
              >
                {item.icon}
                {item.description ? (
                  <span className="min-w-0 flex-1">
                    <span className="block">{item.label}</span>
                    <span className="mt-0.5 block text-[12px] font-normal leading-snug text-t2">{item.description}</span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1">{item.label}</span>
                )}
                {item.trailing}
                {item.active && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ),
          )}
          </div>
        </div>
  );

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {portal ? menu && createPortal(menu, document.body) : menu}
    </div>
  );
}
