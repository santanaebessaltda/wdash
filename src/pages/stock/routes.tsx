import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";
import { InventoryPage } from "./InventoryPage";
/* Estoque sync — cabeçalho na hora; só a tabela em skeleton (igual ao Dashboard). */

/** Estoque — Gestor e Gerente. O pedido de compra é item direto do menu. */
export const stockRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [
      { path: paths.stock.inventory, element: <InventoryPage /> },
      { path: paths.stock.legacyInventory, element: <RedirectTo to={paths.stock.inventory} /> },
      { path: paths.stock.purchaseOrder, element: <RedirectTo to={paths.management.purchaseOrder} /> },
      { path: paths.stock.saleTables, element: <RedirectTo to={paths.stock.inventory} /> },
      { path: paths.stock.products, element: <RedirectTo to={paths.stock.inventory} /> },
    ],
  },
];
