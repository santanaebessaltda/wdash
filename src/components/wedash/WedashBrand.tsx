import { cn } from "@/lib/cn";
import { BrandMark } from "@/pages/auth/authKit";
import { PRODUCT_NAME } from "@/data/wedash/tenant";

/** Marca WDash com o nome ao lado: nome seguido de ponto em destaque. */
export function WedashBrand({ size = 34, showName = true, light = false }: { size?: number; showName?: boolean; light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={size} />
      {showName && (
        <span className={cn("truncate text-[17px] font-extrabold tracking-tight", light ? "text-white" : "text-t0")}>
          {PRODUCT_NAME}
          <span className={light ? "text-acc-2" : "text-acc"}>.</span>
        </span>
      )}
    </span>
  );
}
