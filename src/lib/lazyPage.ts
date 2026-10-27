import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "wedash.chunk-reload";
const RELOAD_MAX = 2;

/**
 * Wrap a named page export in React.lazy so each route becomes its own async
 * chunk, while preserving the component's prop types. Usage:
 * `const Page = lazyPage(() => import("./Page"), "Page");`
 * Requires a <Suspense> boundary above the rendered element (see AppShell /
 * AuthLayout).
 *
 * Apos um deploy, o shell antigo ainda tenta baixar chunks com hash velho
 * (404). Sem recovery a rota fica em branco ate o F5. Aqui recarregamos ate
 * RELOAD_MAX vezes; se ainda falhar, a Promise rejeita (o Suspense/erro sobe).
 */
export function lazyPage<M, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K] extends ComponentType<infer P> ? ComponentType<P> : never> {
  return lazy(() =>
    loader()
      .then((m) => {
        try {
          sessionStorage.removeItem(RELOAD_KEY);
          sessionStorage.removeItem("wedash.boundary-reload");
        } catch {
          /* private mode */
        }
        const page = m[name];
        if (page == null) {
          throw new Error(`lazyPage: export "${String(name)}" missing`);
        }
        return { default: page as ComponentType<unknown> };
      })
      .catch((err: unknown) => {
        try {
          const n = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
          if (n < RELOAD_MAX) {
            sessionStorage.setItem(RELOAD_KEY, String(n + 1));
            window.location.reload();
            return new Promise(() => {
              /* nunca resolve: a pagina esta recarregando */
            });
          }
        } catch {
          /* private mode: segue pro throw */
        }
        throw err;
      }),
  ) as LazyExoticComponent<M[K] extends ComponentType<infer P> ? ComponentType<P> : never>;
}
