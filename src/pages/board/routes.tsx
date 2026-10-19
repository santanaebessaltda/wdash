import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";

const BoardPage = lazyPage(() => import("./BoardPage"), "BoardPage");

export const boardRoutes: RouteObject[] = [
  {
    element: <RequireRole roles={["OWNER", "MANAGER", "ADMIN_GLOBAL"]} />,
    children: [{ path: paths.board, element: <BoardPage /> }],
  },
];
