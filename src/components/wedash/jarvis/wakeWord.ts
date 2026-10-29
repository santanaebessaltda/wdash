import { containsWakeWord, createSpeechRecognition, stripWakeWord, type SpeechRecognitionLike } from "./speech";

export interface WakeWordHandle {
  stop: () => void;
}

/**
 * Escuta contínua por "JARVIS" / "Ei JARVIS".
 * Melhor no Chromium; se falhar, palmas e botão seguem.
 */
export function startWakeWordListener(onWake: (trailingCommand: string) => void): WakeWordHandle | null {
  const rec = createSpeechRecognition();
  if (!rec) return null;

  let stopped = false;
  let restartTimer = 0;

  const arm = (instance: SpeechRecognitionLike) => {
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = "pt-BR";

    instance.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i];
        if (!row) continue;
        chunk += row[0]?.transcript ?? "";
        if (row.isFinal && containsWakeWord(chunk)) {
          const command = stripWakeWord(chunk);
          onWake(command);
          try {
            instance.abort();
          } catch {
            /* ignore */
          }
          return;
        }
        if (!row.isFinal && containsWakeWord(chunk)) {
          // Wake em interim: dispara cedo para parecer responsivo.
          const command = stripWakeWord(chunk);
          onWake(command);
          try {
            instance.abort();
          } catch {
            /* ignore */
          }
          return;
        }
      }
    };

    instance.onerror = () => {
      scheduleRestart();
    };

    instance.onend = () => {
      scheduleRestart();
    };
  };

  const scheduleRestart = () => {
    if (stopped) return;
    window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(() => {
      if (stopped) return;
      try {
        arm(rec);
        rec.start();
      } catch {
        scheduleRestart();
      }
    }, 400);
  };

  arm(rec);
  try {
    rec.start();
  } catch {
    scheduleRestart();
  }

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(restartTimer);
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    },
  };
}
