import { Navigate } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { TeamPage } from "./TeamPage";
/* Equipe sync — cabeçalho na hora; só KPIs/cards em skeleton (igual às outras 3 do Dashboard). */

export const teamRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.team, element: <TeamPage /> },
      { path: paths.legacy.team, element: <Navigate to={paths.team} replace /> },
      { path: paths.legacy.teamRoot, element: <Navigate to={paths.team} replace /> },
    ],
  },
];
