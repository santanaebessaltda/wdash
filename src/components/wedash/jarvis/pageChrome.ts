/** Rola o miolo do AppShell (o `<main>` com overflow). */
export function scrollAppMain(opts?: { top?: number; behavior?: ScrollBehavior }): void {
  if (typeof document === "undefined") return;
  const main = document.querySelector("main");
  if (!main) return;
  main.scrollTo({
    top: opts?.top ?? 0,
    behavior: opts?.behavior ?? "smooth",
  });
}

export type ScrollKind = "top" | "bottom" | "up" | "down";

function mainEl(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector("main");
}

/** Interpreta pedido de rolagem (ex.: “rola a página”, “sobe”, “pro topo”). */
export function scrollKindFromQuestion(question: string): ScrollKind | null {
  const p = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (
    !/rolar|rola\b|scroll|desce|descer|sobe|subir|topo|comeco|final da pagina|fim da pagina|pra baixo|para baixo|pra cima|para cima/.test(
      p,
    )
  ) {
    return null;
  }
  if (/topo|comeco|inicio da pagina|pra cima|para cima|sobe|subir/.test(p) && !/baixo|desce|descer|final|fim/.test(p)) {
    if (/topo|comeco|inicio/.test(p)) return "top";
    return "up";
  }
  if (/final|fim da pagina|pra baixo|para baixo|desce|descer/.test(p)) {
    if (/final|fim/.test(p)) return "bottom";
    return "down";
  }
  // “rolar a página” sem direção → um passo pra baixo.
  return "down";
}

export function looksLikeScroll(question: string): boolean {
  return scrollKindFromQuestion(question) !== null;
}

/** Aplica a rolagem na tela. Retorna o tipo ou null se não for pedido de scroll. */
export function applyScrollFromQuestion(question: string): ScrollKind | null {
  const kind = scrollKindFromQuestion(question);
  if (!kind) return null;
  const main = mainEl();
  if (!main) return kind;
  const step = Math.max(280, Math.floor(main.clientHeight * 0.75));
  const behavior: ScrollBehavior = "smooth";
  if (kind === "top") {
    main.scrollTo({ top: 0, behavior });
  } else if (kind === "bottom") {
    main.scrollTo({ top: main.scrollHeight, behavior });
  } else if (kind === "up") {
    main.scrollBy({ top: -step, behavior });
  } else {
    main.scrollBy({ top: step, behavior });
  }
  return kind;
}

export function formatScrollReply(kind: ScrollKind): string {
  switch (kind) {
    case "top":
      return "Pronto — subi pro topo.";
    case "bottom":
      return "Pronto — fui pro final da página.";
    case "up":
      return "Pronto — subi um pouco.";
    default:
      return "Pronto — rolei a página pra baixo.";
  }
}
