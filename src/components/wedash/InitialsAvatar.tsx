const CORES_RANK = ["var(--ok)", "var(--info)", "var(--warn)", "var(--acc)", "var(--bad)"];

/** Quadrado com as iniciais do nome, na cor da posicao na lista  -  avatar das listas de produtos e da equipe. */
export function AvatarIniciais({ nome, idx }: { nome: string; idx: number }) {
  const iniciais = nome.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  const cor = CORES_RANK[idx % CORES_RANK.length];
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[13px] font-extrabold"
      style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}
    >
      {iniciais || "?"}
    </span>
  );
}
