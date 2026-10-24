import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Dropdown, EmptyState, Modal, PageHeader, Segmented, Skeleton, useToast } from "@/components/ui";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import {
  audienceOf,
  canManageHelp,
  deleteHelpVideo,
  filterHelpVideos,
  formatHelpDuration,
  listHelpLibrary,
  saveHelpPoster,
  setHelpVideoVisible,
  HELP_AUDIENCE_LABEL,
  type HelpLibraryFilter,
  type HelpVideo,
} from "@/data/wedash/helpVideo";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { HelpThumb } from "./HelpThumb";
import { HelpVideoForm } from "./HelpVideoForm";
import { HELP_ICON, HelpIcon, HelpPlayMark } from "./icons";

const posterSaves = new Set<string>();
/** No celular, uma coluna na largura da tela. A partir de `sm`, miniaturas de 220 a 280px. */
const helpGrid = "grid min-w-0 grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(220px,280px))]";

export function HelpPage() {
  const session = useActiveSession();
  const toast = useToast();
  const manage = canManageHelp(session.role);
  const [videos, setVideos] = useState<HelpVideo[]>([]);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [clips, setClips] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HelpLibraryFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HelpVideo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HelpVideo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const showSkeleton = useMinSkeleton(status === "loading");

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const result = await listHelpLibrary(session.tenantId);
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setVideos(result.videos);
      setPosters(result.posters);
      setClips(result.clips);
      setStatus("ready");
    })();
    return () => {
      cancel = true;
    };
  }, [session.tenantId]);

  const library = manage
    ? videos
    : videos.filter((video) => video.visible && video.audiences.includes(audienceOf(session.role)));
  const filtered = filterHelpVideos(library, { query, filter });
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  function keepPoster(video: HelpVideo, poster: Blob, durationSec: number | null) {
    if (video.posterPath || posterSaves.has(video.id)) return;
    posterSaves.add(video.id);
    void saveHelpPoster({
      tenantId: session.tenantId,
      videoId: video.id,
      poster,
      durationSec: video.durationSec ?? durationSec,
    }).then((result) => {
      if (!result.ok) {
        posterSaves.delete(video.id);
        return;
      }
      setVideos((current) =>
        current.map((item) =>
          item.id === video.id ? { ...item, posterPath: result.posterPath, durationSec: item.durationSec ?? result.durationSec } : item,
        ),
      );
      if (result.posterUrl) setPosters((current) => ({ ...current, [result.posterPath]: result.posterUrl! }));
      setClips((current) => {
        const next = { ...current };
        delete next[video.id];
        return next;
      });
    });
  }

  async function toggleVisible(video: HelpVideo) {
    const next = !video.visible;
    const result = await setHelpVideoVisible(session.tenantId, video.id, next);
    if (!result.ok) {
      toast.show(result.error, "danger");
      return;
    }
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, visible: next } : item)));
    toast.show(next ? "Vídeo visível." : "Vídeo oculto.", "success");
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const result = await deleteHelpVideo(pendingDelete, session.tenantId);
    setDeleting(false);
    if (!result.ok) {
      toast.show(result.error, "danger");
      return;
    }
    setVideos((current) => current.filter((item) => item.id !== pendingDelete.id));
    setPendingDelete(null);
    toast.show("Vídeo excluído.", "success");
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Guia prático"
        subtitle={manage ? "Envie e organize vídeos de orientação para a operação." : "Vídeos para apoiar a operação do dia a dia."}
        actions={
          <>
            {showSkeleton ? (
              <Skeleton className="h-10 w-[220px] max-w-full rounded-[var(--radius-vela-sm)]" />
            ) : videos.length > 0 ? (
              <HeaderSearch value={query} onChange={setQuery} placeholder="Buscar vídeos" width={220} />
            ) : null}
            {manage && showSkeleton ? <Skeleton className="h-10 w-[148px] max-w-full rounded-[var(--radius-vela-md)]" /> : null}
            {manage && !showSkeleton ? (
              <Button icon={<HelpIcon d={HELP_ICON.upload} />} onClick={openCreate}>
                Enviar vídeo
              </Button>
            ) : null}
          </>
        }
      />

      {status === "error" && !showSkeleton ? (
        <Alert variant="danger" title={error} />
      ) : showSkeleton ? (
        <HelpLibrarySkeleton />
      ) : (
        <>
          {manage && videos.length > 0 ? (
            <Segmented
              className="mb-4"
              value={filter}
              onChange={(value) => setFilter(value ?? "all")}
              options={[
                { value: "all", label: "Todos" },
                { value: "visible", label: "Visíveis" },
                { value: "hidden", label: "Ocultos" },
              ]}
            />
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              icon="📖"
              title={library.length === 0 ? (manage ? "Nenhum vídeo na biblioteca" : "Nenhum vídeo disponível") : filter === "hidden" && !query.trim() ? "Nenhum vídeo oculto" : "Nenhum vídeo encontrado"}
              description={
                library.length === 0
                  ? manage
                    ? "Envie o primeiro vídeo e escolha quem poderá assistir."
                    : "Os vídeos disponíveis para você aparecerão aqui."
                  : filter === "hidden" && !query.trim()
                    ? "Os vídeos ocultos aparecem aqui."
                    : "Tente outro título ou descrição."
              }
              action={
                library.length === 0 && manage ? (
                  <Button icon={<HelpIcon d={HELP_ICON.upload} />} onClick={openCreate}>
                    Enviar vídeo
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={helpGrid}>
              {filtered.map((video) => {
                const duration = formatHelpDuration(video.durationSec);
                const posterUrl = video.posterPath ? (posters[video.posterPath] ?? null) : null;
                return (
                  <article key={video.id} className="min-w-0">
                    <Link to={paths.helpVideo(video.id)} aria-label={`Assistir ${video.title}`} className="group relative block aspect-video overflow-hidden rounded-xl bg-black">
                      <HelpThumb
                        posterUrl={posterUrl}
                        clipUrl={clips[video.id] ?? null}
                        onCapture={manage && !video.posterPath ? (poster, durationSec) => keepPoster(video, poster, durationSec) : undefined}
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white">
                          <HelpPlayMark />
                        </span>
                      </span>
                      {duration ? (
                        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{duration}</span>
                      ) : null}
                    </Link>
                    <div className="flex items-start gap-1 pt-2">
                      <Link to={paths.helpVideo(video.id)} className="min-w-0 flex-1">
                        <h2 className="line-clamp-2 text-[14px] font-semibold leading-5 text-t0">{video.title}</h2>
                        {manage ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {video.audiences.map((audience) => (
                              <span key={audience} className="inline-flex items-center rounded-full bg-bg-3 px-2 py-0.5 text-[10.5px] font-medium text-t2">
                                {HELP_AUDIENCE_LABEL[audience]}
                              </span>
                            ))}
                            {video.visible ? null : <Badge variant="warning">Oculto</Badge>}
                          </div>
                        ) : null}
                      </Link>
                      {manage ? (
                        <Dropdown
                          portal
                          align="right"
                          trigger={
                            <button type="button" aria-label={`Ações de ${video.title}`} className="flex h-8 w-8 items-center justify-center rounded-full text-t1 hover:bg-bg-3">
                              <Dots />
                            </button>
                          }
                          items={[
                            { label: "Editar", onClick: () => { setEditing(video); setFormOpen(true); } },
                            { label: video.visible ? "Ocultar" : "Tornar visível", onClick: () => void toggleVisible(video) },
                            { label: "", divider: true },
                            { label: "Excluir", danger: true, onClick: () => setPendingDelete(video) },
                          ]}
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {manage ? (
        <HelpVideoForm
          open={formOpen}
          video={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(saved, posterUrl) => {
            setVideos((current) => {
              const exists = current.some((item) => item.id === saved.id);
              if (!exists) return [saved, ...current];
              return current.map((item) => (item.id === saved.id ? { ...item, ...saved, posterPath: item.posterPath } : item));
            });
            if (posterUrl && saved.posterPath) setPosters((current) => ({ ...current, [saved.posterPath!]: posterUrl }));
          }}
        />
      ) : null}

      <Modal
        open={pendingDelete != null}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        title="Excluir vídeo?"
        footer={
          <>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>
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

function HelpLibrarySkeleton() {
  return (
    <div className={helpGrid} aria-busy="true" aria-label="Carregando">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className={index >= 3 ? "hidden min-w-0 sm:block" : "min-w-0"}>
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="pt-2">
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="mt-1 h-5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Dots() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
