/** Accent colors do tema Vela (Settings > Theme). */
export const ACCENTS = ["#7c5cff", "#56a8ff", "#2fd48f", "#ff7a5c", "#f7b84e", "#f76d7d"] as const;

export type AccentColor = (typeof ACCENTS)[number];

export const ACCENT_DEFAULT: AccentColor = ACCENTS[0];
