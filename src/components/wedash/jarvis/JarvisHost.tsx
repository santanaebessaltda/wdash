import { useEffect, useRef, useState } from "react";
import { startClapDetector, type ClapDetectorHandle } from "./clapDetector";
import { isJarvisDesktop } from "./desktop";
import { useJarvis } from "./JarvisProvider";
import { MicPermissionGate } from "./MicPermissionGate";
import { VoiceDock } from "./VoiceDock";

/**
 * Dock de voz global + palma 2× (desktop / Gestor) para abrir conversa por voz.
 * O detector solta o mic enquanto a sessão de voz ou o ditado estão ativos.
 */
export function JarvisHost() {
  const j = useJarvis();
  const clapOk = j.allowed && isJarvisDesktop();
  const [micGranted, setMicGranted] = useState(false);
  const openVoiceRef = useRef(j.openVoice);
  const voiceOpenRef = useRef(j.voiceOpen);
  const dictatingRef = useRef(j.dictating);
  openVoiceRef.current = j.openVoice;
  voiceOpenRef.current = j.voiceOpen;
  dictatingRef.current = j.dictating;

  useEffect(() => {
    if (!clapOk || !micGranted || j.voiceOpen || j.dictating) return;

    let handle: ClapDetectorHandle | null = null;
    let cancelled = false;

    void startClapDetector(
      () => {
        if (voiceOpenRef.current || dictatingRef.current) return;
        openVoiceRef.current({ source: "clap" });
      },
      { threshold: 0.48, minGapMs: 140, maxGapMs: 850, cooldownMs: 2800 },
    ).then((h) => {
      if (cancelled) {
        h?.stop();
        return;
      }
      handle = h;
    });

    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [clapOk, micGranted, j.voiceOpen, j.dictating]);

  return (
    <>
      <MicPermissionGate active={clapOk} onGranted={() => setMicGranted(true)} />
      <VoiceDock />
    </>
  );
}
