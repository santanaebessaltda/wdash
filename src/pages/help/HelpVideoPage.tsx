import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Breadcrumbs, Button, Modal, useToast } from "@/components/ui";
import {
  HELP_AUDIENCE_LABEL,
  audienceOf,
  canManageHelp,
  deleteHelpVideo,
  readHelpVideo,
  saveHelpPoster,
  setHelpVideoVisible,
  type HelpVideo,
} from "@/data/wedash/helpVideo";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { HelpVideoForm } from "./HelpVideoForm";
import { HELP_ICON, HelpIcon, HelpPlayMark } from "./icons";
import { captureHelpVideo } from "./videoFile";

export function HelpVideoPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const session = useActiveSession();
  const toast = useToast();
  const manage = canManageHelp(session.role);
  const [video, setVideo] = useState<HelpVideo | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    setStarted(false);
    setPlaybackError(false);
    let cancel = false;
    void (async () => {
      setStatus("loading");
      const result = await readHelpVideo(session.tenantId, id);
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        return;
      }
      const allowed =
        result.video &&
        (canManageHelp(session.role) ||
          (result.video.visible && result.video.audiences.includes(audienceOf(session.role))));
      if (!result.video || !allowed) {
        setVideo(null);
        setStatus("missing");
        return;
      }
      setVideo(result.video);
      setVideoUrl(result.videoUrl);
      setPosterUrl(result.posterUrl);
      setStatus("ready");
    })();
    return () => {
      cancel = true;
    };
  }, [id, session.role, session.tenantId]);

  const videoId = video?.id ?? "";
  const knownPoster = video?.posterPath ?? null;
  const knownDuration = video?.durationSec ?? null;

  useEffect(() => {
    if (posterUrl || !videoUrl || !videoId) return;
    let cancel = false;
    void captureHelpVideo(videoUrl, true).then((result) => {
      if (cancel || !result.poster) return;
      const poster = result.poster;
      setPosterUrl(URL.createObjectURL(poster));
      if (!manage || knownPoster) return;
      void saveHelpPoster({
        tenantId: session.tenantId,
        videoId,
        poster,
        durationSec: knownDuration ?? result.durationSec,
      }).then((saved) => {
        if (!saved.ok) return;
        if (saved.posterUrl) setPosterUrl(saved.posterUrl);
        setVideo((current) =>
          current && current.id === videoId
            ? { ...current, posterPath: saved.posterPath, durationSec: current.durationSec ?? saved.durationSec }
            : current,
        );
      });
    });
    return () => {
      cancel = true;
    };
  }, [knownDuration, knownPoster, manage, posterUrl, session.tenantId, videoId, videoUrl]);

  async function toggleVisible() {
    if (!video || busy) return;
    setBusy(true);
    const next = !video.visible;
    const result = await setHelpVideoVisible(session.tenantId, video.id, next);
    setBusy(false);
    if (!result.ok) {
      toast.show(result.error, "danger");
      return;
    }
    setVideo({ ...video, visible: next });
    toast.show(next ? "Vídeo visível." : "Vídeo oculto.", "success");
  }

  async function confirmDelete() {
    if (!video || deleting) return;
    setDeleting(true);
    const result = await deleteHelpVideo(video, session.tenantId);
    setDeleting(false);
    if (!result.ok) {
      toast.show(result.error, "danger");
      return;
    }
    toast.show("Vídeo excluído.", "success");
    navigate(paths.help);
  }

  return (
    <div className="pb-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" className="sm:hidden" icon={<HelpIcon d={HELP_ICON.back} size={14} />} aria-label="Voltar" onClick={() => navigate(paths.help)}>
          Voltar
        </Button>
        <Breadcrumbs items={[{ label: "Tutoriais", to: paths.help }, { label: video?.title ?? "Vídeo" }]} />
      </div>

      {status === "loading" ? (
        <p className="text-[13px] text-t2">Carregando vídeo…</p>
      ) : status === "error" ? (
        <Alert variant="danger" title={error} />
      ) : status === "missing" || !video ? (
        <p className="text-[13px] text-t1">Este vídeo não está disponível.</p>
      ) : (
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-t0 sm:text-[26px]">{video.title}</h1>
              {manage ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {video.audiences.map((audience) => (
                    <span key={audience} className="inline-flex items-center rounded-full bg-bg-3 px-2 py-0.5 text-[10.5px] font-medium text-t2">
                      {HELP_AUDIENCE_LABEL[audience]}
                    </span>
                  ))}
                  {video.visible ? null : <Badge variant="warning">Oculto</Badge>}
                </div>
              ) : null}
            </div>
            {manage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setFormOpen(true)}>
                  Editar
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void toggleVisible()}>
                  {video.visible ? "Ocultar" : "Tornar visível"}
                </Button>
                <Button variant="danger" onClick={() => setPendingDelete(true)}>
                  Excluir
                </Button>
              </div>
            ) : null}
          </div>

          {videoUrl && !playbackError ? (
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                key={videoUrl}
                ref={player}
                className="aspect-video w-full bg-black"
                src={videoUrl}
                poster={posterUrl ?? undefined}
                controls={started}
                playsInline
                preload="auto"
                onPlay={() => setStarted(true)}
                onError={() => setPlaybackError(true)}
              />
              {started ? null : (
                <button
                  type="button"
                  aria-label="Reproduzir"
                  className="absolute inset-0 flex items-center justify-center"
                  onClick={() => {
                    const element = player.current;
                    if (!element) return;
                    void element.play().catch(() => setPlaybackError(true));
                  }}
                >
                  {posterUrl ? <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-white">
                    <HelpPlayMark size={26} />
                  </span>
                </button>
              )}
            </div>
          ) : (
            <Alert variant="danger" title={playbackError ? "Não foi possível reproduzir este vídeo neste navegador. Envie um MP4." : "Não foi possível abrir o vídeo. Tente novamente."} />
          )}

          {video.description ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-t1">{video.description}</p> : null}
        </div>
      )}

      {manage && video ? (
        <HelpVideoForm
          open={formOpen}
          video={video}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => setVideo((current) => (current ? { ...current, ...saved, posterPath: current.posterPath, storagePath: current.storagePath } : saved))}
        />
      ) : null}

      <Modal
        open={pendingDelete}
        onClose={() => {
          if (!deleting) setPendingDelete(false);
        }}
        title="Excluir vídeo?"
        footer={
          <>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setPendingDelete(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "Excluindo…" : "Excluir"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-t1">O vídeo será excluído da biblioteca e deixará de aparecer para todos os públicos.</p>
      </Modal>
    </div>
  );
}
