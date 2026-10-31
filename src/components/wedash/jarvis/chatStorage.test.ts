import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_HISTORY_LEGACY_SESSION_KEY,
  clearChatHistory,
  loadChatHistory,
  loadPanelOpen,
  persistChatHistory,
  persistPanelOpen,
} from "./chatStorage";

function stubWebStorage() {
  const map = new Map<string, string>();
  const api = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
  };
  vi.stubGlobal("localStorage", api);
  vi.stubGlobal("sessionStorage", api);
}

describe("chatStorage", () => {
  beforeEach(() => {
    stubWebStorage();
    clearChatHistory("t1", "m1");
    clearChatHistory("t1", "m2");
  });

  it("persiste e reidrata apos F5 (localStorage)", () => {
    persistChatHistory("t1", "m1", [
      { from: "user", text: "meta de novembro" },
      { from: "jarvis", text: "Vamos montar." },
    ]);
    const loaded = loadChatHistory("t1", "m1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.text).toBe("meta de novembro");
    expect(loaded[1]?.text).toBe("Vamos montar.");
  });

  it("persistir [] nao apaga o historico no disco", () => {
    persistChatHistory("t1", "m1", [{ from: "user", text: "oi" }]);
    persistChatHistory("t1", "m1", []);
    expect(loadChatHistory("t1", "m1")).toEqual([{ from: "user", text: "oi", link: null, retryOf: null }]);
  });

  it("clearChatHistory apaga de proposito", () => {
    persistChatHistory("t1", "m1", [{ from: "user", text: "oi" }]);
    clearChatHistory("t1", "m1");
    expect(loadChatHistory("t1", "m1")).toEqual([]);
  });

  it("migra chave legada sem escopo", () => {
    localStorage.setItem(
      CHAT_HISTORY_LEGACY_SESSION_KEY,
      JSON.stringify([
        { from: "user", text: "legado" },
        { from: "jarvis", text: "ok" },
      ]),
    );
    const loaded = loadChatHistory("t1", "m1");
    expect(loaded.map((m) => m.text)).toEqual(["legado", "ok"]);
    expect(localStorage.getItem(CHAT_HISTORY_LEGACY_SESSION_KEY)).toBeNull();
    expect(loadChatHistory("t1", "m1").map((m) => m.text)).toEqual(["legado", "ok"]);
  });

  it("isola historico por membership", () => {
    persistChatHistory("t1", "m1", [{ from: "user", text: "conta A" }]);
    persistChatHistory("t1", "m2", [{ from: "user", text: "conta B" }]);
    expect(loadChatHistory("t1", "m1")[0]?.text).toBe("conta A");
    expect(loadChatHistory("t1", "m2")[0]?.text).toBe("conta B");
  });

  it("persiste painel aberto", () => {
    expect(loadPanelOpen("t1", "m1")).toBe(false);
    persistPanelOpen("t1", "m1", true);
    expect(loadPanelOpen("t1", "m1")).toBe(true);
    persistPanelOpen("t1", "m1", false);
    expect(loadPanelOpen("t1", "m1")).toBe(false);
  });
});
