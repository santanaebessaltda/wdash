import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/**
 * Modo de impressao (Exportar PDF): tabelas mostram todas as linhas e o titulo
 * da aba vira o nome do arquivo sugerido pelo navegador. O PDF sai no tema
 * claro via `@media print` (index.css) — sem trocar `data-theme` na tela.
 * Vale tambem para o Ctrl+P (listeners instalados no AppShell).
 */

let printing = false;
const listeners = new Set<() => void>();
let restore: (() => void) | null = null;

function setPrinting(value: boolean) {
  if (printing === value) return;
  printing = value;
  flushSync(() => listeners.forEach((l) => l()));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrintMode(): boolean {
  return useSyncExternalStore(subscribe, () => printing, () => false);
}

function enter(fileTitle?: string) {
  if (restore) return;
  const prevTitle = document.title;
  if (fileTitle) document.title = fileTitle;
  restore = () => {
    document.title = prevTitle;
  };
  setPrinting(true);
}

function leave() {
  restore?.();
  restore = null;
  setPrinting(false);
}

/** Liga os eventos do navegador (Ctrl+P tambem entra no modo de impressao). */
export function installPrintMode(): () => void {
  const before = () => enter();
  const after = () => leave();
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  return () => {
    window.removeEventListener("beforeprint", before);
    window.removeEventListener("afterprint", after);
  };
}

/** Nome do arquivo sem caracteres que o Windows recusa. */
function safeFileTitle(parts: string[]): string {
  return parts
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mesmo nome sugerido na impressao: "WDash - {Tela} - {Loja} - {Período}". */
export function reportFileTitle(parts: string[]): string {
  return safeFileTitle(["WDash", ...parts]);
}

/** Abre a janela de impressao com o layout do relatorio (o usuario salva como PDF). */
export function exportPdf(parts: string[]) {
  enter(reportFileTitle(parts));
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}
