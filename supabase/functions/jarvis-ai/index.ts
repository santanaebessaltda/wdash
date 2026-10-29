/**
 * jarvis-ai — chat/Whisper (OpenAI) + TTS (Gemini) só para Gestor.
 * OPENAI_API_KEY e GEMINI_API_KEY em secrets. Nunca no front.
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
 * Gemini TTS — voz fixa do JARVIS (= Jarvis clássico / Neutro do Néctar → Charon).
 * Override só via secret: JARVIS_TTS_MODEL / JARVIS_TTS_VOICE.
 */
const TTS_MODEL = Deno.env.get("JARVIS_TTS_MODEL")?.trim() || "gemini-2.5-flash-preview-tts";
const TTS_VOICE = Deno.env.get("JARVIS_TTS_VOICE")?.trim() || "Charon";
const TTS_STYLE =
  Deno.env.get("JARVIS_TTS_STYLE")?.trim() ||
  "neutro, claro e natural em português do Brasil; respeite vírgulas e pausas; sem ritmo de robô";
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

const SYSTEM_PROMPT = `Você é o JARVIS, sócio sênior do Gestor no WDash (rede de franquias WEPINK/WPINK).

Tom: português do Brasil, informal e humano — como o Néctar. Papo de quem resolve, não de manual.

Velocidade e naturalidade:
- Respostas CURTAS: em geral 1 a 3 frases. Vai direto ao ponto.
- Números: cite o essencial (ex.: “um milhão e cento e noventa e dois mil”); sem relatório.
- Cumprimento (“oi”, “e aí”): uma frase só, sem listar habilidades.
- Se precisar de tool, chame na hora — sem enrolação antes.

Regras:
- Nunca invente faturamento, estoque, meta, comissão ou qualquer número. Use as tools de análise.
- Meta, desafio e escala: você só discute e pede rascunho via tool. Gravar de verdade é o Gestor no botão Autorizar — nunca diga que já gravou sozinho.
- Navegação: use a tool navigate quando pedirem para abrir uma tela.
- Se faltar dado da tool, fale que faltou — não chute.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "analyze_sales",
      description: "Consulta vendas/faturamento/ticket/P.A. na base do WDash (período e filial do contexto ou do pedido).",
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
      description: "Próximas datas sazonais e feriados relevantes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Abre uma tela do app (Visão geral, Financeiro, Escala, Metas, etc.).",
      parameters: {
        type: "object",
        properties: {
          request: { type: "string", description: "Ex.: abre Visão geral" },
        },
        required: ["request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_challenge",
      description: "Monta rascunho de desafio (ainda não grava). O app mostra card Autorizar.",
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
      description: "Monta rascunho de meta (ainda não grava).",
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
      description: "Monta rascunho de escala (ainda não grava).",
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
      if (!geminiKey) return json({ ok: false, error: "gemini_not_configured" }, 503);
      return await handleSpeak(geminiKey, body);
    }
    if (!openaiKey) return json({ ok: false, error: "openai_not_configured" }, 503);
    if (action === "transcribe") {
      return await handleTranscribe(openaiKey, body);
    }
    if (action === "chat") {
      return await handleChat(openaiKey, body);
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "jarvis_error";
    console.error("jarvis-ai:", message);
    return json({ ok: false, error: message }, 502);
  }
});

async function handleChat(openaiKey: string, body: Record<string, unknown>) {
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return json({ ok: false, error: "messages_required" }, 400);
  }

  const contextNote =
    typeof body.contextNote === "string" && body.contextNote.trim()
      ? `\n\nContexto da sessão:\n${body.contextNote.trim()}`
      : "";
  const voiceMode = body.voiceMode === true;
  const voiceHint = voiceMode
    ? "\n\nModo voz ativo: responda como papo ao vivo — 1 a 3 frases, sem markdown, sem listas. Use vírgulas naturais (ex.: “Pronto, Romeu — tô na Visão geral”)."
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextNote + voiceHint },
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
      temperature: voiceMode ? 0.55 : 0.65,
      max_tokens: voiceMode ? 280 : 450,
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    const detail = payload?.error?.message ?? `openai_http_${res.status}`;
    throw new Error(String(detail));
  }

  const choice = payload?.choices?.[0]?.message;
  if (!choice) throw new Error("empty_completion");

  const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
  if (toolCalls.length > 0) {
    return json({
      ok: true,
      type: "tool_calls",
      assistant: {
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: toolCalls,
      },
    });
  }

  const text = typeof choice.content === "string" ? choice.content.trim() : "";
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

/** TTS Gemini → WAV em base64. Voz/tom fixos (sem picker no app). */
async function handleSpeak(geminiKey: string, body: Record<string, unknown>) {
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return json({ ok: false, error: "text_required" }, 400);
  const text = raw.length > TTS_MAX_CHARS ? `${raw.slice(0, TTS_MAX_CHARS - 1)}…` : raw;
  const voice = TTS_VOICE;
  const useSpeechMeta = TTS_MODEL.includes("3.8") || TTS_MODEL.includes("gemini-3");

  const part: Record<string, unknown> = { text };
  if (useSpeechMeta) {
    part.speechMetadata = { style: TTS_STYLE };
  } else {
    // Prompt curto: evita “Diga exatamente” (soava mais robótico que o Néctar).
    part.text = `(${TTS_STYLE})\n${text}`;
  }

  const payload = {
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
