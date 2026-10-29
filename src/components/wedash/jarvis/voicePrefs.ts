/** Preferências de voz Gemini TTS (estilo Néctar). Persistidas no aparelho. */

export type VoiceTone = "neutral" | "serious" | "calm" | "lively";

export type VoiceCategory = "classic" | "male" | "female";

export type VoiceOption = {
  /** Id estável na UI (JARVIS clássico ≠ id Gemini). */
  id: string;
  /** Nome prebuilt Gemini (Charon, Kore…). */
  geminiVoice: string;
  label: string;
  blurb: string;
  category: VoiceCategory;
};

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "jarvis",
    geminiVoice: "Charon",
    label: "JARVIS",
    blurb: "A voz clássica do Chat IA",
    category: "classic",
  },
  {
    id: "charon",
    geminiVoice: "Charon",
    label: "Charon",
    blurb: "Âncora • sério e informativo",
    category: "male",
  },
  {
    id: "algenib",
    geminiVoice: "Algenib",
    label: "Algenib",
    blurb: "Grave • profundo e firme",
    category: "male",
  },
  {
    id: "orus",
    geminiVoice: "Orus",
    label: "Orus",
    blurb: "Firme • equilibrado",
    category: "male",
  },
  {
    id: "algieba",
    geminiVoice: "Algieba",
    label: "Algieba",
    blurb: "Suave • macio",
    category: "male",
  },
  {
    id: "puck",
    geminiVoice: "Puck",
    label: "Puck",
    blurb: "Animado • jovem e enérgico",
    category: "male",
  },
  {
    id: "kore",
    geminiVoice: "Kore",
    label: "Kore",
    blurb: "Firme • séria e profissional",
    category: "female",
  },
  {
    id: "sulafat",
    geminiVoice: "Sulafat",
    label: "Sulafat",
    blurb: "Calorosa • acolhedora",
    category: "female",
  },
  {
    id: "aoede",
    geminiVoice: "Aoede",
    label: "Aoede",
    blurb: "Leve • natural",
    category: "female",
  },
  {
    id: "leda",
    geminiVoice: "Leda",
    label: "Leda",
    blurb: "Jovem • jovial",
    category: "female",
  },
  {
    id: "zephyr",
    geminiVoice: "Zephyr",
    label: "Zephyr",
    blurb: "Brilhante • enérgica",
    category: "female",
  },
];

export const TONE_OPTIONS: { id: VoiceTone; label: string }[] = [
  { id: "neutral", label: "Neutro" },
  { id: "serious", label: "Sério" },
  { id: "calm", label: "Calmo" },
  { id: "lively", label: "Animado" },
];

const KEY_VOICE = "wedash.jarvis.voice";
const KEY_TONE = "wedash.jarvis.tone";
const KEY_TONE_CUSTOM = "wedash.jarvis.toneCustom";

const DEFAULT_VOICE_ID = "charon";
const DEFAULT_TONE: VoiceTone = "neutral";

export type VoicePrefs = {
  voiceId: string;
  tone: VoiceTone;
  toneCustom: string;
};

export function findVoiceOption(voiceId: string): VoiceOption {
  return VOICE_OPTIONS.find((v) => v.id === voiceId) ?? VOICE_OPTIONS.find((v) => v.id === DEFAULT_VOICE_ID)!;
}

export function toneLabel(tone: VoiceTone): string {
  return TONE_OPTIONS.find((t) => t.id === tone)?.label ?? "Neutro";
}

/** Texto de estilo enviado à Edge (custom tem prioridade). */
export function styleForSpeak(prefs: VoicePrefs): string {
  const custom = prefs.toneCustom.trim();
  if (custom) return custom.slice(0, 240);
  switch (prefs.tone) {
    case "serious":
      return "sério e informativo, firme, sem exagero";
    case "calm":
      return "calmo e acolhedor, ritmo pausado";
    case "lively":
      return "animado e próximo, leve energia positiva";
    default:
      return "neutro, conversacional e natural";
  }
}

export function readVoicePrefs(): VoicePrefs {
  try {
    const voiceId = localStorage.getItem(KEY_VOICE)?.trim() || DEFAULT_VOICE_ID;
    const toneRaw = localStorage.getItem(KEY_TONE)?.trim() as VoiceTone | null;
    const tone: VoiceTone =
      toneRaw === "serious" || toneRaw === "calm" || toneRaw === "lively" || toneRaw === "neutral"
        ? toneRaw
        : DEFAULT_TONE;
    const toneCustom = localStorage.getItem(KEY_TONE_CUSTOM)?.trim() || "";
    const known = VOICE_OPTIONS.some((v) => v.id === voiceId);
    return {
      voiceId: known ? voiceId : DEFAULT_VOICE_ID,
      tone,
      toneCustom,
    };
  } catch {
    return { voiceId: DEFAULT_VOICE_ID, tone: DEFAULT_TONE, toneCustom: "" };
  }
}

export function writeVoicePrefs(next: Partial<VoicePrefs>): VoicePrefs {
  const cur = readVoicePrefs();
  const merged: VoicePrefs = {
    voiceId: next.voiceId ?? cur.voiceId,
    tone: next.tone ?? cur.tone,
    toneCustom: next.toneCustom !== undefined ? next.toneCustom : cur.toneCustom,
  };
  if (!VOICE_OPTIONS.some((v) => v.id === merged.voiceId)) {
    merged.voiceId = DEFAULT_VOICE_ID;
  }
  try {
    localStorage.setItem(KEY_VOICE, merged.voiceId);
    localStorage.setItem(KEY_TONE, merged.tone);
    localStorage.setItem(KEY_TONE_CUSTOM, merged.toneCustom);
  } catch {
    /* private mode */
  }
  return merged;
}

export function voiceCategoryLabel(cat: VoiceCategory): string {
  if (cat === "classic") return "Clássica";
  if (cat === "male") return "Masculinas";
  return "Femininas";
}
