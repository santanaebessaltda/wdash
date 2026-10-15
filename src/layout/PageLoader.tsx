import { Skeleton } from "@/components/ui/Skeleton";

/** Fallback da troca de tela: o skeleton da página, sem spinner antes. */
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="mt-2 h-3.5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-80 w-full rounded-xl" />
    </div>
  );
}
