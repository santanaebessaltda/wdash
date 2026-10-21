import { useEffect, useState } from "react";

/** Aparência só do placar, neste aparelho. Não altera a Aparência da conta. */
export type BoardTheme = "light" | "dark";

const STORAGE_KEY = "wedash.board-theme";
const EVENT = "wedash:board-theme";

export function readBoardTheme(): BoardTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function writeBoardTheme(theme: BoardTheme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* o placar troca mesmo sem gravar */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useBoardTheme(): [BoardTheme, (theme: BoardTheme) => void] {
  const [theme, setTheme] = useState<BoardTheme>(readBoardTheme);

  useEffect(() => {
    const sync = () => setTheme(readBoardTheme());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [theme, writeBoardTheme];
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition-colors";

export function BoardThemeSwitch() {
  const [theme, setTheme] = useBoardTheme();
  return (
    <div role="group" aria-label="Aparência do placar" className="inline-flex gap-1.5">
      <button
        type="button"
        className={`${iconBtn} ${theme === "light" ? "border-acc bg-acc-soft text-acc" : "border-line text-t1 hover:border-acc"}`}
        aria-pressed={theme === "light"}
        aria-label="Tema claro"
        title="Tema claro"
        onClick={() => setTheme("light")}
      >
        <SunIcon />
      </button>
      <button
        type="button"
        className={`${iconBtn} ${theme === "dark" ? "border-acc bg-acc-soft text-acc" : "border-line text-t1 hover:border-acc"}`}
        aria-pressed={theme === "dark"}
        aria-label="Tema escuro"
        title="Tema escuro"
        onClick={() => setTheme("dark")}
      >
        <MoonIcon />
      </button>
    </div>
  );
}
