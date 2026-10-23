import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Dropdown, EmptyState, Modal, PageHeader, Segmented, Skeleton, useToast } from "@/components/ui";
import { HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import {
  canManageHelp,
  deleteHelpVideo,
  filterHelpVideos,
  formatHelpDuration,
  helpWatchCount,
  helpWatchCountLabel,
  helpWatchLines,
  listHelpLibrary,
  setHelpVideoVisible,
  HELP_AUDIENCE_LABEL,
  type HelpLibraryFilter,
  type HelpPerson,
  type HelpVideo,
  type HelpView,
} from "@/data/wedash/helpVideo";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { HelpVideoForm } from "./HelpVideoForm";
import { HELP_ICON, HelpIcon } from "./icons";

export function HelpPage() {
  const session = useActiveSession();
  const toast = useToast();
  const manage = canManageHelp(session.role);
  const [videos, setVideos] = useState<HelpVideo[]>([]);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<HelpPerson[] | null>(null);
  const [views, setViews] = useState<HelpView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HelpLibraryFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HelpVideo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HelpVideo | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const result = await listHelpLibrary(session.tenantId, manage);
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setVideos(result.videos);
      setPosters(result.posters);
      setPeople(result.people);
      setViews(result.views);
      setStatus("ready");
    })();
    return () => {
      cancel = true;
    };
  }, [manage, session.tenantId]);

  const filtered = filterHelpVideos(videos, { query, filter });
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

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
        title="Ajuda"
        subtitle={manage ? "Envie vídeos explicativos e veja quem já assistiu." : "Vídeos explicativos da empresa."}
        actions={
          <>
            {videos.length > 0 ? <HeaderSearch value={query} onChange={setQuery} placeholder="Buscar por título" width={220} /> : null}
            {manage ? (
              <Button icon={<HelpIcon d={HELP_ICON.upload} />} onClick={openCreate}>
                Enviar vídeo
              </Button>
            ) : null}
          </>
        }
      />

      {status === "error" ? (
        <Alert variant="danger" title={error} />
      ) : status === "loading" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-64 rounded-[var(--radius-vela-lg)]" />
          ))}
        </div>
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
              icon="🎬"
              title={videos.length === 0 ? (manage ? "Nenhum vídeo na biblioteca" : "Nenhum vídeo disponível") : filter === "hidden" && !query.trim() ? "Nenhum vídeo oculto" : "Nenhum vídeo encontrado"}
              description={
                videos.length === 0
                  ? manage
                    ? "Envie um vídeo para a equipe, os gerentes ou os gestores."
                    : "Quando houver um vídeo para você, ele aparece aqui."
                  : filter === "hidden" && !query.trim()
                    ? "Os vídeos que você ocultar continuam aqui."
                    : "Tente outro título ou descrição."
              }
              action={
                videos.length === 0 && manage ? (
                  <Button icon={<HelpIcon d={HELP_ICON.upload} />} onClick={openCreate}>
                    Enviar vídeo
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((video) => {
                const duration = formatHelpDuration(video.durationSec);
                const watched = manage && people ? helpWatchCountLabel(helpWatchCount(helpWatchLines(people, views, video))) : null;
                return (
                  <Card key={video.id} padding="none" className="overflow-hidden">
                    <Link to={paths.helpVideo(video.id)} className="relative block aspect-video bg-bg-3">
                      {video.posterPath && posters[video.posterPath] ? (
                        <img src={posters[video.posterPath]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-2xl text-t2">▶</span>
                      )}
                      {duration ? (
                        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-white">{duration}</span>
                      ) : null}
                    </Link>
                    <div className="flex items-start gap-2 p-3.5">
                      <Link to={paths.helpVideo(video.id)} className="min-w-0 flex-1">
                        <h2 className="line-clamp-2 text-[15px] font-bold leading-snug text-t0">{video.title}</h2>
                        {video.description ? <p className="mt-1 line-clamp-2 text-[13px] text-t1">{video.description}</p> : null}
                        {manage ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {video.audiences.map((audience) => (
                              <Badge key={audience}>{HELP_AUDIENCE_LABEL[audience]}</Badge>
                            ))}
                            {video.visible ? null : <Badge variant="warning">Oculto</Badge>}
                          </div>
                        ) : null}
                        {watched ? <p className="mt-2 text-[12px] font-medium text-t2">{watched}</p> : null}
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
                  </Card>
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
        <p className="text-[13px] text-t1">O vídeo sai da biblioteca e deixa de aparecer para quem tinha acesso.</p>
      </Modal>
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
