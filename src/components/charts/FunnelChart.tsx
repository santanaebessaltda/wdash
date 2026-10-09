import { cn } from "@/lib/cn";

export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
  sublabel?: string;
}

export function FunnelChart({
  stages,
  formatValue,
  onSelect,
}: {
  stages: FunnelStage[];
  formatValue?: (v: number) => string;
  onSelect?: (stage: FunnelStage, index: number) => void;
}) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  const format = formatValue ?? ((v: number) => v.toLocaleString());
  const Row = onSelect ? "button" : "div";

  return (
    <div className="flex flex-col gap-2.5">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        // Show the value inside the bar only when it's wide enough to hold the
        // text; otherwise render it just after the bar so it never overflows.
        const inside = pct >= 26;
        const value = format(s.value);
        return (
          <Row
            key={s.label}
            type={onSelect ? "button" : undefined}
            onClick={onSelect ? () => onSelect(s, i) : undefined}
            className={cn("flex items-center gap-3", onSelect && "cursor-pointer text-left")}
          >
            <span className="w-24 shrink-0 truncate text-[12px] font-semibold text-t1 sm:w-32">
              {s.label}
              {s.sublabel && <span className="block truncate text-[11px] font-medium text-t2">{s.sublabel}</span>}
            </span>
            <div className="flex h-8 flex-1 items-center rounded-[8px] bg-bg-3">
              <div
                className="flex h-full items-center justify-end overflow-hidden rounded-[8px] px-2.5 text-[11px] font-bold text-white"
                style={{ width: `${Math.max(pct, 6)}%`, background: s.color ?? "var(--acc)" }}
              >
                {inside && value}
              </div>
              {!inside && <span className="whitespace-nowrap px-2.5 text-[11px] font-bold text-t0">{value}</span>}
            </div>
          </Row>
        );
      })}
    </div>
  );
}
