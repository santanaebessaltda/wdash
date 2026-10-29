import { useCallback, useEffect, useRef, useState } from "react";
import { isOwner } from "@/layout/nav-wedash";
import { useSession } from "@/session/SessionProvider";
import { startClapDetector, type ClapDetectorHandle } from "./clapDetector";
import { isJarvisDesktop } from "./desktop";
import { useJarvis } from "./JarvisProvider";
import { MicPermissionGate } from "./MicPermissionGate";
import { VoiceSession } from "./VoiceSession";

/** Palmas no desktop abrem o mesmo modo voz do botão de onda. */
function DesktopClapBridge({ micReady }: { micReady: boolean }) {
  const { session } = useSession();
  const { allowed, voiceOpen, openVoice, dictating, dictateBusy } = useJarvis();
  const clapRef = useRef<ClapDetectorHandle | null>(null);
  /** Voz ou ditado ativos — não dispara palma (o pop do mic gerava falso positivo). */
  const occupiedRef = useRef(false);
  occupiedRef.current = voiceOpen || dictating || dictateBusy;

  useEffect(() => {
    if (!micReady || !allowed || !session || !isOwner(session.role) || !isJarvisDesktop()) return;
    if (voiceOpen || dictating || dictateBusy) {
      clapRef.current?.stop();
      clapRef.current = null;
      return;
    }

    let cancelled = false;
    void startClapDetector(
      () => {
        if (occupiedRef.current) return;
        openVoice({ source: "clap" });
      },
      { threshold: 0.28, minGapMs: 100, maxGapMs: 1100, cooldownMs: 2000 },
    ).then((handle) => {
      if (cancelled || !handle) return;
      if (occupiedRef.current) {
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
  }, [allowed, dictateBusy, dictating, micReady, openVoice, session, voiceOpen]);

  return null;
}

/** Overlay de voz + palmas (desktop). Provider fica no AppShell. Sem FAB. */
export function JarvisHost() {
  const { session } = useSession();
  const [micReady, setMicReady] = useState(false);
  const onGranted = useCallback(() => setMicReady(true), []);

  if (!session || !isOwner(session.role)) return null;

  const desktop = isJarvisDesktop();

  return (
    <>
      {desktop ? (
        <MicPermissionGate active onGranted={onGranted} />
      ) : null}
      <DesktopClapBridge micReady={micReady} />
      <VoiceSession />
    </>
  );
}
