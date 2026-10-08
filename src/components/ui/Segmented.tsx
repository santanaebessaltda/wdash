import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

/**
 * Controle segmentado (toggle de opcoes mutuamente exclusivas).
 * Uso principal: filtro de marca/divisao WEPINK | WPINK nas telas do
 * Dashboard. Estilo copiado dos botoes "Quick ranges" da DatePickersPage
 * (ativo = border-acc bg-acc-soft text-acc), ja validado visualmente no tema.
 *
 * `value === null` representa "Todas / sem filtro" quando `allowClear` esta
 * ativo  -  clicar na opcao ja selecionada limpa a selecao.
 */
export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  allowClear = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  allowClear?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-1.5", className)}>
      {options.map((opt) => {
        const ativa = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(allowClear && ativa ? null : opt.value)}
            className={cn(
              "h-8 cursor-pointer rounded-[9px] border px-3 text-xs font-semibold transition-colors",
              ativa ? "border-acc bg-acc-soft text-acc" : "border-line text-t1 hover:border-acc",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}