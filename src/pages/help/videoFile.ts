/** Capa e duração lidas no aparelho. Se o navegador não conseguir, o vídeo segue sem capa. */

export async function readHelpVideoFile(file: File): Promise<{ durationSec: number | null; poster: Blob | null }> {
  if (typeof document === "undefined") return { durationSec: null, poster: null };
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;

  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (durationSec: number | null, poster: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.src = "";
      resolve({ durationSec, poster });
    };
    timer = window.setTimeout(() => finish(null, null), 8000);
    video.onerror = () => finish(null, null);
    video.onloadedmetadata = () => {
      const durationSec = Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : null;
      const seekTo = durationSec != null && durationSec > 0 ? Math.min(0.4, video.duration / 2) : 0;
      const capture = () => {
        try {
          const canvas = document.createElement("canvas");
          const width = video.videoWidth || 640;
          const height = video.videoHeight || 360;
          const scale = Math.min(1, 960 / width);
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish(durationSec, null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => finish(durationSec, blob), "image/jpeg", 0.82);
        } catch {
          finish(durationSec, null);
        }
      };
      if (seekTo <= 0) {
        capture();
        return;
      }
      video.onseeked = capture;
      try {
        video.currentTime = seekTo;
      } catch {
        capture();
      }
    };
    video.src = url;
  });
}
