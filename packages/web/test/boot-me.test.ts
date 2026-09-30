/**
 * A page load asks `GET /api/me` once (api/client.ts, api/socket.ts `identityPending`,
 * state/auth.tsx `prefetchMe`).
 *
 * Before this, the boot asked it twice: the auth provider's mount fetched it, and the page's
 * first other call reached the socket before that answer did, so the socket asked the same
 * question over HTTP itself — each answer 28 KB while the avatar travelled inside it. The
 * client and the real socket module run here against a counted `fetch` and a WebSocket whose
 * handshake fails, so every call ends up on HTTP where it can be counted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A WebSocket whose handshake fails at once: calls fall back to HTTP, where they are counted. */
class RefusedSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    setTimeout(() => this.onclose?.(), 0);
  }
  send() {}
  close() {
    this.onclose?.();
  }
}

let fetched: string[] = [];
/** Holds `/api/me` back until the test lets it answer, as a slow first request would. */
let answerMe: () => void = () => undefined;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.resetModules();
  fetched = [];
  vi.stubGlobal("WebSocket", RefusedSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "test" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const me = new Promise<void>((resolve) => {
    answerMe = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      if (url === "/api/me") {
        await me;
        return json({ user: { userId: "admin" } });
      }
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const meRequests = () => fetched.filter((u) => u === "/api/me").length;

describe("GET /api/me at boot", () => {
  it("is asked once while another call waits on the socket for who is signed in", async () => {
    const { apiFetch } = await import("../src/api/client");
    const me = apiFetch("/api/me");
    const other = apiFetch("/api/projects");
    await new Promise((r) => setTimeout(r, 0));
    answerMe();
    await expect(me).resolves.toEqual({ user: { userId: "admin" } });
    await expect(other).resolves.toEqual({ ok: true });
    expect(meRequests()).toBe(1);
  });

  it("is asked again by the socket when the answer in flight could not tell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        if (url === "/api/me" && meRequests() === 1) throw new TypeError("network down");
        return json(url === "/api/me" ? { user: { userId: "admin" } } : { ok: true });
      }),
    );
    const { apiFetch } = await import("../src/api/client");
    await expect(apiFetch("/api/me")).rejects.toMatchObject({ code: "network_error" });
    // The call that read the failure goes over HTTP; the one after it asks for itself.
    await expect(apiFetch("/api/projects")).resolves.toEqual({ ok: true });
    expect(meRequests()).toBe(1);
    await expect(apiFetch("/api/projects")).resolves.toEqual({ ok: true });
    expect(meRequests()).toBe(2);
  });

  it("is started once by the boot, however often the boot asks", async () => {
    const { prefetchMe } = await import("../src/state/auth");
    prefetchMe();
    prefetchMe();
    answerMe();
    await new Promise((r) => setTimeout(r, 0));
    expect(meRequests()).toBe(1);
  });
});
