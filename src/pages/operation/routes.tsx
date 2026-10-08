import { Navigate, type RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { GESTOR_ROLES } from "@/layout/nav-wedash";

const StorePage = lazyPage(() => import("./StorePage"), "StorePage");
const FranchisePage = lazyPage(() => import("./FranchisePage"), "FranchisePage");
const RentPage = lazyPage(() => import("./RentPage"), "RentPage");
const ProductsTaxesPage = lazyPage(() => import("./ProductsTaxesPage"), "ProductsTaxesPage");
const AcquirersPage = lazyPage(() => import("../cash-close/AcquirersPage"), "AcquirersPage");
const ShiftsPage = lazyPage(() => import("../management/ShiftsPage"), "ShiftsPage");
const StaffPage = lazyPage(() => import("../management/StaffPage"), "StaffPage");

/** Operação: Gestor e Gerente. Custos: só Gestor. */
export const operationRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.operation.store, element: <StorePage /> },
      { path: paths.operation.groups, element: <ShiftsPage /> },
      { path: paths.operation.sellers, element: <StaffPage /> },
    ],
  },
  {
    element: <RequireRole roles={GESTOR_ROLES} />,
    children: [
      { path: paths.operation.costs, element: <Navigate to={paths.operation.franchise} replace /> },
      { path: paths.operation.franchise, element: <FranchisePage /> },
      { path: paths.operation.rent, element: <RentPage /> },
      { path: paths.operation.productsTaxes, element: <ProductsTaxesPage /> },
      { path: paths.operation.acquirers, element: <AcquirersPage /> },
    ],
  },
];
