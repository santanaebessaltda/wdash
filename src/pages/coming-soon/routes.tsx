import { Navigate, type RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { SellerHomePage } from "@/pages/seller/SellerHomePage";

/** URLs antigas que nao tem mais tela. */
export const emBreveRoutes: RouteObject[] = [
  { path: paths.analytics, element: <Navigate to={paths.overview} replace /> },
  { path: paths.legacy.analytics, element: <Navigate to={paths.overview} replace /> },
  { path: paths.legacy.settings.root, element: <Navigate to={paths.settings.stores} replace /> },
  { path: paths.legacy.settings.challenges, element: <Navigate to={paths.management.challenges} replace /> },
  { path: paths.legacy.settings.staff, element: <Navigate to={paths.operation.sellers} replace /> },
  { path: paths.settings.groups, element: <Navigate to={paths.operation.groups} replace /> },
  { path: paths.legacy.settings.groups, element: <Navigate to={paths.operation.groups} replace /> },
  { path: paths.legacy.settings.shifts, element: <Navigate to={paths.operation.groups} replace /> },
  { path: paths.settings.messages, element: <Navigate to={paths.profile} replace /> },
  { path: paths.legacy.settings.messages, element: <Navigate to={paths.profile} replace /> },
  { path: paths.settings.documents, element: <Navigate to={paths.profile} replace /> },
  { path: paths.legacy.settings.documents, element: <Navigate to={paths.profile} replace /> },
  { path: paths.legacy.settings.costs, element: <Navigate to={paths.operation.franchise} replace /> },
  { path: "/configuracoes/marca", element: <Navigate to={paths.settings.stores} replace /> },
  { path: "/settings/brand", element: <Navigate to={paths.settings.stores} replace /> },
  { path: paths.legacy.settings.erp, element: <Navigate to={paths.settings.erp} replace /> },
  { path: paths.legacy.settings.stores, element: <Navigate to={paths.settings.stores} replace /> },
  { path: paths.legacy.settings.users, element: <Navigate to={paths.settings.users} replace /> },
  { path: paths.settings.challenges, element: <Navigate to={paths.management.challenges} replace /> },
  { path: paths.settings.staff, element: <Navigate to={paths.operation.sellers} replace /> },
  { path: paths.settings.costs, element: <Navigate to={paths.operation.franchise} replace /> },
  { path: paths.legacy.profile, element: <Navigate to={paths.profile} replace /> },
  {
    element: <RequireRole roles={["SELLER"]} />,
    children: [
      { path: paths.seller.home, element: <SellerHomePage /> },
      { path: paths.seller.myGoal, element: <Navigate to={paths.seller.home} replace /> },
      { path: paths.legacy.seller.myGoal, element: <Navigate to={paths.seller.home} replace /> },
      { path: paths.seller.tasks, element: <Navigate to={paths.seller.home} replace /> },
      { path: paths.legacy.seller.tasks, element: <Navigate to={paths.seller.home} replace /> },
      { path: paths.seller.ranking, element: <Navigate to={paths.seller.home} replace /> },
    ],
  },
];
