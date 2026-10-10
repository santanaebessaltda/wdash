import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";

const ChallengesPage = lazyPage(() => import("./ChallengesPage"), "ChallengesPage");
const ChallengeDetailPage = lazyPage(() => import("../challenges/ChallengeDetailPage"), "default");
const ChallengeEditorPage = lazyPage(() => import("../challenges/ChallengeEditorPage"), "default");
const CashClosePage = lazyPage(() => import("../cash-close/CashClosePage"), "CashClosePage");
const SangriaPage = lazyPage(() => import("./SangriaPage"), "SangriaPage");

/** Gestao  -  Gestor e Gerente (Metas fica em `paths.goals`). */
export const managementRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.management.shifts, element: <Navigate to={paths.operation.groups} replace /> },
      { path: paths.management.staff, element: <Navigate to={paths.operation.sellers} replace /> },
      { path: paths.management.cashClose, element: <CashClosePage /> },
      { path: paths.management.sangria, element: <SangriaPage /> },
      { path: paths.management.challenges, element: <ChallengesPage /> },
      { path: paths.management.challengeNew, element: <ChallengeEditorPage /> },
      { path: `${paths.management.challenges}/:id`, element: <ChallengeDetailPage /> },
      { path: `${paths.management.challenges}/:id/edit`, element: <ChallengeEditorPage /> },
    ],
  },
];
