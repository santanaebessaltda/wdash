import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  key: string;
  label: string;
  content: ReactNode;
  /** Icone opcional a esquerda do rotulo (ex.: FlameIcon). */
  icon?: ReactNode;
}

export type TabsVariant = "default" | "accent";

/**
 * Self-contained (state-based) tab widget, for in-page tab switches that don't need a URL.
 * - `default`: track inset (bg-bg-3) + pill ativo elevado  -  padrao Vela.
 * - `accent`: pills soltos com borda, ativo = border-acc bg-acc-soft text-acc
 *   (mesmo visual do Theme Customizer).
 */
export function Tabs({
  items,
  defaultKey,
  variant = "default",
  className,
}: {
  items: TabItem[];
  defaultKey?: string;
  variant?: TabsVariant;
  className?: string;
}) {
  const [active, setActive] = useState(defaultKey ?? items[0]?.key);
  const activeItem = items.find((i) => i.key === active);

  return (
    <div className={className}>
      <div
        className={cn(
          variant === "accent"
            ? "flex flex-wrap gap-2.5"
            : "flex gap-1 overflow-x-auto rounded-[var(--radius-vela-md)] bg-bg-3 p-1",
        )}
      >
        {items.map((item) => {
          const on = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActive(item.key)}
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap font-semibold transition-colors",
                variant === "accent"
                  ? cn(
                      "rounded-[10px] border-[1.5px] px-3.5 py-2 text-xs font-bold",
                      on ? "border-acc bg-acc-soft text-acc" : "border-line bg-bg-inset text-t1",
                    )
                  : cn(
                      "rounded-[10px] px-3.5 py-1.5 text-[12.5px]",
                      on ? "bg-bg-1 text-t0 shadow-[var(--shadow-vela)]" : "text-t1 hover:text-t0",
                    ),
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="mt-4 min-w-0">{activeItem?.content}</div>
    </div>
  );
}
