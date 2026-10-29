import { useEffect, useRef, useState } from "react";
import { firstNameFrom, voicePreviewLine } from "@/components/wedash/jarvis/greeting";
import { speak, stopSpeaking } from "@/components/wedash/jarvis/speech";
import {
  findVoiceOption,
  readVoicePrefs,
  styleForSpeak,
  toneLabel,
  TONE_OPTIONS,
  VOICE_OPTIONS,
  voiceCategoryLabel,
  writeVoicePrefs,
  type VoiceCategory,
  type VoiceOption,
  type VoicePrefs,
  type VoiceTone,
} from "@/components/wedash/jarvis/voicePrefs";
import { cn } from "@/lib/cn";
import { useActiveSession } from "@/session/SessionProvider";

const CATEGORIES: VoiceCategory[] = ["classic", "male", "female"];

function MicGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function VoiceSettingsPage() {
  const session = useActiveSession();
  const [prefs, setPrefs] = useState<VoicePrefs>(() => readVoicePrefs());
  const [previewBusy, setPreviewBusy] = useState(false);
  const cancelPreview = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cancelPreview.current?.();
      stopSpeaking();
    };
  }, []);

  const current = findVoiceOption(prefs.voiceId);
  const toneDesc = prefs.toneCustom.trim()
    ? prefs.toneCustom.trim()
    : `tom: ${toneLabel(prefs.tone)}`;

  function patch(next: Partial<VoicePrefs>) {
    setPrefs(writeVoicePrefs(next));
  }

  function playPreview(option?: VoiceOption) {
    cancelPreview.current?.();
    stopSpeaking();
    const voice = option ?? current;
    const nextPrefs: VoicePrefs = option
      ? { ...prefs, voiceId: option.id }
      : prefs;
    if (option) patch({ voiceId: option.id });
    setPreviewBusy(true);
    const line = voicePreviewLine(firstNameFrom(session.name));
    cancelPreview.current = speak(line, {
      voice: voice.geminiVoice,
      tone: nextPrefs.tone,
      style: styleForSpeak(nextPrefs),
      onEnd: () => setPreviewBusy(false),
    });
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Voz atual</p>
        <div className="flex items-center gap-3 rounded-[14px] border border-line bg-bg-2 px-3.5 py-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-acc/15 text-acc">
            <MicGlyph />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-t0">{current.label}</p>
            <p className="truncate text-[12px] text-t2">
              {current.blurb}
              <span className="text-acc"> · {toneDesc}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => playPreview()}
            disabled={previewBusy}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12px] font-semibold text-t0 hover:border-acc hover:text-acc disabled:opacity-50"
          >
            <PlayGlyph />
            Ouvir prévia
          </button>
        </div>
      </section>

      <section>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Vozes</p>
        <div className="flex flex-col gap-5">
          {CATEGORIES.map((cat) => {
            const rows = VOICE_OPTIONS.filter((v) => v.category === cat);
            if (rows.length === 0) return null;
            return (
              <div key={cat}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-t2">
                  {voiceCategoryLabel(cat)}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {rows.map((v) => {
                    const selected = prefs.voiceId === v.id;
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => {
                            patch({ voiceId: v.id });
                            playPreview(v);
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors",
                            selected ? "border-acc/50 bg-acc-soft" : "border-line bg-bg-2 hover:border-acc/40",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                              selected ? "bg-acc text-white" : "bg-bg-3 text-t2",
                            )}
                            aria-hidden
                          >
                            <PlayGlyph />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-bold text-t0">{v.label}</span>
                            <span className="block truncate text-[11.5px] text-t2">{v.blurb}</span>
                          </span>
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                              selected ? "border-acc bg-acc text-white" : "border-line text-transparent",
                            )}
                          >
                            <CheckGlyph />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Tom</p>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((t) => {
            const on = prefs.tone === t.id && !prefs.toneCustom.trim();
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => patch({ tone: t.id as VoiceTone, toneCustom: "" })}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  on ? "border-acc bg-acc-soft text-acc" : "border-line text-t1 hover:border-acc/50",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-t2">Ou descreva do seu jeito</span>
          <input
            value={prefs.toneCustom}
            onChange={(e) => patch({ toneCustom: e.target.value })}
            placeholder="como um conselheiro calmo"
            className="h-10 w-full rounded-[10px] border border-line bg-bg-inset px-3 text-[13px] text-t0 outline-none placeholder:text-t2 focus:border-acc"
          />
        </label>
        <p className="mt-2 text-[11px] text-t2">Os quatro acima ajustam o estilo na hora; a prévia usa a API Gemini.</p>
      </section>
    </div>
  );
}

export default VoiceSettingsPage;
