import { useState, useRef, useEffect } from "react";
import type { Store } from "@/data/wedash/stores";
import type { Scope } from "@/data/wedash/dashboard";
import { StoreIcon } from "@/pages/dashboards/icons";
import { cn } from "@/lib/cn";

/**
 * Seletor de loja SINGLE-SELECT  -  Topbar (no lugar de "Buscar telas" no Dashboard).
 * Hero Store + fantasia + CNPJ; "Todas as lojas" = visao consolidada da rede.
 * Escopo: `filialIds: []` = todas; `[id]` = uma loja.
 */
export function StorePicker({ escopo, onChange, minhas }: { escopo: Scope; onChange: (e: Scope) => void; minhas: Store[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const ehTodas = escopo.filialIds.length === 0;
  const filialAtual = ehTodas ? null : minhas.find((f) => f.id === escopo.filialIds[0]) ?? null;

  function escolher(id: string | null) {
    onChange({ ...escopo, filialIds: id ? [id] : [] });
    setOpen(false);
  }

  function subtituloLoja(f: Store): string {
    const cnpj = f.cnpj?.trim();
    if (cnpj) return cnpj;
    return f.codFilial ? `Filial ${f.codFilial}` : "—";
  }

  const heroStore = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-acc-soft text-acc">
      <StoreIcon size={15} />
    </span>
  );

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full min-w-0 items-center gap-2.5 rounded-[11px] border border-line bg-bg-inset px-3 text-left transition-colors hover:border-acc"
      >
        {heroStore}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[13px] font-bold text-t0", filialAtual && "uppercase")}>
            {filialAtual ? filialAtual.fantasia : "Todas as lojas"}
          </p>
          <p className="truncate text-[11px] text-t2">
            {filialAtual ? subtituloLoja(filialAtual) : "Rede consolidada"}
          </p>
        </div>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 transition-transform", open && "rotate-180")}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[260px] rounded-[12px] border border-line bg-bg-2 p-1.5 shadow-[var(--shadow-vela)]">
          <button
            type="button"
            onClick={() => escolher(null)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors",
              ehTodas ? "bg-acc-soft" : "hover:bg-bg-3",
            )}
          >
            {heroStore}
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-[13px] font-bold", ehTodas ? "text-acc" : "text-t0")}>Todas as lojas</p>
              <p className="truncate text-[11px] text-t2">Rede consolidada</p>
            </div>
            {ehTodas && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <div className="my-1 h-px bg-line" />

          {minhas.map((f) => {
            const ativa = !ehTodas && filialAtual?.id === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => escolher(f.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors",
                  ativa ? "bg-acc-soft" : "hover:bg-bg-3",
                )}
              >
                {heroStore}
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-[13px] font-bold uppercase", ativa ? "text-acc" : "text-t0")}>{f.fantasia}</p>
                  <p className="truncate text-[11px] text-t2">{subtituloLoja(f)}</p>
                </div>
                {ativa && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
