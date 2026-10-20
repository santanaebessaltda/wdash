import { useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui";
import { storeListSubtitle, type Store } from "@/data/wedash/stores";
import type { Scope } from "@/data/wedash/dashboard";
import { cn } from "@/lib/cn";

/**
 * Seletor de loja no Topbar. Fantasia + CNPJ, sem ícone.
 * Nenhuma ou todas marcadas = rede. Uma ou várias = só essas filiais.
 */
export function StorePicker({ scope, onChange, minhas }: { scope: Scope; onChange: (e: Scope) => void; minhas: Store[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const many = minhas.length > 1;
  const isAll = many && (scope.storeIds.length === 0 || scope.storeIds.length >= minhas.length);
  const picked = isAll ? minhas : minhas.filter((store) => scope.storeIds.includes(store.id));
  const allOn = many && picked.length === minhas.length;
  const some = many && picked.length > 0 && !allOn;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some, open]);

  function apply(ids: string[]) {
    onChange({ ...scope, storeIds: ids.length === 0 || ids.length >= minhas.length ? [] : ids });
  }

  function toggleStore(id: string) {
    const current = isAll ? minhas.map((store) => store.id) : picked.map((store) => store.id);
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    if (next.length === 0) return;
    apply(next);
  }

  const current = picked.length === 1 ? picked[0] : null;
  const title = isAll ? "Todas as filiais" : current ? current.tradeName : `${picked.length} filiais`;
  const subtitle = isAll ? "Rede consolidada" : current ? storeListSubtitle(current) : picked.map((store) => store.tradeName).join(" · ");

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[10px] border border-line bg-bg-inset px-2.5 text-left transition-colors hover:border-acc"
      >
        <div className="min-w-0 flex-1 leading-none">
          <p className="truncate text-[12px] font-bold uppercase leading-tight text-t0">{title}</p>
          <p className={cn("truncate text-[10px] uppercase leading-tight text-t2", current && "normal-case")}>{subtitle}</p>
        </div>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 transition-transform", open && "rotate-180")}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && many && (
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-80 w-full min-w-[260px] overflow-y-auto rounded-[12px] border border-line bg-bg-2 p-1.5 shadow-[var(--shadow-vela)]">
          <Checkbox
            ref={allRef}
            checked={allOn}
            onChange={() => apply([])}
            className="w-full rounded-[9px] px-2.5 py-1.5 hover:bg-bg-3"
            label={
              <span className="min-w-0 leading-none">
                <span className="block truncate text-[12px] font-bold uppercase leading-tight">Todas as filiais</span>
                <span className="mt-0.5 block truncate text-[10px] font-normal uppercase leading-tight text-t2">Rede consolidada</span>
              </span>
            }
          />
          <div className="my-1 h-px bg-line" />
          {minhas.map((store) => {
            const on = picked.some((item) => item.id === store.id);
            return (
              <Checkbox
                key={store.id}
                checked={on}
                onChange={() => toggleStore(store.id)}
                className="w-full items-start rounded-[9px] px-2.5 py-1.5 hover:bg-bg-3"
                label={
                  <span className="min-w-0 leading-none">
                    <span className="block truncate text-[12px] font-bold uppercase leading-tight">{store.tradeName}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-t2">{storeListSubtitle(store)}</span>
                  </span>
                }
              />
            );
          })}
        </div>
      )}

      {open && !many && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[260px] rounded-[12px] border border-line bg-bg-2 p-1.5 shadow-[var(--shadow-vela)]">
          <div className="rounded-[9px] bg-acc-soft px-2.5 py-1">
            <p className="truncate text-[12px] font-bold uppercase leading-tight text-acc">{minhas[0]?.tradeName ?? "Filial"}</p>
            <p className="truncate text-[10px] leading-tight text-t2">{minhas[0] ? storeListSubtitle(minhas[0]) : "—"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
