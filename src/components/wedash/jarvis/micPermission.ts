/** Estado do microfone no site (Permissions API + getUserMedia). */

export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";

const MIC_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function micAudioConstraints(): MediaTrackConstraints {
  return { ...MIC_AUDIO };
}

/** Consulta sem abrir popup. `unknown` se a API não existir (Safari antigo etc.). */
export async function queryMicPermission(): Promise<MicPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "unknown";
  }
}

/**
 * Pede o mic no mesmo gesto do clique. Para as tracks depois —
 * só queremos gravar a permissão para palmas / voz depois.
 */
export async function requestMicAccess(): Promise<"granted" | "denied" | "unavailable"> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: MIC_AUDIO,
      video: false,
    });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return "denied";
    }
    return "unavailable";
  }
}
