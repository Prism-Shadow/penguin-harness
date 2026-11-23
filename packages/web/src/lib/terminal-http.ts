import { terminalUrl } from "./terminal-machines";

/**
 * Every terminal round-trip goes through here, and so is addressed to the machine that holds
 * the terminal it names (lib/terminal-machines.ts). `server` is for the one call with no id
 * to route by: creating a terminal names its machine before the terminal exists.
 */
async function request(
  path: string,
  init?: RequestInit,
  server?: string | null,
): Promise<Response> {
  return fetch(terminalUrl(path, server), {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/**
 * A failure the user can act on: the method, the path and the server's own words. A bare
 * "Server did not return a terminal" was the opposite — it hid a 404 (a server without the
 * terminal API, e.g. an older build the desktop shell attached to) behind wording that
 * suggested the terminal itself failed to start.
 */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function httpError(
  path: string,
  init: RequestInit | undefined,
  res: Response,
  body: string,
): HttpStatusError {
  const method = init?.method ?? "GET";
  const detail = body.trim() === "" ? res.statusText : body.trim();
  return new HttpStatusError(res.status, `${method} ${path} → ${res.status} ${detail}`);
}

/** Any non-ok status is an error, 404 included — use probeJson where absence is expected. */
export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  server?: string | null,
): Promise<T> {
  const res = await request(path, init, server);
  if (!res.ok) throw httpError(path, init, res, await res.text());
  return (await res.json()) as T;
}

/** Existence probe: 404 means "not there" and answers null; every other failure throws. */
export async function probeJson<T>(
  path: string,
  init?: RequestInit,
  server?: string | null,
): Promise<T | null> {
  const res = await request(path, init, server);
  if (res.status === 404) return null;
  if (!res.ok) throw httpError(path, init, res, await res.text());
  return (await res.json()) as T;
}
