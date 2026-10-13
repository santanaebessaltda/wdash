import { Navigate, useLocation } from "react-router-dom";

/** Troca o caminho e mantém a query (filial, cópia de meta). */
export function RedirectTo({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
