/**
 * Intents e respostas curtas em tom humano (estilo Néctar).
 * Números e gravação ficam nos briefs / drafts — aqui só o jeito de falar.
 * Sem navigate/scroll: o JARVIS resolve 100% no chat.
 */

export type JarvisIntent =
  | "greeting"
  | "capability"
  | "analyze_sales"
  | "analyze_goal"
  | "analyze_stock"
  | "seasonal"
  | "challenge"
  | "goal"
  | "schedule"
  | "stay_in_chat"
  | "authorize"
  | "unknown";

function normalizeIntentText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Opinião / conselho / follow-up — não é leitura seca de número.
 * Ex.: “você acha que atinge?”, “melhor reduzir a meta?”.
 */
export function looksLikeOpinionOrCounsel(raw: string): boolean {
  const p = normalizeIntentText(raw);
  return /voce acha|vc acha|acha (que|melhor)|o que (voce|vc) (acha|sugere|recomenda)|melhor (reduzir|aumentar|baixar|subir|mudar|alterar|criar)|vale a pena|faz sentido|deveria|consegue(mos)? (bater|atingir)|vai (dar|bater|atingir)|ating(e|ir)|reduzir|aumentar|diminuir|abaixar|reavaliar|revisar (a )?meta|ajust(ar|e) (a |o )?(valor|meta)/.test(
    p,
  );
}

/** Leitura factual: “quanto é a meta / qual a meta deste mês”. */
export function looksLikeGoalRead(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (!/\bmeta\b/.test(p)) return false;
  if (looksLikeGoalWrite(p) || looksLikeOpinionOrCounsel(p)) return false;
  return /quanto (e |eh |e a |eh a )?a? ?meta|qual (e |eh )?(a |o )?(meta|valor da meta)|de quanto|como (esta|ta) (a |o )?meta|esta com|ta com|meta (deste|desse|do|da|este|esse|atual)|tem meta|qual a meta|a meta .*quanto|saber.*(a )?meta|ver.*(a )?meta|consultar.*(a )?meta|me (fala|diga|diz).*(a )?meta/.test(
    p,
  );
}

/** Escrita / sugestão / reajuste — rascunho + Autorizar. */
export function looksLikeGoalWrite(raw: string): boolean {
  const p = normalizeIntentText(raw);
  return /reajust|suger|criar.*meta|montar.*meta|nova meta|novo valor|valor sugerido|alterar (a )?meta|mudar (a )?meta|baixar (a )?meta|subir (a )?meta|reduzir (a |o )?(valor (da |da meta| )?|meta)|aumentar (a |o )?(valor (da |da meta| )?|meta)|diminuir (a )?meta|abaixar (a )?meta|propor|proponha|quero (uma |a )?meta|vamos (a |na )?meta|meta de \d|comissao|premiacao|escada|posso (baixar|subir|mudar|alterar|reduzir|aumentar)|vai bater|nao vai bater/.test(
    p,
  );
}

/** Alias: escrita ou menção genérica a meta que não é leitura pura. */
export function looksLikeGoalAdvice(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (looksLikeGoalRead(p)) return false;
  if (looksLikeOpinionOrCounsel(p) && /\bmeta\b/.test(p)) return true;
  return looksLikeGoalWrite(p) || (/\bmeta\b/.test(p) && !looksLikeSalesQueryLoose(p));
}

function looksLikeSalesQueryLoose(p: string): boolean {
  return /vendi\b|vendeu\b|faturamento|quanto vend/.test(p);
}

/** Pergunta clara de leitura de vendas (atalho loadSalesBrief). */
export function looksLikeSalesQuery(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (looksLikeGoalAdvice(p)) return false;
  if (looksLikeChallengeAdvice(p)) return false;
  return (
    /quanto (eu |a loja |a rede |nos |voce )?(vend|faturou)|vendi\b|vendeu\b|vendemos\b|faturamento|ticket|p\.?\s*a\.?\b|margem|analis(e|ar)? (as? |o )?(venda|faturamento)|como (esta|tá) (a |o )?(loja|rede|grupo|venda|faturamento)/.test(
      p,
    ) || /^(e )?(em |na |no )?(todas( as)? filiais|a rede|a loja)\??$/.test(p.trim())
  );
}

