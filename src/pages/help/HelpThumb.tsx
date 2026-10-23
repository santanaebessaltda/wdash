import { useEffect, useRef, useState } from "react";
import { captureHelpVideo } from "./videoFile";

export function HelpThumb({
  posterUrl,
  clipUrl,
  onCapture,
}: {
  posterUrl: string | null;
  clipUrl: string | null;
  onCapture?: (poster: Blob, durationSec: number | null) => void;
}) {
  const [frame, setFrame] = useState<string | null>(posterUrl);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  useEffect(() => {
    setFrame(posterUrl);
  }, [posterUrl]);

  useEffect(() => {
    if (posterUrl || !clipUrl) return;
    let cancel = false;
    void captureHelpVideo(clipUrl, true).then((result) => {
      if (cancel || !result.poster) return;
      setFrame(URL.createObjectURL(result.poster));
      onCaptureRef.current?.(result.poster, result.durationSec);
    });
    return () => {
      cancel = true;
    };
  }, [clipUrl, posterUrl]);

  if (frame) return <img src={frame} alt="" className="h-full w-full object-cover" />;
  if (clipUrl) {
    return (
      <video
        src={clipUrl}
        muted
        playsInline
        preload="auto"
        className="pointer-events-none h-full w-full object-cover"
        onLoadedData={(event) => {
          const element = event.currentTarget;
          const length = element.duration;
          if (!Number.isFinite(length) || length <= 0 || element.currentTime > 0.05) return;
          element.currentTime = Math.min(1, length * 0.12);
        }}
      />
    );
  }
  return <span className="block h-full w-full bg-black" />;
}
