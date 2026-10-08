import { Navigate, type RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";

/** Ao vivo saiu do produto. As URLs antigas abrem a Visao geral. */
const toOverview = <Navigate to={paths.overview} replace />;

export const aoVivoRoutes: RouteObject[] = [
  paths.live.root,
  paths.live.share,
  paths.live.tv,
  paths.legacy.live.root,
  paths.legacy.live.share,
  paths.legacy.live.tv,
].map((path) => ({ path, element: toOverview }));