/**
 * “Nível desafio” / escada / +10% na meta — NÃO é o CRUD Desafios.
 * Ex.: “último nível 10% a mais”, “mesma config de outubro”.
 */
export function looksLikeGoalLadderTalk(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (/produto|body|estoque|disputa|quem fizer mais|podio|pódio|prêmio em|premio em/.test(p)) return false;
  return (
    /nivel (desafio|ultimo)|ultimo nivel|meta desafio|desafio (da|de) (a )?meta|escada|10\s*%(\s*a\s*mais)?|por cento a mais|mesma configura|igual (a|ao|a meta|outubro|novembro)|copiar.*(meta|outubro)|configura[cç][aã]o (de |da )?(meta|outubro|mes)|seguir.*(configura|outubro|meta)/.test(
      p,
    ) ||
    (/\bmeta\b/.test(p) && /\bdesafio\b/.test(p) && /nivel|%|por cento|configura|outubro|novembro/.test(p))
  );
}

/** Performance > Desafios (produto/disputa) — não confundir com nível da escada da meta. */
function looksLikeChallengeAdvice(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (!/desafio/.test(p)) return false;
  if (looksLikeGoalLadderTalk(p)) return false;
  return true;
}

/** Pedidos antigos de “abre tela / rola página” — respondemos no chat, sem sair. */
export function looksLikeLeaveChatRequest(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (looksLikeGoalAdvice(p) || looksLikeChallengeAdvice(p) || looksLikeSalesQuery(p)) return false;
  if (/vend[aeiou]|faturamento|estoque|escala|comissao|premiacao/.test(p)) return false;
  return (
    /rolar|rola\b|scroll|desce(r)?( a pagina)?|sobe(r)?( a pagina)?|pro topo|pro final|fim da pagina|pra baixo|pra cima/.test(
      p,
    ) ||
    /(abre|abrir|entra|entrar|vai (pra|pro|para)|vamos (pra|pro|para)|me leva|abre a tela) .*(visao|financeiro|produto|equipe|dashboard|inicio|home|metas?|desafios?|estoque|escala|carteira)/.test(
      p,
    ) ||
    /^(abre|abrir|entra|vai pro|vai pra|mostra) (a |o )?(visao geral|financeiro|produtos|equipe|dashboard|escala|metas?|desafios?)\b/.test(
      p,
    )
  );
}

export const STAY_IN_CHAT_REPLY =
  "Aqui no chat a gente resolve: vendas, meta, desafio, escala. Me pede o que precisa; não te mando pra outra tela.";

/** Confirmacao explicita de gravar — nao confundir com "pode seguir a escala/config" nem "preciso criar a meta…". */
export function looksLikeAuthorizeConfirm(raw: string): boolean {
  const p = normalizeIntentText(raw);
  // Pedido de comecar a montar nao e autorizacao.
  if (
    /precis[oa]|queria|quero |gostaria|preciso |bora (montar|criar)|vamos montar|vamos criar (a |uma )?meta|montar (a |uma )?meta|criar (a |uma )?meta( |$)/.test(
      p,
    ) &&
    !/autorizo|pode criar|pode gravar|ok(,| )?vamos criar|ok(,| )?pode|salva(r)? (o )?rascunho/.test(p)
  ) {
    return false;
  }
  if (/autorizo|pode criar|pode gravar|fechado pode|ok(,| )?vamos criar|salva(r)? (o )?rascunho/.test(p)) {
    return true;
  }
  // "cria a meta" so confirmacao curta (fim do fio), nao "criar a meta da minha loja".
  if (/^(ok[, ]*)?(cria(r)?|vamos criar) (essa |a |o )?meta( agora| ja| já)?[!?.]*$/.test(p.trim())) {
    return true;
  }
  // "pode seguir" so se for fechar o rascunho, nao "seguir a mesma escala/config".
  if (/pode seguir/.test(p) && !/escala|configura|escada|nivel|modo|meta de|mesma/.test(p)) {
    return true;
  }
  if (/^(confirma|fechado|pode|ok|manda|fecha)[!?.]*$/.test(p.trim())) return true;
  return false;
}

