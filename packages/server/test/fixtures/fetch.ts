/**
 * The suite's one fetch fake. Every outbound HTTP request a test causes is recorded, and each
 * is answered by the test's script: a Response, or a throw that plays a transport failure.
 * Hand `fake.fetch` to a service that takes a fetch, or stand it in for the global one with
 * {@link stubFetch} and restore the real one with `vi.unstubAllGlobals()` in `afterEach`.
 * Nothing here reaches the network.
 */
import { vi } from "vitest";

/** One request, as the fake received it. */
export interface FetchCall {
  /** The URL exactly as the caller passed it. */
  url: string;
  method: string;
  headers: Headers;
  /** The body read as text; "" when there is none. */
  body: string;
  /** The body's bytes; empty when there is none. */
  bytes: Uint8Array;
  /** The caller's `init`, as passed (its `redirect`, its `signal`). */
  init: RequestInit | undefined;
}

/** Answers the `index`-th call (0-based): a Response, or a throw. */
export type FetchScript = (call: FetchCall, index: number) => Response | Promise<Response>;

export interface FetchFake {
  /** The fetch to hand to a service, or to install with {@link stubFetch}. */
  readonly fetch: typeof fetch;
  /** Every call, in arrival order. */
  readonly calls: FetchCall[];
}

export function fakeFetch(script: FetchScript): FetchFake {
  const calls: FetchCall[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const call: FetchCall = {
      url: input instanceof Request ? input.url : String(input),
      method: request.method,
      headers: request.headers,
      body: new TextDecoder().decode(bytes),
      bytes,
      init,
    };
    calls.push(call);
    return script(call, calls.length - 1);
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Installs a {@link fakeFetch} as the global fetch; the caller restores it after the test. */
export function stubFetch(script: FetchScript): FetchFake {
  const fake = fakeFetch(script);
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A transport failure the way undici reports one: `TypeError: fetch failed` over the errno. */
export function fetchFailed(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}
