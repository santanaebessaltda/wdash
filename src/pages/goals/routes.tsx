import { Navigate, useLocation, useParams } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";

const GoalsPage = lazyPage(() => import("./GoalsPage"), "default");
const GoalDetailPage = lazyPage(() => import("./GoalDetailPage"), "default");
const GoalEditorPage = lazyPage(() => import("./GoalEditorPage"), "default");

function LegacyGoalRedirect({ edit = false }: { edit?: boolean }) {
  const { id = "" } = useParams();
  const { search, hash } = useLocation();
  const to = edit ? paths.goalEdit(id) : paths.goalDetail(id);
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

export const goalRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.goals, element: <GoalsPage /> },
      { path: paths.goalNew, element: <GoalEditorPage /> },
      { path: `${paths.goals}/:id/edit`, element: <GoalEditorPage /> },
      { path: `${paths.goals}/:id`, element: <GoalDetailPage /> },
      { path: paths.legacy.management.goals, element: <RedirectTo to={paths.goals} /> },
      { path: `${paths.legacy.management.goals}/new`, element: <RedirectTo to={paths.goalNew} /> },
      { path: `${paths.legacy.management.goals}/:id/edit`, element: <LegacyGoalRedirect edit /> },
      { path: `${paths.legacy.management.goals}/:id`, element: <LegacyGoalRedirect /> },
      { path: paths.legacy.goalsRoot, element: <RedirectTo to={paths.goals} /> },
      { path: `${paths.legacy.goalsRoot}/new`, element: <RedirectTo to={paths.goalNew} /> },
      { path: `${paths.legacy.goalsRoot}/:id/edit`, element: <LegacyGoalRedirect edit /> },
      { path: `${paths.legacy.goalsRoot}/:id`, element: <LegacyGoalRedirect /> },
      /** Legado: Metas vivia em Configuracoes + /metas. */
      { path: paths.legacy.goals, element: <RedirectTo to={paths.goals} /> },
      { path: paths.legacy.goalsInSettings, element: <RedirectTo to={paths.goals} /> },
    ],
  },
];
