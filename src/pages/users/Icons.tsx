/** Small inline feather-style icon set shared by the Users & Access and
 * Projects pages, matching the stroke-icon convention used elsewhere in the app. */
export function Icon({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "shrink-0"}
    >
      <path d={d} />
    </svg>
  );
}

export const icons = {
  arrowLeft: "M19 12H5M12 5l-7 7 7 7",
  chevronRight: "m9 18 6-6-6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  pencil: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35",
  dots: "M5 12a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM12 12a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM19 12a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  mail: "M4 4h16v16H4zM4 6l8 7 8-7",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  calendar: "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18",
} as const;
