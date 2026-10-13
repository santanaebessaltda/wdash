import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";
import { OWNER_ROLES } from "@/layout/nav-wedash";

/** URLs antigas. Configurações abre em `/settings`. Equipe abre em Gestão. */
export const operationRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.operation.groups, element: <RedirectTo to={paths.management.team} /> },
      { path: paths.operation.sellers, element: <RedirectTo to={paths.management.team} /> },
    ],
  },
  {
    element: <RequireRole roles={OWNER_ROLES} />,
    children: [
      { path: paths.legacy.operationBranch, element: <RedirectTo to={paths.operation.branch} /> },
      { path: paths.legacy.branch, element: <RedirectTo to={paths.operation.branch} /> },
      { path: paths.operation.costs, element: <RedirectTo to={paths.operation.branch} /> },
      { path: paths.operation.store, element: <RedirectTo to={paths.operation.branch} /> },
      { path: paths.operation.franchise, element: <RedirectTo to={paths.operation.branch} /> },
      { path: paths.operation.rent, element: <RedirectTo to={paths.operation.branch} /> },
      { path: paths.legacy.operationProductsTaxes, element: <RedirectTo to={paths.operation.productsTaxes} /> },
      { path: paths.legacy.operationAcquirers, element: <RedirectTo to={paths.operation.acquirers} /> },
      { path: paths.legacy.operationShopping, element: <RedirectTo to={paths.operation.shopping} /> },
    ],
  },
];