/** Ainda negociando valor/filial — nao gravar rascunho. */
export function looksLikeStillDiscussing(raw: string): boolean {
  const p = normalizeIntentText(raw);
  return /na verdade|porem|acho que|melhorar|suger|quanto (seria|fica|fica a)|e se |outra filial|no caso da|mudar (a |o )?(filial|loja|valor|meta)|trocar (a |o )?(filial|loja)|da pra (subir|melhorar|aumentar)|da para (subir|melhorar|aumentar)/.test(
    p,
  );
}

export function classifyIntent(raw: string): JarvisIntent {
  const p = normalizeIntentText(raw);

  // So fallback local (Edge fora): a conversa real e a IA via prompt, sem lista de cumprimento.
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|eai)\b/.test(p) || p.includes("tudo bem")) return "greeting";
  if (/o que (voce|vc) (faz|pode)|como (voce|vc) funciona|suas habilidades|no que (voce|vc) ajuda/.test(p)) {
    return "capability";
  }
  // Autorizar so em confirmacao curta — "pode seguir a mesma escala" NAO grava rascunho.
  if (looksLikeAuthorizeConfirm(p) && !looksLikeStillDiscussing(p)) {
    return "authorize";
  }
  if (looksLikeLeaveChatRequest(p)) return "stay_in_chat";
  if (looksLikeChallengeAdvice(p)) return "challenge";
  if (looksLikeGoalLadderTalk(p)) return "goal";
  if (looksLikeGoalRead(p)) return "analyze_goal";
  if (looksLikeGoalAdvice(p)) return "goal";
  if (/escala|folga|6\s*[x×]\s*1|plantao|turno/.test(p)) return "schedule";
  if (/sazonal|dia das maes|black friday|natal|pascoa|namorados|datas comemorativas/.test(p)) return "seasonal";
  if (/estoque|parado|encalhe|cobertura|sem girar|parado na prateleira/.test(p)) return "analyze_stock";
  if (looksLikeSalesQuery(p)) return "analyze_sales";
  return "unknown";
}

export function jarvisReply(question: string, firstName?: string): string {
  const intent = classifyIntent(question);
  const name = (firstName || "").trim();
  switch (intent) {
    case "greeting":
      return name ? `E aí, ${name}! O que você precisa?` : "E aí! O que você precisa?";
    case "capability":
      return name
        ? `${name}, eu te ajudo com números, meta, desafio e escala aqui no chat. O que você quer olhar?`
        : "Te ajudo com números, meta, desafio e escala aqui no chat. O que você quer olhar?";
    case "analyze_sales":
      return "Deixa eu olhar as vendas aí…";
    case "analyze_goal":
      return "Deixa eu ver a meta cadastrada…";
    case "analyze_stock":
      return "Vou cruzar estoque com as vendas dos últimos 30 dias pra achar o que tá parado.";
    case "seasonal":
      return "Deixa eu ver o que vem de sazonal e feriado…";
    case "challenge":
      return "Bora montar o desafio. Me fala filial, período, modo e prêmio, ou manda um com produto parado. Eu mostro o rascunho e só gravo se você autorizar.";
    case "goal":
      return "Bora montar a meta. Pra qual mês a gente monta?";
    case "schedule":
      return "Na escala eu uso o mesmo motor do montador. Me diz a filial e o mês; proponho o rascunho e só gero de verdade com o seu OK.";
    case "stay_in_chat":
      return STAY_IN_CHAT_REPLY;
    case "authorize":
      return "Ainda não tenho rascunho pra gravar. Quando a gente montar algo, eu peço seu OK.";
    default:
      return "Me conta o que você quer olhar — vendas, meta, desafio ou escala.";
  }
}
