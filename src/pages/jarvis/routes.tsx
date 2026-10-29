import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { OWNER_ROLES } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { JarvisPage } from "./JarvisPage";

export const jarvisRoutes: RouteObject[] = [
  { path: paths.legacy.jarvis, element: <Navigate to={paths.jarvis} replace /> },
  {
    element: <RequireRole roles={OWNER_ROLES} />,
    children: [{ path: paths.jarvis, element: <JarvisPage /> }],
  },
];
