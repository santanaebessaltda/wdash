import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AvatarIniciais } from "./InitialsAvatar";

/** 1 coluna das listas de produto: avatar com iniciais + nome + linha de apoio (codigo, categoria...). */
export function ProductNameCell({
  nome,
  idx,
  sub,
  upper = false,
}: {
  nome: string;
  /** Posicao na lista  -  escolhe a cor do avatar. */
  idx: number;
  /** Texto vira a linha cinza abaixo do nome; elemento entra como esta (ex.: com tooltip). */
  sub?: ReactNode;
  upper?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AvatarIniciais nome={nome} idx={idx} />
      <div className="min-w-0">
        <p className={cn("truncate text-[13px] font-bold text-t0", upper && "uppercase")}>{nome}</p>
        {typeof sub === "string" ? sub && <p className={cn("truncate text-[11px] text-t2", upper && "uppercase")}>{sub}</p> : sub}
      </div>
    </div>
  );
}
