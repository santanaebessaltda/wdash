/** Small inline stroke-icon primitives (no icon library in this project  -  icons are
 * hand-drawn SVG paths, matching the source prototype's approach). */
export function Icon({ path, size = 20 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export const ICONS = {
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7",
  package: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.27 6.96 12 12l8.73-5.04M12 22.08V12",
  clockCheck: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l3 2",
  alertTriangle: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01",
  route: "M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 9v6a3 3 0 0 0 3 3h6M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  warehouse: "M3 21V9l9-6 9 6v12H3ZM9 21v-6h6v6",
  gauge: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 12l4-4M8 12h8",
} as const;
