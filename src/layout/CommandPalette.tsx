import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { isNavGroup } from "./nav-config";
import { navDoPapel } from "./nav-wedash";
import { useActiveSession } from "@/session/SessionProvider";

interface FlatItem {
  label: string;
  to: string;
  group: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const session = useActiveSession();

  const flatItems = useMemo<FlatItem[]>(
    () => navDoPapel(session.role).flatMap((entry) => (isNavGroup(entry) ? entry.items.map((i) => ({ label: i.label, to: i.to, group: entry.label })) : [{ label: entry.label, to: entry.to, group: "Principal" }])),
    [session.role],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatItems.slice(0, 8);
    return flatItems.filter((item) => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q)).slice(0, 20);
  }, [query, flatItems]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function go(item: FlatItem) {
    navigate({ pathname: item.to, search: location.search });
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[activeIdx]) {
      go(results[activeIdx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-vela-fade" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 shadow-[var(--shadow-vela)] animate-vela-pop">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-t2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder="Buscar na WDash…" className="w-full bg-transparent text-[14px] text-t0 outline-none placeholder:text-t2" />
          <kbd className="shrink-0 rounded-md border border-line-2 px-1.5 py-0.5 text-[10px] font-bold text-t2">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-t1">Nenhum resultado encontrado.</p>}
          {results.map((item, i) => (
            <button key={item.to} onClick={() => go(item)} onMouseEnter={() => setActiveIdx(i)} className={`flex w-full flex-col items-start rounded-[10px] px-3 py-2 text-left text-[13px] ${i === activeIdx ? "bg-acc-soft text-acc" : "text-t0"}`}>
              <span className="font-semibold">{item.label}</span>
              <span className="text-[11px] text-t2">{item.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
