import { Navigate } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";

/**
 * `/dashboard` e `/loja` eram a tela legada com TabNav interno.
 * Entrada canonica = Visao geral (`/dashboard/visao-geral`).
 */
export const dashboardRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.dashboard, element: <Navigate replace to={paths.overview} /> },
      { path: paths.legacy.store, element: <Navigate replace to={paths.overview} /> },
    ],
  },
];
