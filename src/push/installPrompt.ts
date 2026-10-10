/**
 * O Chrome, o Edge e o Chrome no Android avisam quando a página pode virar app.
 * O iPhone não dispara este evento: lá a instalação continua manual.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function installPromptDisponivel(): boolean {
  return deferred != null;
}

export function ouvirInstallPrompt(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export async function pedirInstalacao(): Promise<boolean> {
  const atual = deferred;
  if (!atual) return false;
  deferred = null;
  listeners.forEach((fn) => fn());
  await atual.prompt();
  const choice = await atual.userChoice;
  return choice.outcome === "accepted";
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
}
