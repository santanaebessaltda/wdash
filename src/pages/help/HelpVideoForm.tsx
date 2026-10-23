import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, FormField, Input, Modal, Switch, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
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
import { HELP_ICON, HelpIcon } from "./icons";
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
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof helpDraftErrors>>({});
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(video?.title ?? "");
    setDescription(video?.description ?? "");
    setAudiences(video?.audiences ?? []);
    setVisible(video?.visible ?? true);
    setFile(null);
    setDragOver(false);
    setErrors({});
    setSaving(false);
  }, [open, video]);

  function chooseFile(next: File | null) {
    setFile(next);
    setErrors((current) => ({ ...current, file: next ? (helpVideoFileError(next) ?? undefined) : undefined }));
  }

  function openFilePicker() {
    if (saving) return;
    fileInput.current?.click();
  }

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
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <HelpFormHeading>Informações</HelpFormHeading>
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
        </section>
        <section className="flex flex-col gap-3">
          <HelpFormHeading required>Público</HelpFormHeading>
          <FormField error={errors.audiences} hint="Pode marcar mais de um.">
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
        </section>
        <section className="flex flex-col gap-3">
          <HelpFormHeading>Visibilidade</HelpFormHeading>
          <FormField hint="Vídeos ocultos continuam na biblioteca, mas não aparecem para o público.">
            <Switch checked={visible} onChange={setVisible} label={visible ? "Visível" : "Oculto"} />
          </FormField>
        </section>
        {editing ? null : (
          <section className="flex flex-col gap-3">
            <HelpFormHeading required>Vídeo</HelpFormHeading>
            <FormField error={errors.file}>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!saving) setDragOver(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                if (saving) return;
                chooseFile(event.dataTransfer.files?.[0] ?? null);
              }}
              onClick={openFilePicker}
              className={cn(
                "cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
                dragOver ? "border-acc bg-acc-soft" : "border-line",
                saving && "pointer-events-none opacity-60",
              )}
            >
              <span className="mx-auto mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-2xl bg-acc-soft text-acc">
                <HelpIcon d={HELP_ICON.upload} size={28} />
              </span>
              <h3 className="text-[17px] font-bold text-t0">Arraste o vídeo aqui ou escolha um arquivo</h3>
              <p className="mt-2 mb-4 text-[13.5px] text-t2">MP4, WEBM ou MOV, até {HELP_VIDEO_MAX_MB} MB</p>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={(event) => {
                  event.stopPropagation();
                  openFilePicker();
                }}
              >
                Escolher vídeo
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                className="hidden"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </div>
            {file ? (
              <div className="mt-3 flex items-center gap-3.5 rounded-xl border border-line bg-bg-inset p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acc-soft text-acc">
                  <HelpIcon d={HELP_ICON.file} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13.5px] font-bold text-t0">{file.name}</span>
                    <span className="shrink-0 text-xs text-t2">{formatHelpFileSize(file.size)}</span>
                  </div>
                  {saving ? <p className="mt-1 text-[11.5px] font-semibold text-t2">Enviando…</p> : null}
                </div>
                <button
                  type="button"
                  aria-label="Remover vídeo"
                  disabled={saving}
                  onClick={() => chooseFile(null)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-t2 hover:border-bad hover:text-bad disabled:pointer-events-none disabled:opacity-50"
                >
                  <HelpIcon d={HELP_ICON.close} size={12} />
                </button>
              </div>
            ) : null}
            </FormField>
          </section>
        )}
      </div>
    </Modal>
  );
}

function HelpFormHeading({ children, required }: { children: string; required?: boolean }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wider text-t2">
      {children}
      {required ? <span className="text-bad"> *</span> : null}
    </p>
  );
}

function formatHelpFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    const digits = mb >= 10 ? 0 : 1;
    return `${mb.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} MB`;
  }
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  return `${bytes} B`;
}
