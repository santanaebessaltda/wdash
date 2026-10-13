import type { RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";

const ChallengesPage = lazyPage(() => import("./ChallengesPage"), "ChallengesPage");
const ChallengeDetailPage = lazyPage(() => import("../challenges/ChallengeDetailPage"), "default");
const ChallengeEditorPage = lazyPage(() => import("../challenges/ChallengeEditorPage"), "default");
const CashClosePage = lazyPage(() => import("../cash-close/CashClosePage"), "CashClosePage");
const CashDropPage = lazyPage(() => import("./CashDropPage"), "CashDropPage");
const SalesReportPage = lazyPage(() => import("./SalesReportPage"), "SalesReportPage");
const StaffPage = lazyPage(() => import("./StaffPage"), "StaffPage");
const PurchaseOrderPage = lazyPage(() => import("../stock/PurchaseOrderPage"), "PurchaseOrderPage");

/** Gestao  -  Gestor e Gerente. Metas fica em `paths.goals`, no mesmo prefixo. */
export const managementRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.management.team, element: <StaffPage /> },
      { path: paths.management.purchaseOrder, element: <PurchaseOrderPage /> },
      { path: paths.management.shifts, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.management.staff, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.management.cashClose, element: <CashClosePage /> },
      { path: paths.management.cashDrop, element: <CashDropPage /> },
      { path: paths.legacy.cashDrop, element: <RedirectTo to={paths.management.cashDrop} /> },
      { path: paths.management.salesReport, element: <SalesReportPage /> },
      { path: paths.management.challenges, element: <ChallengesPage /> },
      { path: paths.management.challengeNew, element: <ChallengeEditorPage /> },
      { path: `${paths.management.challenges}/:id`, element: <ChallengeDetailPage /> },
      { path: `${paths.management.challenges}/:id/edit`, element: <ChallengeEditorPage /> },
    ],
  },
];
