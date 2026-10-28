export type StatusVariant = "success" | "warning" | "danger" | "info" | "accent" | "neutral";

const SUCCESS = ["active", "completed", "paid", "delivered", "approved", "success", "in stock", "won", "resolved", "verified", "published", "online", "confirmed", "shipped"];
const WARNING = ["pending", "processing", "on hold", "low stock", "review", "draft", "trial", "warning", "scheduled", "waiting"];
const DANGER = ["inactive", "cancelled", "canceled", "failed", "rejected", "overdue", "out of stock", "lost", "error", "expired", "blocked", "urgent", "high"];
const INFO = ["new", "info", "invited", "queued", "medium"];
/** Mesma semântica das legendas: estado atual / aberto. */
const ACCENT = ["in progress", "open"];

/** Maps a free-text status/severity label to a badge color variant, so
 * mock data can stay plain strings instead of baking colors into records. */
export function statusVariant(status: string): StatusVariant {
  const s = status.trim().toLowerCase();
  if (SUCCESS.includes(s)) return "success";
  if (WARNING.includes(s)) return "warning";
  if (DANGER.includes(s)) return "danger";
  if (INFO.includes(s)) return "info";
  if (ACCENT.includes(s)) return "accent";
  return "neutral";
}

/**
 * Semântica fixa do produto — mesma língua das legendas (`ColorLegend`):
 * - success / bg-ok: resultado positivo, concluído, saudável
 * - warning / bg-warn: pendência / atenção
 * - danger / bg-bad: problema / negativo
 * - info / bg-info: futuro / informativo / exceção neutra
 * - accent / bg-acc: estado atual / aberto / “agora” (Em aberto, Em andamento)
 * - neutral / bg-chip-gray: neutro / encerrado / inativo
 *
 * Sequência típica: A começar → Em andamento → Concluído/Encerrado
 * (azul → rosa → verde ou cinza). Fechamento é a referência visual.
 */
const PRODUCT_STATUS: Record<string, StatusVariant> = {
  // success — resultado positivo / saudável
  ativo: "success",
  regular: "success",
  fechado: "success",
  recebido: "success",
  informado: "success",
  conectado: "success",
  conectada: "success",
  configurado: "success",
  configurada: "success",
  concluído: "success",
  concluido: "success",
  alcançado: "success",
  alcancado: "success",
  atingido: "success",
  ganhou: "success",

  // warning — pendência / atenção
  pendente: "warning",
  "convite pendente": "warning",
  "a receber": "warning",
  "aguardando transferência": "warning",
  "aguardando transferencia": "warning",
  expirado: "warning",
  "fechamento em andamento": "warning",
  aviso: "warning",
  "não informado": "warning",
  "nao informado": "warning",
  oculto: "warning",

  // danger — problema ou resultado negativo
  suspenso: "danger",
  recusado: "danger",
  negativo: "danger",
  erro: "danger",
  "senha inválida": "danger",
  "senha invalida": "danger",
  "não alcançado": "danger",
  "nao alcancado": "danger",
  "com diferença": "danger",
  "informado diferente": "danger",

  // info — futuro
  "a começar": "info",
  "a comecar": "info",

  // accent — estado atual / aberto
  "em andamento": "accent",
  "em aberto": "accent",

  // neutral — sem ação / encerrado / sem config
  desligado: "neutral",
  desativada: "neutral",
  "sem acesso": "neutral",
  encerrada: "neutral",
  encerrado: "neutral",
  rascunho: "neutral",
  "não configurado": "neutral",
  "nao configurado": "neutral",
  desconectado: "neutral",
};

/** Cor do badge de status do produto. Rótulo desconhecido cai no mapa em inglês. */
export function statusBadgeVariant(label: string): StatusVariant {
  const key = label.trim().toLowerCase();
  return PRODUCT_STATUS[key] ?? statusVariant(key);
}
