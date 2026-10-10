import { lazyPage } from "@/lib/lazyPage";
import { Navigate, useParams, type RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";

const Login = lazyPage(() => import("./Login"), "Login");
const Forgot = lazyPage(() => import("./Forgot"), "Forgot");
const Reset = lazyPage(() => import("./Reset"), "Reset");
const Invite = lazyPage(() => import("./Invite"), "Invite");
function RedirectResetToken() {
  const { token } = useParams();
  return <Navigate to={`${paths.access.reset}/${token}`} replace />;
}

function RedirectInvite() {
  const { token } = useParams();
  return <Navigate to={paths.access.invite(token)} replace />;
}

export const accessRoutes: RouteObject[] = [
  { path: paths.access.login, element: <Login /> },
  { path: paths.access.forgot, element: <Forgot /> },
  { path: paths.access.reset, element: <Reset /> },
  /** Demo / estados: /reset/expired|used|invalid */
  { path: `${paths.access.reset}/:token`, element: <Reset /> },
  { path: paths.access.invite(), element: <Invite /> },
  { path: paths.access.install, element: <Navigate to={paths.home} replace /> },

  /* Legados PT  ->  EN */
  { path: paths.legacy.auth.entrar, element: <Navigate to={paths.access.login} replace /> },
  { path: paths.legacy.auth.recuperar, element: <Navigate to={paths.access.forgot} replace /> },
  { path: paths.legacy.auth.redefinir, element: <Navigate to={paths.access.reset} replace /> },
  { path: `${paths.legacy.auth.redefinir}/:token`, element: <RedirectResetToken /> },
  { path: paths.legacy.auth.convite, element: <RedirectInvite /> },
  { path: paths.legacy.auth.instalar, element: <Navigate to={paths.home} replace /> },
  { path: paths.legacy.auth.trocarSenha, element: <Navigate to={paths.access.createAccess} replace /> },
  { path: paths.legacy.auth.changePassword, element: <Navigate to={paths.access.createAccess} replace /> },
  { path: paths.legacy.auth.createPassword, element: <Navigate to={paths.access.createAccess} replace /> },
];

/** @deprecated alias */
export const acessoRoutes = accessRoutes;
