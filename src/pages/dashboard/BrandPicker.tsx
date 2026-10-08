import { Dropdown } from "@/components/ui";
import type { Division } from "@/data/wedash/stores";

const OPCOES: { value: Division | null; label: string }[] = [
  { value: null, label: "Todas as marcas" },
  { value: "WEPINK", label: "WEPINK" },
  { value: "WPINK", label: "WPINK" },
];

/**
 * Filtro de marca (WEPINK / WPINK / todas)  -  usa o `Dropdown` do Vela
 * (painel com opcoes estilizadas), nao o `<select>` nativo do SO.
 */
export function BrandPicker({
  value,
  onChange,
}: {
  value: Division | null;
  onChange: (v: Division | null) => void;
}) {
  const rotulo = OPCOES.find((o) => o.value === value)?.label ?? "Todas as marcas";

  return (
    <Dropdown
      align="right"
      trigger={
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc"
        >
          <span className="max-w-[9.5rem] truncate">{rotulo}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-t2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      }
      items={OPCOES.map((o) => ({
        label: o.label,
        active: o.value === value,
        onClick: () => onChange(o.value),
      }))}
    />
  );
}
