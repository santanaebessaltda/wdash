import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { GESTOR_ROLES } from "@/layout/nav-wedash";

const SettingsPage = lazyPage(() => import("./SettingsPage"), "SettingsPage");
const WedashSettingsLayout = lazyPage(() => import("./WedashSettingsLayout"), "WedashSettingsLayout");
const StoresSettingsPage = lazyPage(() => import("./StoresSettingsPage"), "StoresSettingsPage");
const ErpIntegrationPage = lazyPage(() => import("./ErpIntegrationPage"), "ErpIntegrationPage");
const SyncLogsPage = lazyPage(() => import("./SyncLogsPage"), "SyncLogsPage");
const StoreDetailPage = lazyPage(() => import("./StoreDetailPage"), "StoreDetailPage");
const SystemUsersPage = lazyPage(() => import("./SystemUsersPage"), "SystemUsersPage");
const MyProfilePage = lazyPage(() => import("./MyProfilePage"), "MyProfilePage");
const NotificationsPage = lazyPage(() => import("./NotificationsPage"), "NotificationsPage");
/**
 * WDash: /settings  ->  Lojas; /settings/stores | /settings/erp com TabNav + sidebar.
 * Vela template: /settings/:tab (general, company, ...) no SettingsPage.
 * Rotas WDash registradas antes do :tab para nao colidir.
 */
export const settingsRoutes: RouteObject[] = [
  { path: paths.settings.root, element: <Navigate to={paths.settings.stores} replace /> },
  { path: "/settings/products", element: <Navigate to={paths.settings.stores} replace /> },
  {
    element: <WedashSettingsLayout />,
    children: [
      { path: paths.profile, element: <MyProfilePage /> },
      { path: paths.settings.notifications, element: <NotificationsPage /> },
      { path: paths.settings.stores, element: <StoresSettingsPage /> },
      {
        element: <RequireRole roles={GESTOR_ROLES} />,
        children: [
          { path: paths.settings.users, element: <SystemUsersPage /> },
          { path: paths.settings.erp, element: <ErpIntegrationPage /> },
          { path: paths.settings.logs, element: <SyncLogsPage /> },
        ],
      },
    ],
  },
  { path: paths.settings.storeDetail(":id"), element: <StoreDetailPage /> },
  { path: paths.settings.tab(":tab"), element: <SettingsPage /> },
];
