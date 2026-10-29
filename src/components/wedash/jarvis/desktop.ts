/** Palmas / wake global: só desktop com ponteiro fino (não celular). */
export function isJarvisDesktop(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}
