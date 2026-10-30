/**
 * jarvis-ai — chat + Whisper/TTS só para Gestor.
 * Chat = OpenAI (OPENAI_API_KEY). STT = Whisper. TTS = OpenAI (padrão) ou Gemini.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";

const OPENAI_URL = "https://api.openai.com/v1";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const CHAT_MODEL = Deno.env.get("JARVIS_CHAT_MODEL")?.trim() || "gpt-4o-mini";
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

const SYSTEM_PROMPT = `Você é o JARVIS no WDash (franquias WEPINK/WPINK). Chat só texto (ditado vira texto).

Papel: sócio sênior — discute, pergunta, rebate, sugere. Uma ideia por vez. Você SEMPRE escreve a fala ao Gestor; tools só buscam dado ou mudam estado no app. Nunca diga que é formulário, checklist ou bot de script.

O app NÃO escreve a conversa por você e NÃO classifica palavra-chave. Toda fala ao Gestor é SUA (prompt). Tools só executam (dado/estado). Sem o draft_goal no fio de meta, o estado some.

Tom: português do Brasil, informal, humano (1–3 frases curtas). Números das tools com centavos (R$ 330.000,00). Separe ideias com linha em branco (\\n\\n). Nunca use travessão (—).

Como decidir em cada turno:
1) O que o Gestor quer AGORA (histórico + rascunhos no contexto)?
2) Só cumprimentou / small talk? → humano pelo nome e PARE. ZERO tools. Sem inventar relatório.
3) Criar/ajustar META ou follow-up curto do fio (mês, valor, “isso”) → SEMPRE draft_goal neste turno. Sem isso o app não guarda o mês/valor.
4) Não pergunte de novo se é meta/desafio/escala. Não volte a menu genérico no meio do fio.
5) Um dado por vez (mês → valor → config). Mês já confirmado no contexto → nunca peça o mês de novo.
6) Número da base → analyze_*. Autorizar/gravar → commit_draft. Descartar → discard_draft.
7) “Abre tela” → responde no chat, sem navegação.
8) Sazonal: no máx. 1 frase ao sugerir valor.

Domínio das tools:
- analyze_sales → vendas/ticket/P.A. (meta cadastrada ≠ faturamento).
- analyze_goal → valor-alvo da meta já cadastrada.
- analyze_stock → estoque parado.
- analyze_seasonal → calendário sazonal.
- draft_goal → discutir/ajustar META. META = só texto no chat, sem card. Ainda NÃO grava.
- draft_challenge → DESAFIO de produto/disputa (card). Nível/escada da meta ≠ desafio de produto.
- draft_schedule → escala (card).
- commit_draft → grava (meta = Salvar rascunho; desafio/escala = cria).
- discard_draft → apaga rascunho.

Regras de negócio:
- Nunca diga que já gravou se ainda está discutindo. Só após commit_draft ok.
- Valor falado pelo Gestor prevalece. Só sugira número se ele pedir; use a sugestão da tool.
- Não copie escada/bônus/grupos sozinho; pergunte. Sem copiar: grupos, rateio, níveis; peça ok antes de commit.
- Não invente número. Use EXATAMENTE a filial que a tool nomeou.
- No request de draft_*, descreva o pedido + o já combinado no histórico.
- Depois de draft_goal, leia [INTERNAL_GOAL_STATE] e FALE como humano. PROIBIDO colar o bloco ou campos técnicos. Uma pergunta, pare.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "analyze_sales",
      description:
        "Consulta vendas/faturamento/ticket/P.A. na base do WDash. NÃO use em cumprimento (oi/opa/e aí). NÃO use para valor da meta cadastrada.",
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
        "Lê a meta de faturamento cadastrada (valor-alvo) no período/filial. Use quando perguntarem quanto é a meta, qual a meta do mês, se tem meta.",
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
        "Datas sazonais e feriados. Use ao montar/sugerir meta ou desafio do periodo. Sem argumentos.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Por que precisa do calendário sazonal (opcional)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_challenge",
      description:
        "Cria ou ajusta o rascunho de DESAFIO de produto/disputa. NÃO use para nível/escada da meta — isso é draft_goal. Ainda não grava.",
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
        "Cria ou ajusta a discussão da META (escada, modo, valor, período…). Ainda NÃO grava. Para gravar use commit_draft target=goal.",
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
        "Cria ou ajusta o rascunho de escala (ainda não grava). O app mostra o card Autorizar.",
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
      name: "commit_draft",
      description:
        "Grava o rascunho aberto. target=goal → Salvar rascunho em Metas (não publica). target=challenge|schedule → cria de verdade. Use quando o Gestor autorizar/confirmar claramente.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "goal | challenge | schedule",
          },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discard_draft",
      description:
        "Descarta o rascunho aberto. target=goal|challenge|schedule|all. Use quando o Gestor pedir cancelar/esquecer/descartar.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "goal | challenge | schedule | all",
          },
        },
        required: ["target"],
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
      if (!openaiKey) return json({ ok: false, error: "openai_not_configured" }, 503);
      return await handleChatOpenAi(openaiKey, body);
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "jarvis_error";
    console.error("jarvis-ai:", message);
    return json({ ok: false, error: message }, 502);
  }
});

async function handleChatOpenAi(openaiKey: string, body: Record<string, unknown>) {
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return json({ ok: false, error: "messages_required" }, 400);
  }

  const contextNote =
    typeof body.contextNote === "string" && body.contextNote.trim()
      ? `\n\nContexto da sessão:\n${body.contextNote.trim()}`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextNote },
    ...rawMessages.map((m) => normalizeMessage(m)),
  ];

  const res = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 512,
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    const detail = payload?.error?.message ?? `openai_http_${res.status}`;
    throw new Error(String(detail));
  }

  const choice = payload?.choices?.[0]?.message as
    | {
        role?: string;
        content?: string | null;
        tool_calls?: ToolCall[];
      }
    | undefined;
  if (!choice) throw new Error("empty_completion");

  if (choice.tool_calls && choice.tool_calls.length > 0) {
    return json({
      ok: true,
      type: "tool_calls",
      assistant: {
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls,
      },
    });
  }

  const text = (choice.content || "").trim();
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
