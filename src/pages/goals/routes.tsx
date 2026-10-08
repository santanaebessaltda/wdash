import { Navigate } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";

const GoalsPage = lazyPage(() => import("./GoalsPage"), "default");
const GoalDetailPage = lazyPage(() => import("./GoalDetailPage"), "default");
const GoalEditorPage = lazyPage(() => import("./GoalEditorPage"), "default");

export const metasRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.goals, element: <GoalsPage /> },
      { path: paths.goalNew, element: <GoalEditorPage /> },
      { path: "/goals/:id", element: <GoalDetailPage /> },
      { path: "/goals/:id/edit", element: <GoalEditorPage /> },
      /** Legado: Metas vivia em Configuracoes + /metas. */
      { path: paths.legacy.goals, element: <Navigate to={paths.goals} replace /> },
      { path: paths.legacy.goalsInSettings, element: <Navigate to={paths.goals} replace /> },
    ],
  },
];
