import { useEffect, useState } from "react";
import { Button, Checkbox, FormField, Input, Modal, Switch, Textarea, useToast } from "@/components/ui";
import {
  HELP_AUDIENCE_LABEL,
  HELP_AUDIENCE_ORDER,
  HELP_DESCRIPTION_MAX,
  HELP_TITLE_MAX,
  HELP_VIDEO_MAX_MB,
  createHelpVideo,
  hasHelpDraftError,
  helpDraftErrors,
  helpVideoContentType,
  helpVideoFileError,
  updateHelpVideo,
  type HelpAudience,
  type HelpVideo,
} from "@/data/wedash/helpVideo";
import { useActiveSession } from "@/session/SessionProvider";
import { readHelpVideoFile } from "./videoFile";

export function HelpVideoForm({
  open,
  video,
  onClose,
  onSaved,
}: {
  open: boolean;
  video: HelpVideo | null;
  onClose: () => void;
  onSaved: (video: HelpVideo, posterUrl: string | null) => void;
}) {
  const session = useActiveSession();
  const toast = useToast();
  const editing = video != null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audiences, setAudiences] = useState<HelpAudience[]>([]);
  const [visible, setVisible] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<ReturnType<typeof helpDraftErrors>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(video?.title ?? "");
    setDescription(video?.description ?? "");
    setAudiences(video?.audiences ?? []);
    setVisible(video?.visible ?? true);
    setFile(null);
    setErrors({});
    setSaving(false);
  }, [open, video]);

  function toggleAudience(audience: HelpAudience) {
    setAudiences((current) => {
      const next = current.includes(audience) ? current.filter((item) => item !== audience) : [...current, audience];
      return HELP_AUDIENCE_ORDER.filter((item) => next.includes(item));
    });
  }

  async function submit() {
    const nextErrors = helpDraftErrors({
      title,
      description,
      audiences,
      file,
      fileRequired: !editing,
    });
    setErrors(nextErrors);
    if (hasHelpDraftError(nextErrors) || saving) return;
    setSaving(true);
    if (editing && video) {
      const result = await updateHelpVideo({
        tenantId: session.tenantId,
        videoId: video.id,
        title,
        description,
        audiences,
        visible,
      });
      setSaving(false);
      if (!result.ok) {
        toast.show(result.error, "danger");
        return;
      }
      toast.show("Alterações salvas.", "success");
      onSaved(result.video, null);
      onClose();
      return;
    }
    const contentType = file ? helpVideoContentType(file) : null;
    if (!file || !contentType) {
      setSaving(false);
      return;
    }
    const meta = await readHelpVideoFile(file);
    const result = await createHelpVideo({
      tenantId: session.tenantId,
      title,
      description,
      audiences,
      visible,
      file,
      contentType,
      durationSec: meta.durationSec,
      poster: meta.poster,
    });
    setSaving(false);
    if (!result.ok) {
      toast.show(result.error, "danger");
      return;
    }
    toast.show("Vídeo enviado.", "success");
    onSaved(result.video, result.posterUrl);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={editing ? "Editar vídeo" : "Enviar vídeo"}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? (editing ? "Salvando…" : "Enviando…") : editing ? "Salvar alterações" : "Enviar vídeo"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="Título" required error={errors.title}>
          <Input value={title} maxLength={HELP_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Como ler a meta do mês" />
        </FormField>
        <FormField label="Descrição" optional error={errors.description}>
          <Textarea
            value={description}
            maxLength={HELP_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="O que a pessoa vai aprender neste vídeo."
          />
        </FormField>
        <FormField label="Quem pode ver" required error={errors.audiences} hint="Pode marcar mais de um.">
          <div className="flex flex-wrap gap-4">
            {HELP_AUDIENCE_ORDER.map((audience) => (
              <Checkbox
                key={audience}
                checked={audiences.includes(audience)}
                label={HELP_AUDIENCE_LABEL[audience]}
                onChange={() => toggleAudience(audience)}
              />
            ))}
          </div>
        </FormField>
        <FormField label="Visível" hint="Oculto continua na biblioteca e some para quem assiste.">
          <Switch checked={visible} onChange={setVisible} label={visible ? "Visível" : "Oculto"} />
        </FormField>
        {editing ? null : (
          <FormField label="Vídeo" required error={errors.file} hint={`MP4, WEBM ou MOV, até ${HELP_VIDEO_MAX_MB} MB.`}>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={saving} onClick={() => document.getElementById("help-video-file")?.click()}>
                Escolher vídeo
              </Button>
              <input
                id="help-video-file"
                type="file"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                className="hidden"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  setFile(next);
                  setErrors((current) => ({ ...current, file: next ? (helpVideoFileError(next) ?? undefined) : undefined }));
                }}
              />
              {file ? <span className="min-w-0 truncate text-[13px] text-t1">{file.name}</span> : null}
            </div>
          </FormField>
        )}
      </div>
    </Modal>
  );
}
