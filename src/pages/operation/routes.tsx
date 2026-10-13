import { Navigate, type RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";
import { GESTOR_ROLES } from "@/layout/nav-wedash";

const BranchPage = lazyPage(() => import("./BranchPage"), "BranchPage");
const ProductsTaxesPage = lazyPage(() => import("./ProductsTaxesPage"), "ProductsTaxesPage");
const AcquirersPage = lazyPage(() => import("../cash-close/AcquirersPage"), "AcquirersPage");
const ShoppingPage = lazyPage(() => import("./ShoppingPage"), "ShoppingPage");

/** Equipe ficou em Gestão. Configurações: só Gestor. */
export const operationRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.operation.groups, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.operation.sellers, element: <RedirectTo to={paths.management.team} /> },
    ],
  },
  {
    element: <RequireRole roles={GESTOR_ROLES} />,
    children: [
      { path: paths.operation.branch, element: <BranchPage /> },
      { path: paths.legacy.branch, element: <Navigate to={paths.operation.branch} replace /> },
      { path: paths.operation.costs, element: <Navigate to={paths.operation.branch} replace /> },
      { path: paths.operation.store, element: <Navigate to={paths.operation.branch} replace /> },
      { path: paths.operation.franchise, element: <Navigate to={paths.operation.branch} replace /> },
      { path: paths.operation.rent, element: <Navigate to={paths.operation.branch} replace /> },
      { path: paths.operation.productsTaxes, element: <ProductsTaxesPage /> },
      { path: paths.operation.acquirers, element: <AcquirersPage /> },
      { path: paths.operation.shopping, element: <ShoppingPage /> },
    ],
  },
];
