export type StatusVariant = "success" | "warning" | "danger" | "info" | "accent" | "neutral";

const SUCCESS = ["active", "completed", "paid", "delivered", "approved", "success", "in stock", "won", "resolved", "verified", "published", "online", "confirmed", "shipped"];
const WARNING = ["pending", "in progress", "processing", "on hold", "low stock", "review", "draft", "trial", "warning", "scheduled", "waiting"];
const DANGER = ["inactive", "cancelled", "canceled", "failed", "rejected", "overdue", "out of stock", "lost", "error", "expired", "blocked", "urgent", "high"];
const INFO = ["new", "info", "open", "invited", "queued", "medium"];

/** Maps a free-text status/severity label to a badge color variant, so
 * mock data can stay plain strings instead of baking colors into records. */
export function statusVariant(status: string): StatusVariant {
  const s = status.trim().toLowerCase();
  if (SUCCESS.includes(s)) return "success";
  if (WARNING.includes(s)) return "warning";
  if (DANGER.includes(s)) return "danger";
  if (INFO.includes(s)) return "info";
  return "neutral";
}

/** Mesma palavra de status, mesma cor, em qualquer tela do produto. */
const PRODUCT_STATUS: Record<string, StatusVariant> = {
  ativo: "success",
  "em andamento": "success",
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

  suspenso: "danger",
  recusado: "danger",
  negativo: "danger",
  erro: "danger",

  desligado: "neutral",
  desativada: "neutral",
  "sem acesso": "neutral",
  encerrada: "neutral",
  encerrado: "neutral",
  "não configurado": "neutral",
  "nao configurado": "neutral",
  desconectado: "neutral",
  "senha inválida": "danger",
  "senha invalida": "danger",

  "a começar": "info",
  "a comecar": "info",

  "em aberto": "accent",
};

/** Cor do badge de status do produto. Rótulo desconhecido cai no mapa em inglês. */
export function statusBadgeVariant(label: string): StatusVariant {
  const key = label.trim().toLowerCase();
  return PRODUCT_STATUS[key] ?? statusVariant(key);
}
