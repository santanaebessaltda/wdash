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

function looksLikeChallengeAdvice(raw: string): boolean {
  const p = normalizeIntentText(raw);
  return /desafio/.test(p);
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
  "Aqui no chat a gente resolve — vendas, meta, desafio, escala. Me pede o que precisa; não te mando pra outra tela.";

export function classifyIntent(raw: string): JarvisIntent {
  const p = normalizeIntentText(raw);

  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|eai)\b/.test(p) || p.includes("tudo bem")) return "greeting";
  if (/o que (voce|vc) (faz|pode)|como (voce|vc) funciona|suas habilidades|no que (voce|vc) ajuda/.test(p)) {
    return "capability";
  }
  if (/autorizo|pode criar|pode gravar|confirma|pode seguir|fechado pode/.test(p)) return "authorize";
  if (looksLikeLeaveChatRequest(p)) return "stay_in_chat";
  if (looksLikeChallengeAdvice(p)) return "challenge";
  if (looksLikeGoalRead(p)) return "analyze_goal";
  if (looksLikeGoalAdvice(p)) return "goal";
  if (/escala|folga|6\s*[x×]\s*1|plantao|turno/.test(p)) return "schedule";
  if (/sazonal|dia das maes|black friday|natal|pascoa|namorados|datas comemorativas/.test(p)) return "seasonal";
  if (/estoque|parado|encalhe|cobertura|sem girar|parado na prateleira/.test(p)) return "analyze_stock";
  if (looksLikeSalesQuery(p)) return "analyze_sales";
  return "unknown";
}

export function jarvisReply(question: string): string {
  const intent = classifyIntent(question);
  switch (intent) {
    case "greeting":
      return "E aí. Tô no chat — vendas, estoque, meta, desafio, escala. Por onde vamos?";
    case "capability":
      return "No chat eu leio a base, monto e ajusto meta, desafio e escala, e passo números. Gravar só depois do seu Autorizar no card — sem te mandar pra outra tela.";
    case "analyze_sales":
      return "Deixa eu olhar as vendas aí…";
    case "analyze_goal":
      return "Deixa eu ver a meta cadastrada…";
    case "analyze_stock":
      return "Vou cruzar estoque com as vendas dos últimos 30 dias pra achar o que tá parado.";
    case "seasonal":
      return "Deixa eu ver o que vem de sazonal e feriado…";
    case "challenge":
      return "Bora montar o desafio. Me fala filial, período, modo e prêmio — ou manda um com produto parado. Eu mostro o rascunho e só gravo se você autorizar.";
    case "goal":
      return "Bora a meta. Fala a filial, o mês e o valor — ou pede uma sugestão pelo histórico. Eu mostro a escada e espero seu Autorizar.";
    case "schedule":
      return "Na escala eu uso o mesmo motor do montador. Me diz a filial e o mês — proponho o rascunho e só gero de verdade com o seu OK.";
    case "stay_in_chat":
      return STAY_IN_CHAT_REPLY;
    case "authorize":
      return "Ainda não tenho rascunho pra gravar. Quando a gente montar algo, eu peço seu OK.";
    default:
      return "Manda aí — vendas, estoque, desafio, meta ou escala. Se for criar, a gente fecha o detalhe e eu só gravo com autorização.";
  }
}
