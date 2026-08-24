/**
 * The one rule that decides which server a call reaches. Every /api request and every SSE
 * subscription in the app goes through apiUrl(), so what it does with a stored value is the
 * whole routing contract — including what it does with a value that should not be there.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVE_SERVER_KEY,
  activeServerId,
  apiUrl,
  setActiveServer,
} from "../src/lib/server-context";

const ID = "noeSE0FFHhNXl2J5";
const LEGACY = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";

/** vitest runs in Node: give the module the storage it expects. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

afterEach(() => store.clear());

describe("apiUrl", () => {
  it("leaves every path alone when no server is active", () => {
    expect(apiUrl("/api/me", null)).toBe("/api/me");
    expect(apiUrl("/api/sessions/abc/stream", null)).toBe("/api/sessions/abc/stream");
  });

  it("re-roots an /api path onto the active machine's proxy prefix", () => {
    expect(apiUrl("/api/me", ID)).toBe(`/server/${ID}/api/me`);
    expect(apiUrl("/api/sessions/abc/stream", ID)).toBe(`/server/${ID}/api/sessions/abc/stream`);
  });

  it("needs no encoding — a machine id is path-safe by construction", () => {
    expect(apiUrl("/api/me", ID)).not.toContain("%");
  });

  it("touches ONLY /api paths: the frontend and previews stay local", () => {
    // The window never leaves this origin, and a remote's pages are never proxied.
    expect(apiUrl("/", ID)).toBe("/");
    expect(apiUrl("/assets/app.js", ID)).toBe("/assets/app.js");
    expect(apiUrl("/preview/tok/index.html", ID)).toBe("/preview/tok/index.html");
  });
});

describe("activeServerId", () => {
  it("is null until something is stored", () => {
    expect(activeServerId()).toBeNull();
  });

  it("round-trips through setActiveServer, and clears back to local", () => {
    setActiveServer(ID);
    expect(activeServerId()).toBe(ID);
    setActiveServer(null);
    expect(activeServerId()).toBeNull();
  });

  it("accepts an id minted under the older, longer shape", () => {
    setActiveServer(LEGACY);
    expect(activeServerId()).toBe(LEGACY);
  });

  it("reads a corrupted value as LOCAL rather than pasting it into every request", () => {
    // A hand-edited or half-written value would otherwise re-root the entire app onto a
    // prefix nothing forwards, and every call would 503 with nothing to point at. Falling
    // back to local is the one state the user can always get out of.
    for (const junk of [
      "",
      "   ",
      "ssh:far",
      "../../etc/passwd",
      "%2e%2e",
      "a".repeat(64),
      "<script>",
    ]) {
      store.set(ACTIVE_SERVER_KEY, junk);
      expect(activeServerId()).toBeNull();
      expect(apiUrl("/api/me")).toBe("/api/me");
    }
  });

  it("survives storage that throws, which is a real browser state", () => {
    const saved = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(activeServerId()).toBeNull();
    expect(() => setActiveServer(ID)).not.toThrow();
    (globalThis as { localStorage?: unknown }).localStorage = saved;
  });
});
