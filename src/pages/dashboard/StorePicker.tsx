import { useState, useRef, useEffect } from "react";
import { storeListSubtitle, type Store } from "@/data/wedash/stores";
import type { Scope } from "@/data/wedash/dashboard";
import { cn } from "@/lib/cn";

/**
 * Seletor de loja SINGLE-SELECT no Topbar.
 * Fantasia + CNPJ; "Todas as lojas" = visao consolidada da rede.
 * Escopo: `filialIds: []` = todas; `[id]` = uma loja.
 */
export function StorePicker({ scope, onChange, minhas }: { scope: Scope; onChange: (e: Scope) => void; minhas: Store[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isAll = scope.storeIds.length === 0;
  const currentBranch = isAll ? null : minhas.find((f) => f.id === scope.storeIds[0]) ?? null;

  function escolher(id: string | null) {
    onChange({ ...scope, storeIds: id ? [id] : [] });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[10px] border border-line bg-bg-inset px-2.5 text-left transition-colors hover:border-acc"
      >
        <div className="min-w-0 flex-1 leading-none">
          <p className="truncate text-[12px] font-bold uppercase leading-tight text-t0">
            {currentBranch ? currentBranch.tradeName : "Todas as filiais"}
          </p>
          <p className={cn("truncate text-[10px] leading-tight text-t2", !currentBranch && "uppercase")}>
            {currentBranch ? storeListSubtitle(currentBranch) : "Rede consolidada"}
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
              "flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1 text-left transition-colors",
              isAll ? "bg-acc-soft" : "hover:bg-bg-3",
            )}
          >
            <div className="min-w-0 flex-1 leading-none">
              <p className={cn("truncate text-[12px] font-bold uppercase leading-tight", isAll ? "text-acc" : "text-t0")}>Todas as filiais</p>
              <p className="truncate text-[10px] uppercase leading-tight text-t2">Rede consolidada</p>
            </div>
            {isAll && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <div className="my-1 h-px bg-line" />

          {minhas.map((f) => {
            const active = !isAll && currentBranch?.id === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => escolher(f.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1 text-left transition-colors",
                  active ? "bg-acc-soft" : "hover:bg-bg-3",
                )}
              >
                <div className="min-w-0 flex-1 leading-none">
                  <p className={cn("truncate text-[12px] font-bold uppercase leading-tight", active ? "text-acc" : "text-t0")}>{f.tradeName}</p>
                  <p className="truncate text-[10px] leading-tight text-t2">{storeListSubtitle(f)}</p>
                </div>
                {active && (
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
