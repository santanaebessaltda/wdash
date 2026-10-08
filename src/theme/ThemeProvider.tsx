import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "dark" | "light";
/** Escolha do usuario; "system" segue o tema do aparelho. */
export type ThemePreference = Theme | "system";

type ThemeContextValue = {
  /** Tema aplicado (ja resolvido quando a escolha e "system"). */
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Copia da escolha salva na conta (abre ja no tema certo, antes da conta responder).
 * So gravado quando ha escolha; "vela-theme" era gravado sozinho com "dark" e fica ignorado.
 */
const STORAGE_KEY = "wedash.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Escolha guardada neste aparelho; `null` = nunca escolheu aqui. */
export function storedThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : null;
}

function getInitialPreference(): ThemePreference {
  return storedThemePreference() ?? "system";
}

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme: Theme = preference === "system" ? system : preference;

  useEffect(() => {
    if (preference !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const choose = useCallback((p: ThemePreference) => {
    window.localStorage.setItem(STORAGE_KEY, p);
    setPreference(p);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    return {
      theme,
      preference,
      setPreference: choose,
      toggleTheme: () => choose(theme === "dark" ? "light" : "dark"),
      setTheme: choose,
    };
  }, [theme, preference, choose]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
