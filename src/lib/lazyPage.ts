import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "wedash.chunk-reload";

/**
 * Wrap a named page export in React.lazy so each route becomes its own async
 * chunk, while preserving the component's prop types. Usage:
 * `const Page = lazyPage(() => import("./Page"), "Page");`
 * Requires a <Suspense> boundary above the rendered element (see AppShell /
 * AuthLayout).
 *
 * Apos um deploy, o shell antigo ainda tenta baixar chunks com hash velho
 * (404). Sem recovery a rota fica em branco ate o F5. Aqui recarregamos 1x.
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
        } catch {
          /* private mode */
        }
        return { default: m[name] as ComponentType<unknown> };
      })
      .catch((err: unknown) => {
        try {
          if (!sessionStorage.getItem(RELOAD_KEY)) {
            sessionStorage.setItem(RELOAD_KEY, "1");
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
