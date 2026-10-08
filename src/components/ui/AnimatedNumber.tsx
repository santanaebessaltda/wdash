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

  const ultimaVirgula = num.lastIndexOf(",");
  const ultimoPonto = num.lastIndexOf(".");
  const depoisDe = (i: number) => num.length - i - 1;

  // O ultimo separador seguido de 1 ou 2 digitos e decimal; 3 digitos e agrupador.
  let decimalSep: "," | "." | null = null;
  if (ultimaVirgula > ultimoPonto && ultimaVirgula !== -1 && depoisDe(ultimaVirgula) <= 2) decimalSep = ",";
  else if (ultimoPonto > ultimaVirgula && ultimoPonto !== -1 && depoisDe(ultimoPonto) <= 2) decimalSep = ".";

  const grupoSep = decimalSep === "," ? "." : decimalSep === "." ? "," : ultimaVirgula !== -1 ? "," : ultimoPonto !== -1 ? "." : null;
  const semGrupo = grupoSep ? num.split(grupoSep).join("") : num;
  const cru = decimalSep === "," ? semGrupo.replace(",", ".") : semGrupo;
  const target = parseFloat(cru);
  if (Number.isNaN(target)) return null;

  const casas = decimalSep ? depoisDe(decimalSep === "," ? ultimaVirgula : ultimoPonto) : 0;
  const locale = grupoSep === "." || decimalSep === "," ? "pt-BR" : grupoSep === "," || decimalSep === "." ? "en-US" : undefined;
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
  className,
}: {
  value: string | number;
  duration?: number;
  className?: string;
}) {
  const parsed = parse(value);
  const [display, setDisplay] = useState(() =>
    parsed && !prefersReduced ? format(parsed, 0) : String(value),
  );
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!parsed || prefersReduced) {
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
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}

function format(p: Parsed, n: number): string {
  const num = n.toLocaleString(p.locale, { minimumFractionDigits: p.casas, maximumFractionDigits: p.casas });
  return `${p.prefix}${num}${p.suffix}`;
}
