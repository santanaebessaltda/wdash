import { useEffect, useRef, useState } from "react";

interface Parsed {
  prefix: string;
  suffix: string;
  target: number;
  /** Casas decimais do valor original, preservadas na contagem. */
  casas: number;
  /** Locale used while counting up, inferred from the grouping/decimal marks. */
  locale?: string;
}

/**
 * Split "$84,210" / "3.42%" / "1,284" / "R$ 85.322" / "2,31" / "R$ 1.611,50"
 * into prefix, numeric target and suffix. Infers whether the string uses
 * en-US (comma grouping) or pt-BR (dot grouping, decimal comma) so the
 * count-up keeps the original notation and decimal places.
 */
function parse(value: string | number): Parsed | null {
  const str = String(value);
  const m = str.match(/^(\D*?)([\d.,]+)(.*)$/);
  if (!m) return null;
  const [, prefix, num, suffix] = m;

  const lastComma = num.lastIndexOf(",");
  const lastDot = num.lastIndexOf(".");
  const after = (i: number) => num.length - i - 1;

  // O ultimo separador seguido de 1 ou 2 digitos e decimal; 3 digitos e agrupador.
  let decimalSep: "," | "." | null = null;
  if (lastComma > lastDot && lastComma !== -1 && after(lastComma) <= 2) decimalSep = ",";
  else if (lastDot > lastComma && lastDot !== -1 && after(lastDot) <= 2) decimalSep = ".";

  const groupSeparator = decimalSep === "," ? "." : decimalSep === "." ? "," : lastComma !== -1 ? "," : lastDot !== -1 ? "." : null;
  const withoutGroup = groupSeparator ? num.split(groupSeparator).join("") : num;
  const cru = decimalSep === "," ? withoutGroup.replace(",", ".") : withoutGroup;
  const target = parseFloat(cru);
  if (Number.isNaN(target)) return null;

  const casas = decimalSep ? after(decimalSep === "," ? lastComma : lastDot) : 0;
  const locale = groupSeparator === "." || decimalSep === "," ? "pt-BR" : groupSeparator === "," || decimalSep === "." ? "en-US" : undefined;
  return { prefix, suffix, target, casas, locale };
}

const prefersReduced =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Counts up from 0 to a numeric value on mount, preserving the original
 * currency prefix, %/unit suffix, decimal precision and thousands separators.
 * Non-numeric values (e.g. "N/A") render unchanged.
 */
export function AnimatedNumber({
  value,
  duration = 1100,
  once = false,
  className,
  secret = false,
}: {
  value: string | number;
  duration?: number;
  /** Conta só na primeira vez. Nas seguintes, o número troca direto. */
  once?: boolean;
  className?: string;
  /** O placar borra este número até segurarem o olho. */
  secret?: boolean;
}) {
  const parsed = parse(value);
  const played = useRef(false);
  const [display, setDisplay] = useState(() =>
    parsed && !prefersReduced ? format(parsed, 0) : String(value),
  );
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!parsed || prefersReduced || (once && played.current)) {
      setDisplay(String(value));
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(format(parsed, parsed.target * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else played.current = true;
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, once]);

  return (
    <span className={className} {...(secret ? { "data-secret": "" } : {})}>
      {display}
    </span>
  );
}

function format(p: Parsed, n: number): string {
  const num = n.toLocaleString(p.locale, { minimumFractionDigits: p.casas, maximumFractionDigits: p.casas });
  return `${p.prefix}${num}${p.suffix}`;
}
