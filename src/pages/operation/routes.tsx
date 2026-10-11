import { Navigate, type RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { GESTOR_ROLES } from "@/layout/nav-wedash";

const FilialPage = lazyPage(() => import("./FilialPage"), "FilialPage");
const ProductsTaxesPage = lazyPage(() => import("./ProductsTaxesPage"), "ProductsTaxesPage");
const AcquirersPage = lazyPage(() => import("../cash-close/AcquirersPage"), "AcquirersPage");
const StaffPage = lazyPage(() => import("../management/StaffPage"), "StaffPage");

/** Vendedores: Gestor e Gerente. Configurações: só Gestor. */
export const operationRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.operation.groups, element: <Navigate to={paths.operation.sellers} replace /> },
      { path: paths.operation.sellers, element: <StaffPage /> },
    ],
  },
  {
    element: <RequireRole roles={GESTOR_ROLES} />,
    children: [
      { path: paths.operation.filial, element: <FilialPage /> },
      { path: paths.operation.costs, element: <Navigate to={paths.operation.filial} replace /> },
      { path: paths.operation.store, element: <Navigate to={paths.operation.filial} replace /> },
      { path: paths.operation.franchise, element: <Navigate to={paths.operation.filial} replace /> },
      { path: paths.operation.rent, element: <Navigate to={paths.operation.filial} replace /> },
      { path: paths.operation.productsTaxes, element: <ProductsTaxesPage /> },
      { path: paths.operation.acquirers, element: <AcquirersPage /> },
    ],
  },
];
