import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui";

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

export function BoardThemeSwitch() {
  const [theme, setTheme] = useBoardTheme();
  return (
    <div role="group" aria-label="Aparência do placar">
      <Segmented
        options={[
          { value: "light", label: "Claro" },
          { value: "dark", label: "Escuro" },
        ]}
        value={theme}
        onChange={(value) => {
          if (value) setTheme(value);
        }}
      />
    </div>
  );
}
