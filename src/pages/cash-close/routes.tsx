import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { paths } from "@/router/paths";

/** URLs antigas do módulo próprio. Adquirentes foi para Configurações; o calendário, para Financeiro. */
export const cashCloseRoutes: RouteObject[] = [
  { path: paths.legacy.settings.cashCloseAcquirers, element: <Navigate to={paths.operation.acquirers} replace /> },
  { path: paths.legacy.settings.cashClose, element: <Navigate to={paths.management.cashClose} replace /> },
];
