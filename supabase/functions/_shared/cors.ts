/**
 * CORS das Edges: só a origem do app (e localhost de desenvolvimento).
 * O contexto da request via AsyncLocalStorage para o spread `...corsHeaders` continuar igual.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage<Request>();

const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "https://wdash.app").replace(/\/$/, "");

function allowedOrigins(): Set<string> {
  const extra = (Deno.env.get("CORS_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([APP_ORIGIN, ...extra]);
}

function headersFor(req: Request | undefined): Record<string, string> {
  const origin = req?.headers.get("Origin")?.replace(/\/$/, "") ?? "";
  const allow = allowedOrigins().has(origin) ? origin : APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/** Spread estável: lê a request corrente (serve()). */
export const corsHeaders: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    return headersFor(als.getStore())[prop];
  },
  ownKeys() {
    return Object.keys(headersFor(als.getStore()));
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop !== "string") return undefined;
    const value = headersFor(als.getStore())[prop];
    if (value === undefined) return undefined;
    return { configurable: true, enumerable: true, value };
  },
});

export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  Deno.serve((req) => als.run(req, () => handler(req)));
}
