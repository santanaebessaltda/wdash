/**
 * jarvis-ai — chat (Gemini) + Whisper/TTS só para Gestor.
 * Chat = Gemini (GEMINI_API_KEY). STT = OpenAI Whisper. TTS = OpenAI ou Gemini.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";

const OPENAI_URL = "https://api.openai.com/v1";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const CHAT_MODEL = Deno.env.get("JARVIS_CHAT_MODEL")?.trim() || "gemini-2.5-flash";
/** STT rápido; fallback whisper-1 se o modelo novo falhar. */
const STT_MODEL = Deno.env.get("JARVIS_STT_MODEL")?.trim() || "gpt-4o-mini-transcribe";
/**
 * TTS: openai (padrão, baixa latência) | gemini.
 * Voz masculina: OpenAI `cedar` (natural; marin é feminina). Gemini: Charon.
 */
const TTS_PROVIDER = (Deno.env.get("JARVIS_TTS_PROVIDER")?.trim() || "openai").toLowerCase();
const TTS_MODEL =
  Deno.env.get("JARVIS_TTS_MODEL")?.trim() ||
  (TTS_PROVIDER === "gemini" ? "gemini-2.5-flash-preview-tts" : "gpt-4o-mini-tts");
const TTS_VOICE =
  Deno.env.get("JARVIS_TTS_VOICE")?.trim() || (TTS_PROVIDER === "gemini" ? "Charon" : "cedar");
const TTS_STYLE =
  Deno.env.get("JARVIS_TTS_STYLE")?.trim() ||
  [
    "Voice: adult Brazilian man, mid-low pitch, warm and natural — senior colleague on a quick call, never a robot, announcer, or call-center script.",
    "Speak Brazilian Portuguese casually and clearly. Soft rhythm; short pause on commas, fuller stop on periods/ellipsis; rising intonation on questions; light emphasis on exclamations without shouting.",
    "Avoid metallic timbre, falsetto, sing-song cheerfulness, or rushed staccato.",
    "Do not invent words or read these instructions aloud.",
  ].join(" ");
const TTS_MAX_CHARS = 2000;
const TTS_SAMPLE_RATE = 24000;


