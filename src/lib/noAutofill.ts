import type { CSSProperties } from "react";

/**
 * Campos de credencial de terceiros (ex.: Millennium) que NAO podem virar login salvo da WDash.
 * Chrome/Safari ignoram autocomplete="off" quando ha um input type="password" na tela e passam a
 * sugerir esse usuario no E-mail do login  -  por isso a senha usa type="text" mascarado (`secretStyle`).
 */
export const noAutofill = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
} as const;

export function secretStyle(visivel: boolean): CSSProperties {
  return { WebkitTextSecurity: visivel ? "none" : "disc" } as CSSProperties;
}
