/** No mobile (browser e PWA), 100dvh pode ficar mais curto que a janela e deixar faixa no rodapé. */
function instalado(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function applyViewportHeight(): void {
  const visual = window.visualViewport;
  const height = Math.max(window.innerHeight, visual ? visual.height + visual.offsetTop : 0);
  document.documentElement.style.setProperty("--tela", `${Math.round(height)}px`);
  document.documentElement.classList.toggle("app-instalado", instalado());
}

export function installViewportHeight(): void {
  applyViewportHeight();
  window.addEventListener("resize", applyViewportHeight);
  window.addEventListener("orientationchange", applyViewportHeight);
  window.visualViewport?.addEventListener("resize", applyViewportHeight);
}