type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const SYSTEM_PROMPT = `Você é o JARVIS no WDash (franquias WEPINK/WPINK). Chat só texto (ditado vira texto). Você SEMPRE escreve a resposta ao Gestor; as tools só trazem dado ou atualizam rascunho. Nunca diga que é um formulário, checklist ou chatbot de script.

Papel: colega / sócio sênior. Discute, pergunta, rebate, sugere. Uma ideia por vez. Interprete a intenção pelo sentido (oi, hi, opa, e aí, tudo bem, etc.) — o app não classifica cumprimento por lista de palavras; use bom senso.

Tom: português do Brasil, informal, humano (1 a 3 frases curtas). Números das tools com centavos (R$ 330.000,00). Separe ideias com linha em branco (\\n\\n). Nunca use travessão (—). Prefira ponto, vírgula ou pergunta direta.

Quando usar tool:
- Só se o Gestor pediu dado da base, análise, ou montar/ajustar meta, desafio ou escala.
- Cumprimento / small talk: responda humano (pode usar o primeiro nome do contexto), pergunte o que precisa. ZERO tools. Não invente relatório de vendas.

Continuidade: se já estão montando META e a resposta é curta (confirma mês, valor, “isso”), continue com draft_goal. Não pergunte de novo se é meta/desafio/escala.

Como pensar:
1) O que o Gestor quer AGORA (histórico + rascunho no contexto)?
2) É só conversa social? → fale e pare. Sem tool.
3) Falta mês, valor ou filial na meta? → pergunte SÓ isso (draft_goal se precisar atualizar estado). Não despeje histórico/feriados.
4) Precisa de número da base? → analyze_*.
5) Precisa montar/ajustar proposta? → draft_* e depois FALE naturalmente. Não vire menu.
6) Follow-up curto continua o fio.
7) Sazonal/feriado: no máximo 1 frase quando couber.

Domínio:
- META: valor, escada, modo, grupos, nível desafio/+10%, copiar config → analyze_goal e/ou draft_goal.
- DESAFIO (produto/disputa): draft_challenge (+ analyze_stock se fizer sentido).
- Rascunho de META aberto + "desafio" no sentido de nível/escada → draft_goal.
- Vendas/ticket/P.A. → analyze_sales (meta ≠ faturamento).
- Escala → draft_schedule.
- "Abre Visão geral / rola a página": resolve no chat; sem navegação.

Regras:
- META = só texto no chat. Confirmação curta ("cria a meta" / Autorizo) = Salvar rascunho (não publica). Nunca diga que já gravou/publicou se ainda está discutindo.
- Valor falado pelo Gestor (ex.: 270 mil) prevalece. Só sugira número se ele pedir. Use a sugestão da tool quando vier.
- Não copie escada/bônus/grupos sozinho; se a tool indicar meta anterior, pergunte se quer copiar.
- Sem copiar: pergunte grupos, rateio sem vendedor identificado, confirme níveis; peça "pode montar" antes de gravar.
- Desafio/escala: card + Autorizar. Nunca diga que gravou sozinho.
- Não invente número. Use EXATAMENTE a filial que a tool nomeou.
- No request de draft_*, descreva o pedido + o já combinado no histórico.
- Depois de draft_goal, leia o retorno da tool (pode vir como [INTERNAL_GOAL_STATE] JSON) e FALE como humano. PROIBIDO colar o bloco interno, listar campos (alvo_centavos, periodConfirmed, faltando, etc.) ou dizer "estado interno". Ex.: se falta mês → "Vamos lá!! Qual mês você quer fechar?". Se falta valor → pergunte o valor. Uma pergunta, pare.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "analyze_sales",
      description: "Consulta vendas/faturamento/ticket/P.A. na base do WDash (período e filial do contexto ou do pedido). NÃO use para perguntar o valor da meta cadastrada.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "Pedido do gestor em português" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_goal",
      description:
        "Lê a meta de faturamento cadastrada (valor-alvo) no período/filial. Use quando perguntarem quanto é a meta, qual a meta do mês, se tem meta. Opcionalmente inclui realizado vs meta.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "Pedido do gestor em português" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_stock",
      description: "Produtos parados no estoque (estoque × vendas ~30 dias).",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_seasonal",
      description:
        "Datas sazonais e feriados (Black Friday, Natal, Dia das Maes, feriados nacionais…). Use ao montar/sugerir meta ou desafio do periodo — nao espere o Gestor lembrar.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_challenge",
      description:
        "Cria ou ajusta o rascunho de DESAFIO de produto/disputa (Performance > Desafios). NÃO use para nível/escada da meta (nível desafio, +10%, config de outubro) — isso é draft_goal. Descreva o pedido completo em request.",
      parameters: {
        type: "object",
        properties: {
          request: { type: "string" },
        },
        required: ["request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_goal",
      description:
        "Cria ou ajusta a META (escada, modo, valor, período, nível desafio/+10%, copiar config). Em confirmação (criar/autorizar) o app grava RASCUNHO em Metas. Descreva o pedido completo em request.",
      parameters: {
        type: "object",
        properties: {
          request: { type: "string" },
        },
        required: ["request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_schedule",
      description:
        "Cria ou ajusta o rascunho de escala (ainda não grava). Use também para editar o rascunho atual: descreva em request o pedido completo. O app mostra o card Autorizar.",
      parameters: {
        type: "object",
        properties: {
          request: { type: "string" },
        },
        required: ["request"],
      },
    },
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey) return json({ ok: false, error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id, OWNER_ROLES);
  if (!caller) return json({ ok: false, error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const action = String(body.action ?? "chat");
  try {
    if (action === "speak") {
      if (TTS_PROVIDER === "gemini") {
        if (!geminiKey) return json({ ok: false, error: "gemini_not_configured" }, 503);
        return await handleSpeakGemini(geminiKey, body);
      }
      if (!openaiKey) return json({ ok: false, error: "openai_not_configured" }, 503);
      return await handleSpeakOpenAi(openaiKey, body);
    }
    if (action === "transcribe") {
      if (!openaiKey) return json({ ok: false, error: "openai_not_configured" }, 503);
      return await handleTranscribe(openaiKey, body);
    }
    if (action === "chat") {
      if (!geminiKey) return json({ ok: false, error: "gemini_not_configured" }, 503);
      return await handleChatGemini(geminiKey, body);
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "jarvis_error";
    console.error("jarvis-ai:", message);
    return json({ ok: false, error: message }, 502);
  }
});

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; response?: Record<string, unknown> };
};

function geminiFunctionDeclarations() {
  return TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

/** Converte o histórico OpenAI-like do app para contents do Gemini. */
function toGeminiContents(messages: ChatMessage[]): { role: string; parts: GeminiPart[] }[] {
  const contents: { role: string; parts: GeminiPart[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content || "" }] });
      continue;
    }
    if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
      if (parts.length === 0) parts.push({ text: "" });
      contents.push({ role: "model", parts });
      continue;
    }
    if (m.role === "tool") {
      const part: GeminiPart = {
        functionResponse: {
          name: m.name || "tool",
          response: { result: m.content || "" },
        },
      };
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts.some((p) => p.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
    }
  }
  return contents;
}

async function handleChatGemini(geminiKey: string, body: Record<string, unknown>) {
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return json({ ok: false, error: "messages_required" }, 400);
  }

  const contextNote =
    typeof body.contextNote === "string" && body.contextNote.trim()
      ? `\n\nContexto da sessão:\n${body.contextNote.trim()}`
      : "";

  const messages = rawMessages.map((m) => normalizeMessage(m));
  const contents = toGeminiContents(messages);
  if (contents.length === 0) return json({ ok: false, error: "messages_required" }, 400);

  const url =
    `${GEMINI_URL}/models/${encodeURIComponent(CHAT_MODEL)}:generateContent` +
    `?key=${encodeURIComponent(geminiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT + contextNote }] },
      contents,
      tools: [{ functionDeclarations: geminiFunctionDeclarations() }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 512,
      },
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    const detail = payload?.error?.message ?? `gemini_http_${res.status}`;
    throw new Error(String(detail));
  }

  const parts: GeminiPart[] = payload?.candidates?.[0]?.content?.parts ?? [];
  if (!Array.isArray(parts) || parts.length === 0) throw new Error("empty_completion");

  const functionCalls = parts.filter((p) => p.functionCall?.name);
  if (functionCalls.length > 0) {
    const textBits = parts
      .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
      .filter(Boolean);
    const tool_calls: ToolCall[] = functionCalls.map((p, i) => ({
      id: `gemini_${i}_${p.functionCall!.name}`,
      type: "function",
      function: {
        name: String(p.functionCall!.name),
        arguments: JSON.stringify(p.functionCall!.args ?? {}),
      },
    }));
    return json({
      ok: true,
      type: "tool_calls",
      assistant: {
        role: "assistant",
        content: textBits.length > 0 ? textBits.join("\n\n") : null,
        tool_calls,
      },
    });
  }

  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();
  if (!text) throw new Error("empty_content");
  return json({ ok: true, type: "message", content: text });
}

