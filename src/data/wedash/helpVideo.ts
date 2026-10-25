/** Guia prático: biblioteca de vídeos e PDFs. A tela não mostra quem viu. */

import type { Role } from "./team";
import { getSupabase } from "@/lib/supabase";

export type HelpAudience = "SELLER" | "MANAGER" | "OWNER";

export const HELP_AUDIENCE_ORDER: HelpAudience[] = ["SELLER", "MANAGER", "OWNER"];

export const HELP_AUDIENCE_LABEL: Record<HelpAudience, string> = {
  SELLER: "Equipe",
  MANAGER: "Gerentes",
  OWNER: "Gestor",
};

export const HELP_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const HELP_VIDEO_MAX_MB = 200;
export const HELP_TITLE_MAX = 120;
export const HELP_DESCRIPTION_MAX = 2000;

export const HELP_OFFLINE = "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente.";
export const HELP_LOAD_ERROR = "Não foi possível carregar os materiais. Tente novamente.";
export const HELP_SEND_ERROR = "Não foi possível enviar o arquivo. Tente novamente.";
export const HELP_SAVE_ERROR = "Não foi possível salvar as alterações. Tente novamente.";
export const HELP_DELETE_ERROR = "Não foi possível excluir o arquivo. Tente novamente.";
const SESSION_EXPIRED = "Sua sessão expirou. Entre novamente.";

const HELP_BUCKET = "help-videos";
const HELP_URL_SECONDS = 4 * 60 * 60;
const VIDEO_COLUMNS = "id, title, description, audiences, visible, storage_path, poster_path, duration_sec, mime_type, created_at";

export type HelpVideo = {
  id: string;
  title: string;
  description: string;
  audiences: HelpAudience[];
  visible: boolean;
  storagePath: string;
  posterPath: string | null;
  durationSec: number | null;
  mimeType: string;
  createdAt: string;
};

export type HelpPerson = {
  identityId: string;
  name: string;
  role: Role;
};

export type HelpView = {
  videoId: string;
  identityId: string;
  watchedAt: string;
};

export type HelpLibraryFilter = "all" | "visible" | "hidden";

export type HelpDraftErrors = {
  title?: string;
  description?: string;
  audiences?: string;
  file?: string;
};

export function canManageHelp(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN_GLOBAL";
}

export function audienceOf(role: Role): HelpAudience {
  if (role === "MANAGER") return "MANAGER";
  if (role === "SELLER") return "SELLER";
  return "OWNER";
}

export function isHelpPdf(item: { mimeType: string }): boolean {
  return item.mimeType === "application/pdf";
}

export function helpVideoContentType(file: { name: string; type: string }): string | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || type === "application/x-pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (type === "video/mp4" || name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  if (type === "video/webm" || name.endsWith(".webm")) return "video/webm";
  if (type === "video/quicktime" || type === "video/mov" || name.endsWith(".mov")) return "video/quicktime";
  return null;
}

export function helpVideoFileError(file: { name: string; type: string; size: number }): string | null {
  const contentType = helpVideoContentType(file);
  if (!contentType) return "Use MP4, WEBM, MOV ou PDF.";
  if (file.size <= 0) return "Esse arquivo está vazio.";
  if (file.size > HELP_VIDEO_MAX_BYTES) {
    return contentType === "application/pdf" ? `O PDF passa de ${HELP_VIDEO_MAX_MB} MB.` : `O vídeo passa de ${HELP_VIDEO_MAX_MB} MB.`;
  }
  return null;
}

export function helpDraftErrors(draft: {
  title: string;
  description: string;
  audiences: HelpAudience[];
  file: { name: string; type: string; size: number } | null;
  fileRequired: boolean;
}): HelpDraftErrors {
  const errors: HelpDraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Informe o título.";
  else if (title.length > HELP_TITLE_MAX) errors.title = `O título passa de ${HELP_TITLE_MAX} caracteres.`;
  if (draft.description.trim().length > HELP_DESCRIPTION_MAX) {
    errors.description = "A descrição passa de 2.000 caracteres.";
  }
  if (draft.audiences.length === 0) errors.audiences = "Escolha quem pode ver.";
  if (draft.fileRequired && !draft.file) errors.file = "Escolha o arquivo.";
  else if (draft.file) {
    const fileError = helpVideoFileError(draft.file);
    if (fileError) errors.file = fileError;
  }
  return errors;
}

