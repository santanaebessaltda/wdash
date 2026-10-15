import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { PageLoader } from "./PageLoader";

/** Wraps auth/error/maintenance pages, which render without the sidebar/topbar shell
 *  (mirrors the source prototype's `showShell` flag). */
export function AuthLayout() {
  return (
    <div className="tela-cheia w-full bg-bg-0 text-t0">
      <Suspense fallback={<PageLoader variant="auth" />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
