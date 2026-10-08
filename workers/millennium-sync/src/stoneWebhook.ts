import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

export type StonePixNotice = {
  document: string;
  referenceDate: string;
  url: string;
};

export type StoneHook =
  | { kind: "validation" }
  | { kind: "pix"; notice: StonePixNotice }
  | { kind: "ignore" };

function digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function classifyStoneHook(body: unknown): StoneHook {
  if (!body || typeof body !== "object") return { kind: "ignore" };
  const o = body as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  if (type === "validation_notification") return { kind: "validation" };
  if (type !== "pix") return { kind: "ignore" };
  const document = digits(typeof o.document === "string" ? o.document : "");
  const referenceDate = typeof o.referenceDate === "string" ? o.referenceDate.trim() : "";
  const urlRaw = typeof o.url === "string" ? o.url : typeof o.downloadUrl === "string" ? o.downloadUrl : "";
  const url = urlRaw.trim();
  if (document.length < 11 || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) || !url.startsWith("https://")) {
    return { kind: "ignore" };
  }
  return { kind: "pix", notice: { document, referenceDate, url } };
}

function tokenMatches(pathToken: string, expected: string): boolean {
  const a = Buffer.from(pathToken);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64_000) {
        reject(new Error("body"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("json"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(status === 200 ? "{}" : "");
}

/** Escuta o aviso da Stone. Responde na hora; o download do CSV fica no `onPix`. */
export function startStoneWebhook(opts: {
  port: number;
  token: string;
  onPix: (notice: StonePixNotice) => Promise<void>;
}): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      send(res, 200);
      return;
    }
    const prefix = "/hooks/stone/pix/";
    if (req.method !== "POST" || !url.pathname.startsWith(prefix)) {
      send(res, 404);
      return;
    }
    const pathToken = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/\/+$/, "");
    if (!opts.token || !tokenMatches(pathToken, opts.token)) {
      console.warn(`AVISO PIX Stone: a Stone chamou com este token: ${pathToken || "(vazio)"}`);
      send(res, 404);
      return;
    }
    void readJson(req)
      .then((body) => {
        const hook = classifyStoneHook(body);
        send(res, 200);
        if (hook.kind === "validation") console.log("PIX Stone: confirmação recebida");
        if (hook.kind !== "pix") return;
        void opts.onPix(hook.notice).catch((e) => {
          console.warn(`AVISO PIX Stone: ${e instanceof Error ? e.message : String(e)}`);
        });
      })
      .catch(() => send(res, 400));
  });
  server.listen(opts.port, "0.0.0.0");
  return server;
}
