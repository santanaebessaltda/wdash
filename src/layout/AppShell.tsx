import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { padBase } from "@/lib/safeArea";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileDrawer } from "./MobileDrawer";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { PageLoader } from "./PageLoader";
import { fetchThemePreference, saveThemePreference, touchLastSeen } from "@/session/authApi";
import { installPrintMode } from "@/lib/printMode";
import { storedThemePreference, useTheme } from "@/theme/ThemeProvider";

/** O banco so grava 1x a cada 5 min; aqui so evita chamadas a toa. */
const LAST_SEEN_INTERVAL_MS = 5 * 60_000;

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // html/body com height 100% + overflow-x hidden fazem o <body> rolar (nao a janela nem o <main>):
  // zera todos para a tela nova abrir no topo.
  useLayoutEffect(() => {
    setMobileNavOpen(false);
    for (const el of [mainRef.current, document.body, document.documentElement]) {
      if (el) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => installPrintMode(), []);

  // Aparencia da conta (Meu perfil): igual em qualquer aparelho; relida ao voltar para o app (PWA).
  const { preference, setPreference } = useTheme();
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  useEffect(() => {
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      const conta = await fetchThemePreference();
      if (conta) {
        if (conta !== preferenceRef.current) setPreference(conta);
        return;
      }
      // Conta sem escolha: leva a que este aparelho ja tinha.
      const local = storedThemePreference();
      if (local) void saveThemePreference(local);
    };
    void sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [setPreference]);

  useEffect(() => {
    const touch = () => {
      if (document.visibilityState === "visible") void touchLastSeen();
    };
    touch();
    const timer = window.setInterval(touch, LAST_SEEN_INTERVAL_MS);
    document.addEventListener("visibilitychange", touch);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", touch);
    };
  }, []);

  return (
    <div className="tela-cheia flex w-full overflow-x-hidden bg-bg-0 text-t0 print:block print:overflow-visible print:bg-white">
      <div className="contents print:hidden">
        <Sidebar collapsed={collapsed} />
        <MobileDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col print:block">
        <div className="contents print:hidden">
          <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
        </div>
        <main ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3.5 pt-5 sm:px-6 sm:pt-6 print:overflow-visible print:p-0">
          <Suspense fallback={<PageLoader />}>
            <div key={location.pathname} className="pad-base vela-page-enter print:pb-0" style={padBase("0px")}>
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
