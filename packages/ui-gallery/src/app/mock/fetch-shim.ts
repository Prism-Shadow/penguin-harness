/**
 * A few of the app's features bypass its client and call `fetch` themselves — the Workspace
 * file preview (which reads the `ETag` off the response), the benchmark case browser, the
 * archive downloads, the terminal list. The frame answers those from the same router by
 * wrapping `fetch` for `/api/…` URLs; everything else (the frame's own assets) goes to the
 * network as before.
 */
import { ApiError } from "./errors";
import { isApiUrl, splitUrl } from "./router";
import type { Method } from "./router";
import { router } from "./routes";
import { getStore } from "./store";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function bodyOf(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/** The response an answer becomes, in the shape the direct callers read. */
export async function answerAsResponse(
  method: Method,
  url: string,
  body: unknown,
): Promise<Response> {
  try {
    const answer = await router.dispatch(getStore(), method, url, body);
    if (answer.kind === "empty") return new Response(null, { status: answer.status });
    if (answer.kind === "raw") {
      return new Response(answer.body, { status: answer.status, headers: answer.headers });
    }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
}

export function installFetchShim(): void {
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (!isApiUrl(url)) return real(input, init);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase() as Method;
    return answerAsResponse(method, splitUrl(url).path + urlQuery(url), bodyOf(init));
  };
}

function urlQuery(url: string): string {
  const { query } = splitUrl(url);
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}
