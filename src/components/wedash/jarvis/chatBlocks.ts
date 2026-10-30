/**
 * Quebra resposta do JARVIS em bolhas curtas (bate-papo humanizado).
 * Preferir `\n\n` como separador explícito; senão corta por frase.
 */
export function splitJarvisReply(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const byPara = raw
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (byPara.length > 1) return byPara.flatMap((p) => splitLongParagraph(p));

  return splitLongParagraph(byPara[0] ?? raw);
}

function splitLongParagraph(p: string): string[] {
  if (p.length <= 160) return [p];
  // Só quebra em ". "/"! "/"? " (espaço depois) — preserva 270.000 e R$ 1.234,56.
  const sentences = p
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    const mid = Math.floor(p.length / 2);
    const cut = p.lastIndexOf(" ", mid);
    if (cut > 40) return [p.slice(0, cut).trim(), p.slice(cut).trim()].filter(Boolean);
    return [p];
  }
  const parts: string[] = [];
  let buf = "";
  for (const sentence of sentences) {
    if (buf && (buf + " " + sentence).length > 160) {
      parts.push(buf);
      buf = sentence;
    } else {
      buf = buf ? `${buf} ${sentence}` : sentence;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Delay entre bolhas — curto o bastante pra fluir, longo o bastante pra “digitando”. */
export function typingDelayMs(block: string): number {
  return Math.min(900, Math.max(280, 220 + block.length * 6));
}
