import { Dropdown } from "@/components/ui";
import { useMediaQuery } from "@/lib/useMediaQuery";

/** Mesmo desenho do gatilho do DateRangePicker (md)  -  filtros do cabecalho das telas. */
const TRIGGER_CLASS =
  "flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3.5 text-left transition-colors hover:border-acc";

/** Filtro de opcao unica no cabecalho: gatilho igual ao do periodo + menu com a opcao ativa marcada. */
export function HeaderFilter<V extends string>({
  value,
  options,
  onChange,
  label,
  lead,
}: {
  value: V;
  options: Array<{ value: V; label: string }>;
  onChange: (v: V) => void;
  /** Nome do filtro (acessibilidade). */
  label: string;
  /** Texto fixo antes do valor, no gatilho. */
  lead?: string;
}) {
  const atual = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";
  // Abaixo do `sm` os filtros ficam alinhados a esquerda (um abaixo do outro): o menu abre para a direita.
  const empilhado = useMediaQuery("(max-width: 639px)");
  return (
    <Dropdown
      align={empilhado ? "left" : "right"}
      menuClassName="max-h-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto"
      trigger={
        <button type="button" aria-label={`${label}: ${atual}`} className={TRIGGER_CLASS}>
          {lead && <span className="shrink-0 text-[13.5px] font-medium text-t2">{lead}</span>}
          <span className="min-w-0 max-w-[220px] truncate text-[13.5px] font-semibold text-t0">{atual}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-t2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      }
      items={options.map((o) => ({ label: o.label, active: o.value === value, onClick: () => onChange(o.value) }))}
    />
  );
}

/** Busca no cabecalho, com a mesma altura e borda dos filtros. */
export function HeaderSearch({
  value,
  onChange,
  placeholder = "Buscar...",
  width = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label="Buscar"
      style={{ width }}
      className="h-10 min-w-0 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3.5 text-[13.5px] font-semibold text-t0 outline-none transition-colors placeholder:font-medium placeholder:text-t2 hover:border-acc focus:border-acc"
    />
  );
}
