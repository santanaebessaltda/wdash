import type { RouteObject } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";
import { paths } from "@/router/paths";
import { RedirectTo } from "@/router/RedirectTo";

const HelpPage = lazyPage(() => import("./HelpPage"), "HelpPage");
const HelpVideoPage = lazyPage(() => import("./HelpVideoPage"), "HelpVideoPage");

export const helpRoutes: RouteObject[] = [
  { path: paths.help, element: <HelpPage /> },
  { path: `${paths.help}/:id`, element: <HelpVideoPage /> },
  { path: paths.legacy.help, element: <RedirectTo to={paths.help} /> },
];
