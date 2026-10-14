import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";
import { RequireRole } from "@/session/RequireSession";
import { OWNER_ROLES } from "@/layout/nav-wedash";

const DocumentsPage = lazyPage(() => import("./DocumentsPage"), "DocumentsPage");

export const documentRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={OWNER_ROLES} />,
    children: [
      { path: paths.documents, element: <DocumentsPage /> },
      { path: paths.documentBatches, element: <RedirectTo to={paths.documents} /> },
    ],
  },
];
