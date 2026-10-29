import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { paths } from "@/router/paths";

/** /chat-ia e /jarvis redirecionam — o Chat IA é o botão flutuante no AppShell. */
export const jarvisRoutes: RouteObject[] = [
  { path: paths.jarvis, element: <Navigate to={paths.overview} replace /> },
  { path: paths.legacy.jarvis, element: <Navigate to={paths.overview} replace /> },
];
