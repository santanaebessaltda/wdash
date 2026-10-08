import type { SortDir } from "@/components/ui";
import { cn } from "@/lib/cn";

export type SortOption<K extends string> = { key: K; label: string; text?: boolean };

/** Ordenacao das tabelas no celular (onde nao ha cabecalho clicavel), padrao "Sort by" do Data Tables do Vela: tocar escolhe o campo; tocar de novo inverte. */
export function MobileSortBar<K extends string>({
  options,
  sortKey,
  sortDir,
  onChange,
  className,
  always = false,
}: {
  options: SortOption<K>[];
  sortKey: K;
  sortDir: SortDir;
  onChange: (key: K, dir: SortDir) => void;
  className?: string;
  /** Mostra tambem no computador (tabela sem cabecalho clicavel). */
  always?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] font-semibold text-t1 print:hidden", !always && "md:hidden", className)}>
      <span className="text-t2">Ordenar por</span>
      {options.map((o) => {
        const active = o.key === sortKey;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key, active ? (sortDir === "asc" ? "desc" : "asc") : o.text ? "asc" : "desc")}
            className={cn("flex items-center gap-1 hover:text-t0", active && "text-acc")}
          >
            {o.label} {active && (sortDir === "asc" ? "↑" : "↓")}
          </button>
        );
      })}
    </div>
  );
}
