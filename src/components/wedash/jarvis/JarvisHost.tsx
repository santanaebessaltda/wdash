import { VoiceSession } from "./VoiceSession";

/**
 * Overlay de conversa por voz.
 * Palmas / modal de mic na entrada ficam off — voz e REC só pelos botões do Chat IA.
 */
export function JarvisHost() {
  return <VoiceSession />;
}
