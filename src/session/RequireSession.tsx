import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "./SessionProvider";
import { paths } from "@/router/paths";
import type { Role } from "@/data/wedash/team";
import { isAwaitingInitialSync } from "./awaitingInitialSync";

/**
 * Protege rotas. Ordem: senha temporaria  ->  onboarding  ->  sync inicial  ->  app.
 */
export function RequireSession({ modo = "app" }: { modo?: "app" | "onboarding" | "create-access" }) {
  const { session, ready } = useSession();
  const location = useLocation();

  if (!ready) return null;
  if (!session) return <Navigate to={paths.access.login} replace state={{ de: location.pathname }} />;

  const needsPassword = session.temporaryPassword;
  const needsOnboarding = session.onboardingStep !== null;
  const awaitingSync = isAwaitingInitialSync();
  const onSyncing = location.pathname === paths.syncing;

  if (modo === "create-access") {
    if (!needsPassword) {
      if (needsOnboarding) return <Navigate to={paths.onboarding} replace />;
      if (awaitingSync) return <Navigate to={paths.syncing} replace />;
      return <Navigate to={homeForRole(session.role)} replace />;
    }
    return <Outlet />;
  }

  if (needsPassword) return <Navigate to={paths.access.createAccess} replace />;

  if (modo === "app" && needsOnboarding) return <Navigate to={paths.onboarding} replace />;

  // Ao concluir onboarding, NAO manda pro Dash  -  manda pra tela de sync.
  if (modo === "onboarding" && !needsOnboarding) {
    return <Navigate to={awaitingSync ? paths.syncing : homeForRole(session.role)} replace />;
  }

  // Enquanto SEED nao terminou, trava qualquer rota do app (exceto /sincronizando).
  if (modo === "app" && awaitingSync && !onSyncing) {
    return <Navigate to={paths.syncing} replace />;
  }

  return <Outlet />;
}

/** Restringe a rota a alguns papeis; os demais vao para a tela inicial do seu papel. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session) return <Navigate to={paths.access.login} replace />;
  if (!roles.includes(session.role)) return <Navigate to={homeForRole(session.role)} replace />;
  return <Outlet />;
}

export function homeForRole(role: Role): string {
  if (role === "SELLER") return paths.seller.home;
  return paths.overview;
}
