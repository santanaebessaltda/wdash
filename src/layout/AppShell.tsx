import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { padBottom } from "@/lib/safeArea";
import { cn } from "@/lib/cn";
import { Outlet, useLocation } from "react-router-dom";
import { paths } from "@/router/paths";
import { Sidebar } from "./Sidebar";
import { MobileDrawer } from "./MobileDrawer";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { PageLoader } from "./PageLoader";
import { ChunkErrorBoundary } from "./ChunkErrorBoundary";
import { fetchThemePreference, saveThemePreference, touchLastSeen } from "@/session/authApi";
import { installPrintMode } from "@/lib/printMode";
import { storedThemePreference, useTheme } from "@/theme/ThemeProvider";
import { ProfilePhotosProvider } from "@/components/wedash/PersonAvatar";
import { PushRecover } from "@/push/PushRecover";
import { isNotificationOpen, reloadSalesAfterOpen } from "@/push/resumeSales";
import { JarvisProvider } from "@/components/wedash/jarvis/JarvisProvider";
/** O banco so grava 1x a cada 5 min; aqui so evita chamadas a toa. */
const LAST_SEEN_INTERVAL_MS = 5 * 60_000;

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  /** Chat IA: miolo sem padding — hub full-bleed. */
  const jarvisHub = location.pathname === paths.jarvis;
  const mainRef = useRef<HTMLElement | null>(null);
  const setScroller = useCallback((node: HTMLElement | null) => {
    mainRef.current = node;
  }, []);

  // Com o shell aberto o documento não rola: só o <main>. A classe sai ao desmontar
  // para login e onboarding continuarem rolando a página.
  useLayoutEffect(() => {
    document.documentElement.classList.add("app-shell");
    return () => document.documentElement.classList.remove("app-shell");
  }, []);

  // Troca de tela abre no topo do miolo. O documento entra no reset para o caso de a rolagem ter vazado para ele.
  useLayoutEffect(() => {
    setMobileNavOpen(false);
    for (const el of [mainRef.current, document.body, document.documentElement]) {
      if (el) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.search]);

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

  // Toque no aviso com o app já aberto: confere se algum número mudou. Sem mudança, a tela fica.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (isNotificationOpen(event.data)) reloadSalesAfterOpen();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return (
    <JarvisProvider>
      <div className="tela-cheia flex w-full overflow-hidden bg-bg-0 text-t0 print:block print:overflow-visible print:bg-white">
        <div className="contents print:hidden">
          <Sidebar collapsed={collapsed} />
          <MobileDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col print:block">
          <div className="contents print:hidden">
            <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
          </div>
          <main
            ref={setScroller}
            className={cn(
              "relative flex min-h-0 flex-1 flex-col overflow-x-hidden overscroll-y-contain print:overflow-visible print:p-0",
              jarvisHub
                ? "overflow-hidden p-0"
                : "overflow-y-auto px-4 pt-5 sm:px-8 sm:pt-6",
            )}
          >
            <ProfilePhotosProvider>
              <ChunkErrorBoundary key={location.pathname}>
                <Suspense fallback={<PageLoader />}>
                  <div
                    className={cn(
                      "min-w-0 print:pb-0",
                      jarvisHub ? "flex h-full min-h-0 flex-1 flex-col" : "pad-base vela-page-enter",
                    )}
                    style={jarvisHub ? undefined : padBottom("32px")}
                  >
                    <Outlet />
                  </div>
                </Suspense>
              </ChunkErrorBoundary>
            </ProfilePhotosProvider>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <PushRecover />
      </div>
    </JarvisProvider>
  );
}
