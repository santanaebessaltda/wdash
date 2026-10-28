import { cn } from "@/lib/cn";

export type LegendMark = "bar" | "chip" | "dot" | "square";

export type LegendItem = {
  key: string;
  /** Classe de cor do traço, como `bg-ok` ou `bg-warn`. */
  color: string;
  label: string;
  hint?: string;
};

const MARK: Record<LegendMark, string> = {
  bar: "h-3.5 w-1 rounded-full",
  chip: "h-2.5 w-3.5 rounded-[4px]",
  dot: "h-2.5 w-2.5 rounded-full",
  /** Mesmo indicador do Gantt View: quadrado levemente arredondado. */
  square: "h-2.5 w-2.5 rounded-[3px]",
};

/**
 * Cor + nome (+ detalhe opcional). Padrão Gantt View (`PageHeader` actions):
 * bloco na direita da página, itens empilhados da direita para a esquerda com wrap.
 */
export function ColorLegend({ items, mark = "chip", className }: { items: LegendItem[]; mark?: LegendMark; className?: string }) {
  return (
    <ul className={cn("flex w-full flex-row flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5 text-xs font-semibold text-t1">
          <span className={cn("shrink-0", MARK[mark], item.color)} aria-hidden />
          {item.label}
          {item.hint ? <span className="font-normal text-t2">{item.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}
