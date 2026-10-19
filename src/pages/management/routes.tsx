import { Navigate, useLocation, useParams, type RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";

const ChallengesPage = lazyPage(() => import("./ChallengesPage"), "ChallengesPage");
const ChallengeDetailPage = lazyPage(() => import("../challenges/ChallengeDetailPage"), "default");
const ChallengeEditorPage = lazyPage(() => import("../challenges/ChallengeEditorPage"), "default");
const CashClosePage = lazyPage(() => import("../cash-close/CashClosePage"), "CashClosePage");
const WalletPage = lazyPage(() => import("../wallet/WalletPage"), "default");
const CashDropPage = lazyPage(() => import("./CashDropPage"), "CashDropPage");
const SalesReportPage = lazyPage(() => import("./SalesReportPage"), "SalesReportPage");
const StaffPage = lazyPage(() => import("./StaffPage"), "StaffPage");
const PurchaseOrderPage = lazyPage(() => import("../stock/PurchaseOrderPage"), "PurchaseOrderPage");

function LegacyChallengeRedirect({ edit = false }: { edit?: boolean }) {
  const { id = "" } = useParams();
  const { search, hash } = useLocation();
  const to = edit ? paths.management.challengeEdit(id) : paths.management.challengeDetail(id);
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

/** Equipe, Performance, Financeiro e Pedido de compra — Gestor e Gerente. Metas fica em `paths.goals`. */
export const managementRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.management.team, element: <StaffPage /> },
      { path: paths.legacy.management.team, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.legacy.management.shifts, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.legacy.management.staff, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.management.purchaseOrder, element: <PurchaseOrderPage /> },
      { path: paths.legacy.management.purchaseOrder, element: <RedirectTo to={paths.management.purchaseOrder} /> },
      { path: paths.management.cashClose, element: <CashClosePage /> },
      { path: paths.management.wallet, element: <WalletPage /> },
      { path: paths.legacy.management.cashClose, element: <RedirectTo to={paths.management.cashClose} /> },
      { path: paths.management.cashDrop, element: <CashDropPage /> },
      { path: paths.legacy.management.cashDrop, element: <RedirectTo to={paths.management.cashDrop} /> },
      { path: paths.legacy.cashDrop, element: <RedirectTo to={paths.management.cashDrop} /> },
      { path: paths.management.salesReport, element: <SalesReportPage /> },
      { path: paths.legacy.management.salesReport, element: <RedirectTo to={paths.management.salesReport} /> },
      { path: paths.management.challenges, element: <ChallengesPage /> },
      { path: paths.management.challengeNew, element: <ChallengeEditorPage /> },
      { path: `${paths.management.challenges}/:id/edit`, element: <ChallengeEditorPage /> },
      { path: `${paths.management.challenges}/:id`, element: <ChallengeDetailPage /> },
      { path: paths.legacy.management.challenges, element: <RedirectTo to={paths.management.challenges} /> },
      { path: `${paths.legacy.management.challenges}/new`, element: <RedirectTo to={paths.management.challengeNew} /> },
      { path: `${paths.legacy.management.challenges}/:id/edit`, element: <LegacyChallengeRedirect edit /> },
      { path: `${paths.legacy.management.challenges}/:id`, element: <LegacyChallengeRedirect /> },
    ],
  },
];
