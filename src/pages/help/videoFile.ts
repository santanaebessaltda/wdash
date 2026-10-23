/** Capa e duração lidas no aparelho. Se o navegador não conseguir, o vídeo segue sem capa. */

export async function readHelpVideoFile(file: File): Promise<{ durationSec: number | null; poster: Blob | null }> {
  if (typeof document === "undefined") return { durationSec: null, poster: null };
  const url = URL.createObjectURL(file);
  try {
    return await captureHelpVideo(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function captureHelpVideo(url: string, crossOrigin = false): Promise<{ durationSec: number | null; poster: Blob | null }> {
  if (typeof document === "undefined") return Promise.resolve({ durationSec: null, poster: null });
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (crossOrigin) video.crossOrigin = "anonymous";
    video.style.cssText = "position:fixed;left:-9999px;width:320px;height:180px;opacity:0;pointer-events:none";
    document.body.appendChild(video);

    let settled = false;
    let durationSec: number | null = null;
    let timer = 0;
    const finish = (poster: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      resolve({ durationSec, poster });
    };
    const draw = () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
          finish(null);
          return;
        }
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / width);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (frameIsBlank(ctx, canvas.width, canvas.height)) {
          finish(null);
          return;
        }
        canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.82);
      } catch {
        finish(null);
      }
    };
    timer = window.setTimeout(() => finish(null), 15000);
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      durationSec = Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : null;
    };
    video.onloadeddata = () => {
      const target = durationSec != null && durationSec > 0 ? Math.min(1, Math.max(0.2, video.duration * 0.1)) : 0;
      if (target <= 0) {
        draw();
        return;
      }
      let seekTimer = 0;
      const stopSeek = () => {
        window.clearTimeout(seekTimer);
        video.removeEventListener("seeked", onSeeked);
      };
      const onSeeked = () => {
        stopSeek();
        draw();
      };
      seekTimer = window.setTimeout(() => {
        stopSeek();
        draw();
      }, 2500);
      video.addEventListener("seeked", onSeeked);
      try {
        video.currentTime = target;
      } catch {
        stopSeek();
        draw();
      }
    };
    video.src = url;
  });
}

function frameIsBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let lit = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 64) {
    count += 1;
    if (pixels[index] > 18 || pixels[index + 1] > 18 || pixels[index + 2] > 18) lit += 1;
  }
  return count === 0 || lit / count < 0.02;
}
