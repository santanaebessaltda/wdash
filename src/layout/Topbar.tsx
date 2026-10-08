import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { padTopo } from "@/lib/safeArea";
import { Avatar, Dropdown, type DropdownItem } from "@/components/ui";
import { isGestor } from "./nav-wedash";
import { paths } from "@/router/paths";
import { accessLabel, useSession, useActiveSession } from "@/session/SessionProvider";
import {
  stores as filiaisFixture,
  storesForSession,
  hydrateSessionStores,
  type Store,
} from "@/data/wedash/stores";
import { StorePicker } from "@/pages/dashboard/StorePicker";
import { useScope } from "@/pages/dashboard/useScope";
import { TopbarRefresh } from "./TopbarRefresh";
import { useNotifications } from "./useNotifications";

const ICON_PERFIL = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8";
const ICON_INTEGRACOES = "M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z";
const ICON_USUARIOS =
  "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8";
const ICON_LOGS = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8";
const ICON_SAIR = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";

function MenuIcon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-80">
      <path d={d} />
    </svg>
  );
}

const ICON_ALERTA = "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01";

/** "Hoje"  |  "Ontem"  |  "24/09". */
function quando(d: Date): string {
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function Topbar({ onOpenMobileNav, collapsed, onToggleCollapse }: { onOpenMobileNav: () => void; collapsed: boolean; onToggleCollapse: () => void }) {
  const session = useActiveSession();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { escopo, mudar } = useScope();
  const avisos = useNotifications(session.tenantId, session.role, isGestor(session.role));
  const notificacoes: DropdownItem[] = [
    ...avisos.alerts.map(
      (a): DropdownItem => ({
        label: a.title,
        description: a.body,
        danger: true,
        icon: (
          <span className="mt-0.5 shrink-0">
            <MenuIcon d={ICON_ALERTA} />
          </span>
        ),
        onClick: () => navigate(paths.settings.erp),
      }),
    ),
    ...avisos.items.map(
      (n): DropdownItem => ({
        label: n.title,
        description: n.body ?? undefined,
        highlight: !n.read,
        keepOpen: !n.link,
        onClick: () => {
          avisos.markRead(n.id);
          if (n.link) navigate(n.link);
        },
        icon: <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-acc"}`} />,
        trailing: <span className="shrink-0 pt-0.5 text-[11.5px] font-normal tabular-nums text-t2">{quando(n.at)}</span>,
      }),
    ),
  ];
  if (notificacoes.length === 0) notificacoes.push({ label: "Nenhuma notificação", disabled: true });

  const [listaLojas, setListaLojas] = useState<Store[]>(() => {
    const hit = storesForSession(session.stores);
    return hit.length > 0 ? hit : filiaisFixture;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (session.stores.length === 0) {
        if (!cancelled) setListaLojas([]);
        return;
      }
      const hit = storesForSession(session.stores);
      const loaded = await hydrateSessionStores(session.tenantId, session.stores);
      if (cancelled) return;
      if (loaded.length > 0) setListaLojas(loaded);
      else if (hit.length > 0) setListaLojas(hit);
      // Nao cai no mock f1/f2 se a sessao tem UUIDs  -  isso quebrava o seletor.
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, session.stores]);

  // Loja e filtro global: Topbar nas telas do produto (nao so Dashboard).
  const mostraStorePicker =
    session.role !== "SELLER" &&
    (location.pathname === paths.dashboard ||
    location.pathname.startsWith(paths.dashboard + "/") ||
    location.pathname === paths.live.root ||
    location.pathname.startsWith(paths.live.root + "/") ||
    location.pathname === paths.goals ||
    location.pathname.startsWith(paths.goals + "/") ||
    location.pathname.startsWith("/stock/") ||
    location.pathname.startsWith("/management/") ||
    location.pathname.startsWith("/operation/") ||
    location.pathname.startsWith(paths.settings.root) ||
    location.pathname === paths.profile);

  // Menu do avatar: Conta = Meu perfil  |  (Gestor) Integracoes, Usuarios, Logs  |  Sair.
  const conta: DropdownItem[] = isGestor(session.role)
    ? [
        { label: "Integrações", icon: <MenuIcon d={ICON_INTEGRACOES} />, onClick: () => navigate(paths.settings.erp) },
        { label: "Usuários", icon: <MenuIcon d={ICON_USUARIOS} />, onClick: () => navigate(paths.settings.users) },
        { label: "Logs", icon: <MenuIcon d={ICON_LOGS} />, onClick: () => navigate(paths.settings.logs) },
      ]
    : [];

  return (
    <header className="pad-topo sticky top-0 z-30 flex flex-none items-center gap-2.5 border-b border-line bg-bg-1/80 px-3.5 pb-3 backdrop-blur-md sm:gap-3.5 sm:px-6" style={padTopo("0.75rem")}>
      <button onClick={onOpenMobileNav} aria-label="Abrir menu" title="Abrir menu" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 lg:hidden">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <button
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 lg:flex">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {mostraStorePicker && (
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <StorePicker escopo={escopo} onChange={mudar} minhas={listaLojas} />
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <TopbarRefresh storeIds={escopo.filialIds} />

        <Dropdown
          align="right"
          trigger={
            <button
              className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3"
              aria-label="Notificações"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {(avisos.unread || avisos.alerts.length > 0) && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-bad" />
              )}
            </button>
          }
          header={
            <div className="flex items-center justify-between gap-4 whitespace-nowrap">
              <span className="text-[13px] font-bold text-t0">Notificações</span>
              {avisos.items.length > 0 && (
                <span className="flex items-center gap-3 text-[12px] font-semibold">
                  <button
                    type="button"
                    onClick={avisos.markAllRead}
                    disabled={!avisos.unread}
                    className="text-acc hover:underline disabled:cursor-default disabled:text-t2 disabled:no-underline"
                  >
                    Marcar como lidas
                  </button>
                  <button type="button" onClick={avisos.clearAll} className="text-t2 hover:text-bad">
                    Limpar
                  </button>
                </span>
              )}
            </div>
          }
          items={notificacoes}
          menuClassName="w-[300px]"
          bodyClassName="max-h-[300px] overflow-y-auto"
        />

        <Dropdown
          align="right"
          trigger={
            <button className="flex items-center gap-2 rounded-[10px] pl-0.5 pr-1 hover:bg-bg-3">
              <Avatar name={session.name} src={session.avatarUrl} size="sm" />
              <span className="hidden text-left leading-tight md:block">
                <span className="block max-w-[160px] truncate text-[12.5px] font-bold text-t0">{session.name}</span>
                <span className="block text-[10.5px] text-t2">{accessLabel(session.role, session.isOwner)}</span>
              </span>
            </button>
          }
          menuClassName="min-w-[240px]"
          header={
            <div className="flex items-center gap-2.5">
              <Avatar name={session.name} src={session.avatarUrl} size="sm" />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[13px] font-bold text-t0">{session.name}</p>
                <p className="truncate text-[11.5px] text-t2">{session.email}</p>
              </div>
            </div>
          }
          items={[
            { heading: true, label: "Conta" },
            { label: "Meu perfil", icon: <MenuIcon d={ICON_PERFIL} />, onClick: () => navigate(paths.profile) },
            ...conta,
            { divider: true, label: "" },
            {
              label: "Sair",
              icon: <MenuIcon d={ICON_SAIR} />,
              danger: true,
              onClick: () => {
                signOut();
                navigate(paths.access.login);
              },
            },
          ]}
        />
      </div>
    </header>
  );
}
