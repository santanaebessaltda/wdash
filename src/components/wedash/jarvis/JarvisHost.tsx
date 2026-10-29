import { useEffect, useRef } from "react";
import { isOwner } from "@/layout/nav-wedash";
import { useSession } from "@/session/SessionProvider";
import { startClapDetector, type ClapDetectorHandle } from "./clapDetector";
import { isJarvisDesktop } from "./desktop";
import { useJarvis } from "./JarvisProvider";
import { VoiceSession } from "./VoiceSession";

/** Palmas no desktop abrem o mesmo modo voz do botão de onda. */
function DesktopClapBridge() {
  const { session } = useSession();
  const { allowed, voiceOpen, openVoice } = useJarvis();
  const clapRef = useRef<ClapDetectorHandle | null>(null);
  const voiceOpenRef = useRef(voiceOpen);
  voiceOpenRef.current = voiceOpen;

  useEffect(() => {
    if (!allowed || !session || !isOwner(session.role) || !isJarvisDesktop()) return;
    if (voiceOpen) {
      clapRef.current?.stop();
      clapRef.current = null;
      return;
    }

    let cancelled = false;
    void startClapDetector(
      () => {
        if (voiceOpenRef.current) return;
        openVoice();
      },
      { threshold: 0.28, minGapMs: 100, maxGapMs: 1100, cooldownMs: 2000 },
    ).then((handle) => {
      if (cancelled || !handle) return;
      if (voiceOpenRef.current) {
        handle.stop();
        return;
      }
      clapRef.current = handle;
    });

    return () => {
      cancelled = true;
      clapRef.current?.stop();
      clapRef.current = null;
    };
  }, [allowed, openVoice, session, voiceOpen]);

  return null;
}

/** Overlay de voz + palmas (desktop). Provider fica no AppShell. Sem FAB. */
export function JarvisHost() {
  const { session } = useSession();
  if (!session || !isOwner(session.role)) return null;

  return (
    <>
      <DesktopClapBridge />
      <VoiceSession />
    </>
  );
}
