import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Nome da filial que abre um bloco. O mesmo tamanho e a mesma cor em todas as telas. */
export function StoreDivisionTitle({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <p className={cn("text-[13px] font-bold text-t2 break-words", className)} title={title}>
      {children}
    </p>
  );
}
