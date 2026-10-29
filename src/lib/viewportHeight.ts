/** No mobile (browser e PWA), 100dvh pode ficar mais curto que a janela e deixar faixa no rodapé. */
function instalado(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function measureHeight(): number {
  const visual = window.visualViewport;
  const fromVisual = visual ? visual.height + visual.offsetTop : 0;
  return Math.ceil(
    Math.max(window.innerHeight, fromVisual, document.documentElement.clientHeight),
  );
}

function applyViewportHeight(): void {
  const height = measureHeight();
  document.documentElement.style.setProperty("--tela", `${height}px`);
  document.documentElement.classList.toggle("app-instalado", instalado());
}

export function installViewportHeight(): void {
  applyViewportHeight();
  window.addEventListener("resize", applyViewportHeight);
  window.addEventListener("pageshow", applyViewportHeight);
  window.addEventListener("orientationchange", () => {
    applyViewportHeight();
    window.setTimeout(applyViewportHeight, 250);
  });
  window.visualViewport?.addEventListener("resize", applyViewportHeight);
  window.visualViewport?.addEventListener("scroll", applyViewportHeight);
}