export function hasHelpDraftError(errors: HelpDraftErrors): boolean {
  return Boolean(errors.title || errors.description || errors.audiences || errors.file);
}

/** "3:15", "13:30" ou "1:02:03". */
export function formatHelpDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(rest)}`;
  return `${minutes}:${pad(rest)}`;
}

export function formatWatchedLabel(at: Date, now: Date, timeZone = "America/Sao_Paulo"): string {
  const clock = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(at);
  const day = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
  if (day.format(at) === day.format(now)) return `hoje às ${clock}`;
  return `em ${day.format(at).slice(0, 5)} às ${clock}`;
}

export function helpVideoExtension(contentType: string): "mp4" | "webm" | "mov" | "pdf" {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "video/webm") return "webm";
  if (contentType === "video/quicktime") return "mov";
  return "mp4";
}

/** O storage grava o tipo do Blob. Sem isso o arquivo sobe genérico e o navegador não dá play. */
export function helpVideoUploadBody(file: Blob, contentType: string): Blob {
  if (file.type === contentType) return file;
  const name = file instanceof File && file.name ? file.name : `video.${helpVideoExtension(contentType)}`;
  return new File([file], name, { type: contentType });
}

export function helpObjectPaths(tenantId: string, videoId: string, contentType = "video/mp4"): { video: string; poster: string } {
  const extension = helpVideoExtension(contentType);
  const fileName = extension === "pdf" ? "file.pdf" : `video.${extension}`;
  return {
    video: `${tenantId}/${videoId}/${fileName}`,
    poster: `${tenantId}/${videoId}/poster.jpg`,
  };
}

export function filterHelpVideos(
  videos: HelpVideo[],
  args: { query: string; filter: HelpLibraryFilter },
): HelpVideo[] {
  const query = args.query.trim().toLocaleLowerCase("pt-BR");
  return videos.filter((video) => {
    if (args.filter === "visible" && !video.visible) return false;
    if (args.filter === "hidden" && video.visible) return false;
    if (!query) return true;
    const title = video.title.toLocaleLowerCase("pt-BR");
    const description = video.description.toLocaleLowerCase("pt-BR");
    return title.includes(query) || description.includes(query);
  });
}

export type HelpWatchLine = {
  identityId: string;
  name: string;
  role: Role;
  watchedAt: string | null;
};

export function helpWatchLines(people: HelpPerson[], views: HelpView[], video: Pick<HelpVideo, "id" | "audiences">): HelpWatchLine[] {
  const seen = new Map(
    views.filter((view) => view.videoId === video.id).map((view) => [view.identityId, view.watchedAt]),
  );
  const allowed = new Set(video.audiences);
  return people
    .filter((person) => allowed.has(audienceOf(person.role)))
    .map((person) => ({
      identityId: person.identityId,
      name: person.name,
      role: person.role,
      watchedAt: seen.get(person.identityId) ?? null,
    }))
    .sort((a, b) => {
      if (a.watchedAt == null && b.watchedAt != null) return -1;
      if (a.watchedAt != null && b.watchedAt == null) return 1;
      if (a.watchedAt && b.watchedAt && a.watchedAt !== b.watchedAt) return b.watchedAt.localeCompare(a.watchedAt);
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

export function helpWatchCount(lines: HelpWatchLine[]): { watched: number; total: number } {
  return { watched: lines.filter((line) => line.watchedAt != null).length, total: lines.length };
}

export function helpWatchCountLabel(count: { watched: number; total: number }): string {
  if (count.total === 0) return "Sem pessoas nesse público";
  if (count.watched === 0) return "Ninguém viu";
  if (count.watched === count.total) return count.total === 1 ? "1 pessoa viu" : "Todos viram";
  return `${count.watched} de ${count.total} viram`;
}

type VideoRow = {
  id: string;
  title: string;
  description: string | null;
  audiences: unknown;
  visible: boolean;
  storage_path: string;
  poster_path: string | null;
  duration_sec: number | null;
  mime_type: string;
  created_at: string;
};

function asAudiences(value: unknown): HelpAudience[] {
  if (!Array.isArray(value)) return [];
  const found = new Set(value.filter((item): item is HelpAudience => item === "SELLER" || item === "MANAGER" || item === "OWNER"));
  return HELP_AUDIENCE_ORDER.filter((audience) => found.has(audience));
}

function asVideo(raw: VideoRow): HelpVideo {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? "",
    audiences: asAudiences(raw.audiences),
    visible: raw.visible,
    storagePath: raw.storage_path,
    posterPath: raw.poster_path,
    durationSec: raw.duration_sec,
    mimeType: raw.mime_type,
    createdAt: raw.created_at,
  };
}

function failed(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = `${error?.message ?? ""} ${error?.code ?? ""}`.toLowerCase();
  if (message.includes("jwt") || message.includes("session") || message.includes("pgrst301")) return SESSION_EXPIRED;
  return fallback;
}

async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const sb = getSupabase();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!sb || unique.length === 0) return {};
  const { data, error } = await sb.storage.from(HELP_BUCKET).createSignedUrls(unique, HELP_URL_SECONDS);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  unique.forEach((path, index) => {
    const url = data[index]?.signedUrl;
    if (url) out[path] = url;
  });
  return out;
}

export async function listHelpLibrary(tenantId: string): Promise<
  | { ok: true; videos: HelpVideo[]; posters: Record<string, string>; clips: Record<string, string> }
  | { ok: false; error: string }
> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const { data, error } = await sb
    .from("help_video")
    .select(VIDEO_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: failed(error, HELP_LOAD_ERROR) };
  const videos = ((data ?? []) as VideoRow[]).map(asVideo);
  const urls = await signedUrls(
    videos.flatMap((video) => (isHelpPdf(video) ? [] : [video.storagePath, ...(video.posterPath ? [video.posterPath] : [])])),
  );
  const posters: Record<string, string> = {};
  const clips: Record<string, string> = {};
  for (const video of videos) {
    if (isHelpPdf(video)) continue;
    if (video.posterPath && urls[video.posterPath]) posters[video.posterPath] = urls[video.posterPath];
    else if (urls[video.storagePath]) clips[video.id] = urls[video.storagePath];
  }
  return { ok: true, videos, posters, clips };
}

export async function readHelpVideo(
  tenantId: string,
  videoId: string,
): Promise<
  | { ok: true; video: HelpVideo | null; videoUrl: string | null; posterUrl: string | null }
  | { ok: false; error: string }
> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const { data, error } = await sb.from("help_video").select(VIDEO_COLUMNS).eq("tenant_id", tenantId).eq("id", videoId).maybeSingle();
  if (error) return { ok: false, error: failed(error, HELP_LOAD_ERROR) };
  if (!data) return { ok: true, video: null, videoUrl: null, posterUrl: null };
  const video = asVideo(data as VideoRow);
  const urls = await signedUrls([video.storagePath, ...(video.posterPath ? [video.posterPath] : [])]);
  return {
    ok: true,
    video,
    videoUrl: urls[video.storagePath] ?? null,
    posterUrl: video.posterPath ? (urls[video.posterPath] ?? null) : null,
  };
}

export async function createHelpVideo(args: {
  tenantId: string;
  title: string;
  description: string;
  audiences: HelpAudience[];
  visible: boolean;
  file: Blob;
  contentType: string;
  durationSec: number | null;
  poster: Blob | null;
}): Promise<{ ok: true; video: HelpVideo; posterUrl: string | null } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const id = crypto.randomUUID();
  const paths = helpObjectPaths(args.tenantId, id, args.contentType);
  const uploaded = await sb.storage.from(HELP_BUCKET).upload(paths.video, helpVideoUploadBody(args.file, args.contentType), {
    contentType: args.contentType,
    upsert: false,
  });
  if (uploaded.error) {
    console.warn("help video upload:", uploaded.error.message);
    return { ok: false, error: failed(uploaded.error, HELP_SEND_ERROR) };
  }
  let posterPath: string | null = null;
  if (args.poster) {
    const poster = await sb.storage.from(HELP_BUCKET).upload(paths.poster, jpegBody(args.poster), { contentType: "image/jpeg", upsert: false });
    if (!poster.error) posterPath = paths.poster;
    else console.warn("help poster upload:", poster.error.message);
  }
  const { data, error } = await sb
    .from("help_video")
    .insert({
      id,
      tenant_id: args.tenantId,
      title: args.title.trim(),
      description: args.description.trim(),
      audiences: args.audiences,
      visible: args.visible,
      storage_path: paths.video,
      poster_path: posterPath,
      duration_sec: args.durationSec,
      mime_type: args.contentType,
    })
    .select(VIDEO_COLUMNS)
    .single();
  if (error || !data) {
    console.warn("help video insert:", error?.message);
    await sb.storage.from(HELP_BUCKET).remove([paths.video, ...(posterPath ? [posterPath] : [])]);
    return { ok: false, error: failed(error, HELP_SEND_ERROR) };
  }
  const video = asVideo(data as VideoRow);
  const urls = posterPath ? await signedUrls([posterPath]) : {};
  return { ok: true, video, posterUrl: posterPath ? (urls[posterPath] ?? null) : null };
}

export async function saveHelpPoster(args: {
  tenantId: string;
  videoId: string;
  poster: Blob;
  durationSec: number | null;
}): Promise<{ ok: true; posterPath: string; posterUrl: string | null; durationSec: number | null } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const posterPath = helpObjectPaths(args.tenantId, args.videoId).poster;
  const uploaded = await sb.storage.from(HELP_BUCKET).upload(posterPath, jpegBody(args.poster), { contentType: "image/jpeg", upsert: false });
  if (uploaded.error && !storedAlready(uploaded.error.message)) return { ok: false, error: failed(uploaded.error, HELP_SAVE_ERROR) };
  const patch: { poster_path: string; duration_sec?: number } = { poster_path: posterPath };
  if (args.durationSec != null) patch.duration_sec = args.durationSec;
  const { error } = await sb.from("help_video").update(patch).eq("tenant_id", args.tenantId).eq("id", args.videoId);
  if (error) return { ok: false, error: failed(error, HELP_SAVE_ERROR) };
  const urls = await signedUrls([posterPath]);
  return { ok: true, posterPath, posterUrl: urls[posterPath] ?? null, durationSec: args.durationSec };
}

function storedAlready(message: string | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return text.includes("exists") || text.includes("duplicate");
}

function jpegBody(file: Blob): Blob {
  if (file.type === "image/jpeg") return file;
  return new File([file], "poster.jpg", { type: "image/jpeg" });
}

export async function updateHelpVideo(args: {
  tenantId: string;
  videoId: string;
  title: string;
  description: string;
  audiences: HelpAudience[];
  visible: boolean;
}): Promise<{ ok: true; video: HelpVideo } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const { data, error } = await sb
    .from("help_video")
    .update({
      title: args.title.trim(),
      description: args.description.trim(),
      audiences: args.audiences,
      visible: args.visible,
    })
    .eq("tenant_id", args.tenantId)
    .eq("id", args.videoId)
    .select(VIDEO_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: failed(error, HELP_SAVE_ERROR) };
  return { ok: true, video: asVideo(data as VideoRow) };
}

export async function setHelpVideoVisible(
  tenantId: string,
  videoId: string,
  visible: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const { error } = await sb.from("help_video").update({ visible }).eq("tenant_id", tenantId).eq("id", videoId);
  if (error) return { ok: false, error: failed(error, HELP_SAVE_ERROR) };
  return { ok: true };
}

export async function deleteHelpVideo(video: Pick<HelpVideo, "id" | "storagePath" | "posterPath">, tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: HELP_OFFLINE };
  const { error } = await sb.from("help_video").delete().eq("tenant_id", tenantId).eq("id", video.id);
  if (error) return { ok: false, error: failed(error, HELP_DELETE_ERROR) };
  const paths = [video.storagePath, ...(video.posterPath ? [video.posterPath] : [])];
  const removed = await sb.storage.from(HELP_BUCKET).remove(paths);
  if (removed.error) console.warn("help video remove:", removed.error.message);
  return { ok: true };
}

