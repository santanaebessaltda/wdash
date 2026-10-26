import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePrintMode } from "@/lib/printMode";

/** Sobe até o elemento que rola na vertical (página ou modal). */
function scrollParent(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start.parentElement;
  while (node) {
    const y = getComputedStyle(node).overflowY;
    if (y === "auto" || y === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Tabela com nome parado no scroll horizontal e cabeçalho parado no scroll vertical.
 * O cabeçalho fica fora da rolagem horizontal e acompanha a página ou o modal.
 */
export function StickyHeadTable({
  tableClassName,
  headClassName,
  minWidth,
  head,
  children,
  syncKey,
}: {
  tableClassName: string;
  headClassName?: string;
  minWidth?: number;
  head: ReactNode;
  children: ReactNode;
  /** Muda quando as linhas mudam, para realinhar as colunas. */
  syncKey?: string | number;
}) {
  const printing = usePrintMode();
  const shellRef = useRef<HTMLDivElement>(null);
  const headScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headRowRef = useRef<HTMLTableRowElement>(null);

  useLayoutEffect(() => {
    if (printing) return;
    const shell = shellRef.current;
    const headScroll = headScrollRef.current;
    const bodyScroll = bodyScrollRef.current;
    const headRow = headRowRef.current;
    if (!shell || !headScroll || !bodyScroll || !headRow) return;

    const align = () => {
      const bodyTable = bodyScroll.querySelector("table");
      const headTable = headScroll.querySelector("table");
      const bodyRow = bodyTable?.querySelector("tbody tr");
      if (!bodyTable || !headTable || !bodyRow) return;
      const width = bodyTable.scrollWidth;
      headTable.style.width = `${width}px`;
      headTable.style.minWidth = `${width}px`;
      const bodyCells = bodyRow.children;
      Array.from(headRow.children).forEach((cell, index) => {
        const source = bodyCells[index] as HTMLElement | undefined;
        if (!source) return;
        const size = source.getBoundingClientRect().width;
        (cell as HTMLElement).style.width = `${size}px`;
        (cell as HTMLElement).style.minWidth = `${size}px`;
        (cell as HTMLElement).style.maxWidth = `${size}px`;
      });
    };

    const pin = () => {
      const scroller = scrollParent(shell);
      if (!scroller) {
        headScroll.style.transform = "";
        return;
      }
      const shellTop = shell.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const delta = scrollerTop - shellTop;
      const max = Math.max(0, shell.offsetHeight - headScroll.offsetHeight);
      const y = Math.min(Math.max(0, delta), max);
      headScroll.style.transform = y > 0 ? `translateY(${y}px)` : "";
    };

    const onBodyScroll = () => {
      headScroll.scrollLeft = bodyScroll.scrollLeft;
    };

    align();
    pin();
    const observer = new ResizeObserver(() => {
      align();
      pin();
    });
    observer.observe(bodyScroll);
    const scroller = scrollParent(shell);
    scroller?.addEventListener("scroll", pin, { passive: true });
    bodyScroll.addEventListener("scroll", onBodyScroll, { passive: true });
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", pin);
      bodyScroll.removeEventListener("scroll", onBodyScroll);
      window.removeEventListener("resize", align);
    };
  }, [printing, syncKey]);

  const tableStyle = minWidth ? { minWidth } : undefined;

  if (printing) {
    return (
      <div className="min-w-0 overflow-x-auto">
        <table className={tableClassName} style={tableStyle}>
          <thead>
            <tr className={headClassName}>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    );
  }

  return (
    <div ref={shellRef} className="relative min-w-0">
      <div ref={headScrollRef} className="relative z-30 overflow-hidden bg-bg-2">
        <table className={cn(tableClassName, "table-fixed")} style={tableStyle}>
          <thead>
            <tr ref={headRowRef} className={headClassName}>
              {head}
            </tr>
          </thead>
        </table>
      </div>
      <div ref={bodyScrollRef} className="overflow-x-auto">
        <table className={tableClassName} style={tableStyle}>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
