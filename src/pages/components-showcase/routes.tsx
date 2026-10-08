import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { paths } from "@/router/paths";
const ComponentsShowcasePage = lazyPage(() => import("./ComponentsShowcasePage"), "ComponentsShowcasePage");

/**
 * The 20 showcase sub-pages (buttons, alerts, cards, modals, tabs, accordions,
 * avatars, badges, breadcrumbs, dropdowns, pagination, progress, tooltips,
 * popovers, toasts, timeline, ratings, carousel, offcanvas, loaders,
 * empty-states) are one dynamic route reading the :tab param, not 20
 * separate route entries  -  see pages/components-showcase/ComponentsShowcasePage.
 */
export const componentsShowcaseRoutes: RouteObject[] = [
  { path: paths.components.root, element: <Navigate to={paths.components.tab("buttons")} replace /> },
  { path: paths.components.tab(":tab"), element: <ComponentsShowcasePage /> },
];
