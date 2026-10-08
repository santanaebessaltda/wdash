import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";

const Onboarding = lazyPage(() => import("./Onboarding"), "Onboarding");
const SyncingPage = lazyPage(() => import("./SyncingPage"), "SyncingPage");

export const onboardingRoutes: RouteObject[] = [
  { path: paths.onboarding, element: <Onboarding /> },
];

/** Fora do AppShell  -  tela cheia pos-onboarding. */
export const syncingRoutes: RouteObject[] = [
  { path: paths.syncing, element: <SyncingPage /> },
];
