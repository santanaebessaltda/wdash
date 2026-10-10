import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installViewportHeight } from "@/lib/viewportHeight";

installViewportHeight();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", async () => {
      try {
        const registro = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
        // Nova versao instalada: recarrega uma vez para nao ficar com a antiga.
        let recarregando = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (recarregando) return;
          recarregando = true;
          window.location.reload();
        });
        registro.update();
      } catch {
        /* sem service worker: o app funciona igual, so nao instala offline */
      }
    });
  } else {
    // Em desenvolvimento nenhum service worker deve ficar no caminho: um
    // registro antigo serviria a versao anterior do app.
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  }
}
