/** Rola o miolo do AppShell (o `<main>` com overflow). */
export function scrollAppMain(opts?: { top?: number; behavior?: ScrollBehavior }): void {
  if (typeof document === "undefined") return;
  const main = document.querySelector("main");
  if (!main) return;
  main.scrollTo({
    top: opts?.top ?? 0,
    behavior: opts?.behavior ?? "smooth",
  });
}
