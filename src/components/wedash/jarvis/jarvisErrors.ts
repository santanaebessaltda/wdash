/**
 * Classificação de falhas do JARVIS — fala humana, detalhes só em log.
 */

export type JarvisErrorKind =
  | "offline"
  | "temporary"
  | "auth"
  | "save_uncertain"
  | "validation"
  | "unknown";

export type JarvisUserError = {
  kind: JarvisErrorKind;
  message: string;
  /** Oferecer “Tentar novamente” com o texto do usuário. */
  canRetry: boolean;
};

function normErr(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Log interno — nunca vai para o chat. */
export function logJarvisError(
  scope: string,
  detail: { kind: JarvisErrorKind; reason?: string; raw?: unknown },
): void {
  try {
    console.info(`[jarvis.error] ${scope}`, detail);
  } catch {
    /* ignore */
  }
}

export function isLikelyOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * Converte reason técnico (Edge / fetch / auth) em mensagem operacional.
 * Nunca devolve o texto bruto da Edge Function.
 */
export function classifyJarvisFailure(
  reason: string | null | undefined,
  opts?: { duringSave?: boolean },
): JarvisUserError {
  const raw = (reason ?? "").trim();
  const n = normErr(raw);

  if (isLikelyOffline() || /failed to fetch|networkerror|net::|offline|sem conex|internet/.test(n)) {
    return {
      kind: "offline",
      message: "Sem conexão com a internet. Verifique sua conexão e tente novamente.",
      canRetry: true,
    };
  }

  if (
    /jwt|unauthorized|401|403|not authenticated|sessao|sessão|login|forbidden|auth/.test(n)
  ) {
    return {
      kind: "auth",
      message: "Sua sessão expirou. Entre de novo e tente novamente.",
      canRetry: false,
    };
  }

  if (opts?.duringSave) {
    return {
      kind: "save_uncertain",
      message:
        "Não consegui confirmar se o rascunho foi salvo. Vou verificar o status antes de tentar novamente.",
      canRetry: true,
    };
  }

  if (
    /edge function|non-2xx|functions\.invoke|jarvis_ai|openai|timeout|timed out|503|502|504|500|gateway/.test(
      n,
    )
  ) {
    return {
      kind: "temporary",
      message: "Não consegui processar sua mensagem agora. Tente novamente.",
      canRetry: true,
    };
  }

  if (/falt|valid|overlap|ja existe|já existe/.test(n)) {
    return {
      kind: "validation",
      message: raw || "Não foi possível concluir. Verifique os dados e tente de novo.",
      canRetry: false,
    };
  }

  return {
    kind: "temporary",
    message: "Não consegui processar sua mensagem agora. Tente novamente.",
    canRetry: true,
  };
}
