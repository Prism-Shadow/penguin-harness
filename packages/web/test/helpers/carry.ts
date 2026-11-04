/**
 * One call, carried by the suite's own `fetch` and answered in the API socket's shape.
 *
 * The node suite has no WebSocket, and the app's calls all go over its socket now, so a suite
 * that wants the real apiFetch/apiRequest (and everything above them) needs something to carry
 * the call. This is that carrier: it makes the same request the HTTP transport used to make —
 * same credentials, same JSON body — against the `fetch` the test stubbed
 * (test/helpers/fetch.ts), and answers `{status, headers, body}` as a frame on the socket would.
 *
 * The frame is the one `answerOnce` in packages/server/src/socket/serve.ts frames, case for
 * case: an empty body keeps its status with a `null` body; a `content-type` that contains `json`
 * carries the parsed value, and the raw text when that parse fails; `text/*` carries the string;
 * only a non-empty body of another type (a download) is refused — 415 `unsupported_transport`,
 * the client then fetches the same URL over HTTP, and that HTTP answer follows the HTTP rules
 * (a page instead of the server, an empty answer).
 */
export interface CarriedAnswer {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** What the server answers a body the socket cannot carry (`reject` in serve.ts). */
const UNSUPPORTED_TRANSPORT = {
  error: {
    code: "unsupported_transport",
    message: "This response does not ride the socket; use HTTP.",
  },
} as const;

export async function carryOverTestFetch(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<CarriedAnswer> {
  const response = await globalThis.fetch(url, {
    method,
    credentials: "same-origin",
    ...(opts.body !== undefined
      ? {
          headers: { "Content-Type": "application/json", ...opts.headers },
          body: JSON.stringify(opts.body),
        }
      : opts.headers !== undefined
        ? { headers: opts.headers }
        : {}),
  });
  const headers = Object.fromEntries(response.headers.entries());
  const text = await response.text().catch(() => "");
  if (text === "") return { status: response.status, headers, body: null };
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    try {
      return { status: response.status, headers, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status, headers, body: text };
    }
  }
  if (type.startsWith("text/")) return { status: response.status, headers, body: text };
  return {
    status: 415,
    headers: { date: new Date().toUTCString() },
    body: UNSUPPORTED_TRANSPORT,
  };
}
