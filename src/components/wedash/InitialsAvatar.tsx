const COLORS_RANK = ["var(--ok)", "var(--info)", "var(--warn)", "var(--acc)", "var(--bad)"];

/** Quadrado com as iniciais do nome, na cor da posicao na lista  -  avatar das listas de produtos e da equipe. */
export function AvatarIniciais({ name, idx, tones }: { name: string; idx: number; tones?: readonly string[] }) {
  const iniciais = name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  const palette = tones && tones.length > 0 ? tones : COLORS_RANK;
  const color = palette[idx % palette.length];
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[13px] font-extrabold"
      style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color: color }}
    >
      {iniciais || "?"}
    </span>
  );
}
