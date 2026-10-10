/** No PWA do iPhone, 100dvh fica mais curto que a tela e corta o rodapé. */
function instalado(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function aplicarAlturaDaTela(): void {
  const visual = window.visualViewport;
  const altura = Math.max(window.innerHeight, visual ? visual.height + visual.offsetTop : 0);
  document.documentElement.style.setProperty("--tela", `${Math.round(altura)}px`);
  document.documentElement.classList.toggle("app-instalado", instalado());
}

export function installViewportHeight(): void {
  aplicarAlturaDaTela();
  window.addEventListener("resize", aplicarAlturaDaTela);
  window.addEventListener("orientationchange", aplicarAlturaDaTela);
  window.visualViewport?.addEventListener("resize", aplicarAlturaDaTela);
}