async function handleTranscribe(openaiKey: string, body: Record<string, unknown>) {
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mime = typeof body.mime === "string" && body.mime ? body.mime : "audio/webm";
  if (!audioBase64 || audioBase64.length < 32) {
    return json({ ok: false, error: "audio_required" }, 400);
  }
  // ~4 MB base64 ≈ 3 MB áudio
  if (audioBase64.length > 5_500_000) {
    return json({ ok: false, error: "audio_too_large" }, 413);
  }

  const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";

  async function transcribeWith(model: string) {
    const form = new FormData();
    form.append("file", new File([binary], `speech.${ext}`, { type: mime }));
    form.append("model", model);
    form.append("language", "pt");
    const res = await fetch(`${OPENAI_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    const payload = await res.json();
    return { res, payload };
  }

  let { res, payload } = await transcribeWith(STT_MODEL);
  if (!res.ok && STT_MODEL !== "whisper-1") {
    ({ res, payload } = await transcribeWith("whisper-1"));
  }
  if (!res.ok) {
    const detail = payload?.error?.message ?? `stt_http_${res.status}`;
    throw new Error(String(detail));
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return json({ ok: false, error: "empty_transcript" }, 422);
  return json({ ok: true, type: "transcript", text });
}

function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

/** PCM L16 LE mono 24 kHz → WAV com cabeçalho RIFF. */
function pcmToWav(pcm: Uint8Array, sampleRate = TTS_SAMPLE_RATE): Uint8Array {
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/** TTS OpenAI → MP3 (baixa latência; voz masculina cedar). */
async function handleSpeakOpenAi(openaiKey: string, body: Record<string, unknown>) {
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return json({ ok: false, error: "text_required" }, 400);
  const text = raw.length > TTS_MAX_CHARS ? `${raw.slice(0, TTS_MAX_CHARS - 1)}…` : raw;
  const voice = TTS_VOICE;

  const payload: Record<string, unknown> = {
    model: TTS_MODEL,
    voice,
    input: text,
    response_format: "mp3",
  };
  if (TTS_MODEL.includes("gpt-4o-mini-tts") || TTS_MODEL.includes("gpt-4o-tts")) {
    payload.instructions = TTS_STYLE;
  }

  const res = await fetch(`${OPENAI_URL}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = `tts_http_${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.error?.message) detail = String(errBody.error.message);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 64) throw new Error("empty_audio");
  return json({
    ok: true,
    type: "speech",
    mime: "audio/mpeg",
    audioBase64: bytesToBase64(bytes),
    voice,
    provider: "openai",
  });
}

/** TTS Gemini → WAV (opcional; mais lento que OpenAI Speech). */
async function handleSpeakGemini(geminiKey: string, body: Record<string, unknown>) {
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return json({ ok: false, error: "text_required" }, 400);
  const text = raw.length > TTS_MAX_CHARS ? `${raw.slice(0, TTS_MAX_CHARS - 1)}…` : raw;
  const voice = TTS_VOICE;
  const useSpeechMeta = TTS_MODEL.includes("3.8") || TTS_MODEL.includes("gemini-3");

  const part: Record<string, unknown> = useSpeechMeta
    ? { text, speechMetadata: { style: TTS_STYLE } }
    : { text };

  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: TTS_STYLE }] },
    contents: [{ role: "user", parts: [part] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  };

  const url = `${GEMINI_URL}/models/${encodeURIComponent(TTS_MODEL)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (!res.ok) {
    const detail = result?.error?.message ?? `gemini_tts_http_${res.status}`;
    throw new Error(String(detail));
  }

  const inline =
    result?.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data?: string; mimeType?: string } }) => p?.inlineData?.data,
    )?.inlineData ??
    result?.candidates?.[0]?.content?.parts?.[0]?.inlineData;

  const b64 = typeof inline?.data === "string" ? inline.data : "";
  if (!b64) throw new Error("empty_audio");

  const rawBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (rawBytes.length < 64) throw new Error("empty_audio");

  const mimeHint = typeof inline?.mimeType === "string" ? String(inline.mimeType).toLowerCase() : "";
  const wavBytes = isWav(rawBytes) || mimeHint.includes("wav") ? rawBytes : pcmToWav(rawBytes);

  return json({
    ok: true,
    type: "speech",
    mime: "audio/wav",
    audioBase64: bytesToBase64(wavBytes),
    voice,
    provider: "gemini",
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function normalizeMessage(raw: unknown): ChatMessage {
  const m = raw as Record<string, unknown>;
  const role = String(m.role ?? "user") as ChatMessage["role"];
  const msg: ChatMessage = {
    role,
    content: m.content == null ? null : String(m.content),
  };
  if (Array.isArray(m.tool_calls)) {
    msg.tool_calls = m.tool_calls as ToolCall[];
  }
  if (typeof m.tool_call_id === "string") msg.tool_call_id = m.tool_call_id;
  if (typeof m.name === "string") msg.name = m.name;
  return msg;
}
