import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Nome da filial que abre um bloco. O mesmo tamanho e a mesma cor em todas as telas. */
export function StoreDivisionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[13px] font-bold text-t0 break-words", className)}>{children}</p>;
}
