/**
 * jarvis-ai — OpenAI (chat + Whisper) só para Gestor.
 * OPENAI_API_KEY em secrets do projeto. Nunca no front.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";

const OPENAI_URL = "https://api.openai.com/v1";
const CHAT_MODEL = Deno.env.get("JARVIS_CHAT_MODEL")?.trim() || "gpt-4o-mini";
const WHISPER_MODEL = "whisper-1";

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

Tom: português do Brasil, informal e humano — como o Néctar. Frases curtas. Sem jargão de manual, sem listar o cardápio inteiro a cada oi.

Regras:
- Nunca invente faturamento, estoque, meta, comissão ou qualquer número. Use as tools de análise.
- Meta, desafio e escala: você só discute e pede rascunho via tool. Gravar de verdade é o Gestor no botão Autorizar — nunca diga que já gravou sozinho.
- Navegação: use a tool navigate quando pedirem para abrir uma tela.
- Se faltar dado da tool, fale que faltou — não chute.
- Cumprimento (“oi”, “e aí”): responda curto e humano, sem despejar todas as habilidades.`;

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
  if (!openaiKey) return json({ ok: false, error: "openai_not_configured" }, 503);

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
    if (action === "transcribe") {
      return await handleTranscribe(openaiKey, body);
    }
    if (action === "chat") {
      return await handleChat(openaiKey, body);
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "openai_error";
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
  const form = new FormData();
  form.append("file", new File([binary], `speech.${ext}`, { type: mime }));
  form.append("model", WHISPER_MODEL);
  form.append("language", "pt");

  const res = await fetch(`${OPENAI_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
  const payload = await res.json();
  if (!res.ok) {
    const detail = payload?.error?.message ?? `whisper_http_${res.status}`;
    throw new Error(String(detail));
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return json({ ok: false, error: "empty_transcript" }, 422);
  return json({ ok: true, type: "transcript", text });
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
