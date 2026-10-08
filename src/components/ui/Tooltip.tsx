import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const EDGE = 8;

export function Tooltip({ label, children, side = "top" }: { label: string; children: ReactNode; side?: "top" | "bottom" }) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!show || !triggerRef.current || !tipRef.current) {
      setCoords(null);
      return;
    }

    const place = () => {
      const trigger = triggerRef.current;
      const tip = tipRef.current;
      if (!trigger || !tip) return;

      const t = trigger.getBoundingClientRect();
      const b = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = t.left + t.width / 2 - b.width / 2;
      left = Math.max(EDGE, Math.min(left, vw - b.width - EDGE));

      let top = side === "top" ? t.top - b.height - EDGE : t.bottom + EDGE;
      // Flip se nao couber no lado pedido
      if (side === "top" && top < EDGE) top = t.bottom + EDGE;
      if (side === "bottom" && top + b.height > vh - EDGE) top = t.top - b.height - EDGE;
      top = Math.max(EDGE, Math.min(top, vh - b.height - EDGE));

      setCoords({ top, left });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [show, label, side]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={coords ? { top: coords.top, left: coords.left } : { top: 0, left: 0, visibility: "hidden" }}
            className={cn(
              "pointer-events-none fixed z-[200] w-max max-w-[min(17.5rem,calc(100vw-1rem))] whitespace-pre-line break-words text-left rounded-md bg-bg-3 border border-line px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-t0 shadow-[var(--shadow-vela)] animate-vela-fade",
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
