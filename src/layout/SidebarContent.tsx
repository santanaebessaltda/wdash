import { useEffect, useState } from "react";
import { padBase, padTopo } from "@/lib/safeArea";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { isNavGroup, type NavEntry } from "./nav-config";
import { navDoPapel } from "./nav-wedash";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { useActiveSession } from "@/session/SessionProvider";

/** True se `path` e (ou esta aninhado sob) o destino `to`. */
function leafMatches(to: string, path: string) {
  return path === to || path.startsWith(to.endsWith("/") ? to : to + "/");
}

function owningGroupLabel(entries: NavEntry[], path: string): string | null {
  for (const entry of entries) {
    if (isNavGroup(entry) && entry.items.some((i) => leafMatches(i.to, path))) return entry.label;
  }
  return null;
}

const linkBase =
  "flex items-center gap-3 rounded-[11px] px-2.5 py-2.5 text-[13px] font-semibold text-t1 transition-colors hover:bg-bg-3 hover:text-t0";
const linkActive = "bg-acc-soft text-acc!";

const chevron = (open: boolean) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 text-t2 transition-transform duration-200", open && "rotate-180")}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function GroupIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={d} />
    </svg>
  );
}

/** Mantem `?filial=` (e demais query) ao trocar de tela pelo menu. */
function comBusca(to: string, search: string) {
  if (!search || search === "?") return to;
  return `${to}${search.startsWith("?") ? search : `?${search}`}`;
}

export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const session = useActiveSession();
  const entries = navDoPapel(session.role);
  const [openGroup, setOpenGroup] = useState<string | null>(() => owningGroupLabel(entries, location.pathname));

  useEffect(() => {
    const owner = owningGroupLabel(entries, location.pathname);
    setOpenGroup((prev) => (prev && prev === owner ? prev : (owner ?? prev)));
  }, [location.pathname, entries]);

  function toggleGroup(label: string) {
    setOpenGroup((prev) => (prev === label ? null : label));
  }

  const busca = location.search;

  return (
    <div className="pad-base flex h-full flex-col" style={padBase("0px")}>
      <div className="pad-topo flex items-center gap-2.5 px-5 pb-[18px]" style={{ minHeight: 74, ...padTopo("18px") }}>
        <WedashBrand size={34} showName={!collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 pb-3.5">
        {!collapsed && <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-t2">Menu</p>}

        {entries.map((entry) => {
          if (!isNavGroup(entry)) {
            return (
              <NavLink
                key={entry.label}
                to={comBusca(entry.to, busca)}
                onClick={onNavigate}
                title={collapsed ? entry.label : undefined}
                className={({ isActive }) => cn(linkBase, collapsed && "justify-center", (isActive || entry.activePaths?.includes(location.pathname)) && linkActive)}
              >
                <GroupIcon d={entry.icon} />
                {!collapsed && <span className="flex-1">{entry.label}</span>}
                {!collapsed && entry.badge && <span className="rounded-full bg-acc-soft px-2 py-0.5 text-[10.5px] font-bold text-acc">{entry.badge}</span>}
              </NavLink>
            );
          }
          const open = openGroup === entry.label;
          return (
            <div key={entry.label}>
              <button onClick={() => toggleGroup(entry.label)} className={cn(linkBase, "w-full justify-between", collapsed && "justify-center")} title={collapsed ? entry.label : entry.description}>
                <span className="flex min-w-0 items-center gap-3 text-left">
                  <GroupIcon d={entry.icon} />
                  {!collapsed && entry.label}
                </span>
                {!collapsed && chevron(open)}
              </button>
              {!collapsed && open && (
                <div className="ml-[21px] mt-1 flex flex-col gap-0.5 border-l border-line pl-4">
                  {entry.items.map((item) => (
                    <NavLink key={item.to} to={comBusca(item.to, busca)} end onClick={onNavigate} className={({ isActive }) => cn("flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[12.5px] font-medium text-t1 hover:bg-bg-3 hover:text-t0", isActive && linkActive)}>
                      <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", !item.dot && "bg-t2")} style={item.dot ? { background: item.dot } : undefined} />
                      <span className="flex-1 truncate">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
