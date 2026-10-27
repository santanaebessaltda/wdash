import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Fallback do Suspense na troca de rota lazy.
 * Só a área de conteúdo (KPIs/cards) — sem fingir breadcrumb/título/filtros,
 * para não piscar um cabeçalho falso antes da página real montar.
 * As 4 telas do Dashboard entram sync e quase nunca passam por aqui.
 */
export function PageLoader({ variant = "app" }: { variant?: "app" | "auth" }) {
  if (variant === "auth") {
    return (
      <div className="flex min-h-screen items-center justify-center p-10" aria-busy="true" aria-label="Carregando">
        <div className="w-full max-w-[420px] rounded-[22px] border border-line bg-bg-2 p-9">
          <Skeleton className="mx-auto h-10 w-10 rounded-xl" />
          <Skeleton className="mx-auto mt-5 h-5 w-40" />
          <Skeleton className="mx-auto mt-3 h-3 w-56" />
          <Skeleton className="mt-6 h-10 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-80 w-full rounded-xl" />
    </div>
  );
}
