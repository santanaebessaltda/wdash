import { Navigate, useLocation, useParams, type RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { OWNER_ROLES } from "@/layout/nav-wedash";
import { RequireRole } from "@/session/RequireSession";
import { StaffPage } from "./StaffPage";
import { SchedulePage } from "./SchedulePage";
import { PurchaseOrderPage } from "../stock/PurchaseOrderPage";
import { ChallengesPage } from "./ChallengesPage";
import { CashClosePage } from "../cash-close/CashClosePage";
import WalletPage from "../wallet/WalletPage";
import { CashDropPage } from "./CashDropPage";
import { SalesReportPage } from "./SalesReportPage";
/* Gestão sync (Equipe, Escala, Pedido, Performance, Financeiro) — cabeçalho na hora; só o conteúdo em skeleton. */

const ChallengeDetailPage = lazyPage(() => import("../challenges/ChallengeDetailPage"), "default");
const ChallengeEditorPage = lazyPage(() => import("../challenges/ChallengeEditorPage"), "default");

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
      { path: paths.management.schedule, element: <SchedulePage /> },
      { path: paths.legacy.management.team, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.legacy.management.shifts, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.legacy.management.staff, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.management.cashClose, element: <CashClosePage /> },
      { path: paths.management.wallet, element: <WalletPage /> },
      { path: paths.legacy.management.cashClose, element: <RedirectTo to={paths.management.cashClose} /> },
      { path: paths.management.cashDrop, element: <CashDropPage /> },
      { path: paths.legacy.management.cashDrop, element: <RedirectTo to={paths.management.cashDrop} /> },
      { path: paths.legacy.cashDrop, element: <RedirectTo to={paths.management.cashDrop} /> },
      { path: paths.management.salesReport, element: <SalesReportPage /> },
      { path: paths.legacy.management.salesReport, element: <RedirectTo to={paths.management.salesReport} /> },
      { path: paths.management.challenges, element: <ChallengesPage /> },
      { path: `${paths.management.challenges}/:id`, element: <ChallengeDetailPage /> },
      { path: paths.legacy.management.challenges, element: <RedirectTo to={paths.management.challenges} /> },
      { path: `${paths.legacy.management.challenges}/new`, element: <RedirectTo to={paths.management.challengeNew} /> },
      { path: `${paths.legacy.management.challenges}/:id/edit`, element: <LegacyChallengeRedirect edit /> },
      { path: `${paths.legacy.management.challenges}/:id`, element: <LegacyChallengeRedirect /> },
    ],
  },
  {
    element: <RequireRole roles={OWNER_ROLES} />,
    children: [
      { path: paths.management.purchaseOrder, element: <PurchaseOrderPage /> },
      { path: paths.legacy.management.purchaseOrder, element: <RedirectTo to={paths.management.purchaseOrder} /> },
      { path: paths.management.challengeNew, element: <ChallengeEditorPage /> },
      { path: `${paths.management.challenges}/:id/edit`, element: <ChallengeEditorPage /> },
    ],
  },
];
