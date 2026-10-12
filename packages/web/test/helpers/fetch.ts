/**
 * Outbound HTTP for the node suite: the package's one `fetch` fake.
 *
 * It stands where the browser's `fetch` does, so a test drives the real `api/endpoints`
 * wrappers and the real `apiFetch` (URL building, routing to a machine, error mapping) and
 * asserts on what went over the wire. Every request is recorded; each is answered by the test's
 * handler, which returns a Response ({@link json}, {@link apiError}), throws (the network
 * failed), or never settles. The package config sets `unstubGlobals`, so the fake is gone
 * before the next test.
 */
import { vi } from "vitest";

/** One request as the app sent it. */
export interface FetchRequest {
  readonly method: string;
  /** The URL as the app built it, query included. */
  readonly url: string;
  /** The machine a `/server/<id>/api/…` URL is routed through; null for this server. */
  readonly machine: string | null;
  /** The API path without the machine prefix and the query, still percent-encoded. */
  readonly path: string;
  readonly query: URLSearchParams;
  /** The body: parsed when it is JSON, as sent otherwise, undefined when there is none. */
  readonly body: unknown;
  /** The request's abort signal, for an answer that must end the way a real one does when it fires. */
  readonly signal: AbortSignal | null;
}

export type FetchHandler = (request: FetchRequest) => Response | Promise<Response>;

export interface FakeFetch {
  /** Every request so far, oldest first. */
  readonly requests: FetchRequest[];
  /** Answers every later request with `handler`. */
  answer(handler: FetchHandler): void;
}

/** Installs the fake as the global `fetch` for the current test. By default everything is a 404. */
export function stubFetch(handler: FetchHandler = () => apiError(404, "not_found")): FakeFetch {
  const requests: FetchRequest[] = [];
  let current = handler;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const parsed = new URL(url, "http://localhost");
    const routed = /^\/server\/([^/]+)(\/.*)$/.exec(parsed.pathname);
    const request: FetchRequest = {
      method: init.method ?? "GET",
      url,
      machine: routed ? decodeURIComponent(routed[1]!) : null,
      path: routed ? routed[2]! : parsed.pathname,
      query: parsed.searchParams,
      body: parseBody(init.body),
      signal: init.signal ?? null,
    };
    requests.push(request);
    return current(request);
  });
  return {
    requests,
    answer(next) {
      current = next;
    },
  };
}

function parseBody(body: RequestInit["body"]): unknown {
  if (typeof body !== "string") return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** A JSON answer, 200 unless `status` says otherwise. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A failure in the server's error envelope, `{ error: { code, message } }`. */
export function apiError(
  status: number,
  code: string,
  message = code,
  headers: Record<string, string> = {},
): Response {
  return json({ error: { code, message } }, status, headers);
}
