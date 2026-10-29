/** Saudação por horário do dia (pt-BR), no estilo Néctar. */
export function dayGreeting(now = new Date()): "BOM DIA" | "BOA TARDE" | "BOA NOITE" {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "BOM DIA";
  if (h >= 12 && h < 18) return "BOA TARDE";
  return "BOA NOITE";
}

/** Primeiro nome do Gestor a partir do nome completo da sessão. */
export function firstNameFrom(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || "Gestor";
}

/** Fala inicial ao abrir conversa por voz (estilo Néctar — vírgula vocativa). */
export function voiceStandbyLine(firstName: string): string {
  const name = firstName.trim() || "Gestor";
  return `JARVIS à disposição, ${name}.`;
}

/** Frase de prévia na Configuração da VOZ. */
export function voicePreviewLine(firstName: string): string {
  const name = firstName.trim() || "Gestor";
  return `Eu sou o JARVIS, ${name}.`;
}
