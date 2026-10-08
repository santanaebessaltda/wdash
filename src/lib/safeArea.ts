import type { CSSProperties } from "react";

/**
 * Espacamento que respeita as areas ocupadas pelo sistema no celular:
 * barra de status no topo e barra de gestos na base.
 *
 * Usar junto das classes `pad-topo`, `pad-base` ou `pos-base` (definidas em
 * index.css). O valor informado aqui e o espacamento normal do elemento; o
 * acrescimo da area do sistema e somado pelo CSS, e so onde o navegador
 * suporta env(). Onde nao suporta, fica o espacamento normal.
 */
export function padTopo(base: string): CSSProperties {
  return { "--pad-topo": base } as CSSProperties;
}

export function padBase(base: string): CSSProperties {
  return { "--pad-base": base } as CSSProperties;
}

export function posBase(base: string): CSSProperties {
  return { "--pos-base": base } as CSSProperties;
}

/** Combina espacamento de topo e base num unico objeto de estilo. */
export function padTopoEBase(topo: string, base: string): CSSProperties {
  return { "--pad-topo": topo, "--pad-base": base } as CSSProperties;
}
