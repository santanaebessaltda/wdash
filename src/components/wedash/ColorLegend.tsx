import { cn } from "@/lib/cn";

export type LegendMark = "bar" | "chip" | "dot";

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
};

/** Cor + nome + detalhe, no mesmo desenho da legenda do Pedido de compra. */
export function ColorLegend({ items, mark = "chip", className }: { items: LegendItem[]; mark?: LegendMark; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5 text-[12px] text-t1">
          <span className={cn(MARK[mark], item.color)} aria-hidden />
          <span className="font-semibold">{item.label}</span>
          {item.hint ? <span className="text-t2">{item.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}
