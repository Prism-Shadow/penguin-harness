/**
 * The package's one fetch fake: an AMSP server reduced to a script. Every request is recorded;
 * each is answered by the route the test registered for its method and path (a JSON answer, an
 * empty status, or an event stream), and anything unrouted gets the server's JSON 404. An event
 * stream is written step by step: each string is sent as one chunk — so a test decides where
 * chunks split — and a promise in the script holds the stream until it settles. An aborted
 * request signal rejects the call before the response, as every `fetch` does; after it, the body
 * either errors with the signal's reason (undici's and the browsers' behaviour) or, by default,
 * is left to its reader, as a minimal `fetch` leaves it. Nothing here reaches the network.
 */

/** One request, as the fake received it. */
export interface FetchCall {
  method: string;
  /** The path after the base URL, still percent-encoded. */
  path: string;
  headers: Headers;
  /** The JSON body, parsed; undefined when there is none. */
  body: unknown;
  signal: AbortSignal | undefined;
}

/**
 * One step of a scripted stream: a chunk to send; a promise to wait for first, or a function
 * called when the stream reaches it, whose promise is waited for; or a broken connection (the
 * body errors with `fail`, as a dropped socket surfaces in `fetch`).
 */
export type Step = string | Promise<unknown> | (() => Promise<unknown>) | { fail: unknown };

/** What the server side of one streamed answer saw. */
export interface ServedStream {
  /** Whether the client closed the connection — cancelled the body or aborted the request — before the script ended. */
  closed: boolean;
}

type Answer = (call: FetchCall) => Response | Promise<Response>;

export const BASE_URL = "http://penguin.test/api/amsp/v1";

const encoder = new TextEncoder();

/** One AMSP event as the server frames it. */
export function frame(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const DONE = "data: [DONE]\n\n";

/** A promise the test settles by hand, to hold a stream at a point of its script. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** A promise that never settles: the server holds the stream open and silent. */
export function never(): Promise<never> {
  return new Promise<never>(() => {});
}

function scriptedBody(steps: Step[]): {
  body: ReadableStream<Uint8Array>;
  served: ServedStream;
  abort: (reason: unknown) => void;
} {
  const served: ServedStream = { closed: false };
  let index = 0;
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller;
    },
    async pull(controller) {
      for (;;) {
        if (served.closed) return;
        const step = steps[index++];
        if (step === undefined) return controller.close();
        if (typeof step === "string") return controller.enqueue(encoder.encode(step));
        if (typeof step === "function") await step();
        else if (step instanceof Promise) await step;
        else return controller.error(step.fail);
      }
    },
    cancel() {
      served.closed = true;
    },
  });
  const abort = (reason: unknown) => {
    served.closed = true;
    source.error(reason);
  };
  return { body, served, abort };
}

export function createFetchFake() {
  const calls: FetchCall[] = [];
  const routes = new Map<string, Answer>();
  const waiting = new Map<string, Array<(call: FetchCall) => void>>();
  const key = (method: string, path: string) => `${method} ${path}`;

  const fetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (init.signal?.aborted) throw init.signal.reason;
    const url = String(input);
    if (!url.startsWith(BASE_URL)) throw new TypeError(`fetch failed: ${url} is off the script`);
    const call: FetchCall = {
      method: init.method ?? "GET",
      path: url.slice(BASE_URL.length),
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init.signal ?? undefined,
    };
    calls.push(call);
    for (const notify of waiting.get(key(call.method, call.path)) ?? []) notify(call);
    waiting.delete(key(call.method, call.path));
    const answer = routes.get(key(call.method, call.path));
    if (answer) return answer(call);
    const notFound = { error: { code: "not_found", message: `No route for ${call.path}.` } };
    return respond(404, JSON.stringify(notFound), "application/json");
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    /** Every request, in arrival order. */
    calls,
    /** Answers `method path` with a JSON body, once `hold` (if given) settles. */
    json(method: string, path: string, status: number, body: unknown, hold?: Promise<unknown>) {
      routes.set(key(method, path), async () => {
        await hold;
        return respond(status, JSON.stringify(body), "application/json");
      });
    },
    /** Answers `method path` with a body of any type, such as a proxy's HTML error page. */
    text(method: string, path: string, status: number, body: string, contentType: string) {
      routes.set(key(method, path), () => respond(status, body, contentType));
    },
    /** Answers `method path` with a status and no body. */
    empty(method: string, path: string, status: number) {
      routes.set(key(method, path), () => new Response(null, { status }));
    },
    /**
     * Answers `method path` with an event stream written from `steps`; with `abortErrorsBody`,
     * aborting the request errors the body as undici and the browsers do.
     */
    stream(
      method: string,
      path: string,
      steps: Step[],
      { abortErrorsBody = false }: { abortErrorsBody?: boolean } = {},
    ): ServedStream {
      const { body, served, abort } = scriptedBody(steps);
      routes.set(key(method, path), (call) => {
        const signal = call.signal;
        if (abortErrorsBody && signal) {
          signal.addEventListener("abort", () => abort(signal.reason), { once: true });
        }
        return respond(200, body, "text/event-stream");
      });
      return served;
    },
    /** Resolves when `method path` has been requested (at once if it already was). */
    requested(method: string, path: string): Promise<FetchCall> {
      const seen = calls.find((call) => call.method === method && call.path === path);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => {
        const list = waiting.get(key(method, path)) ?? [];
        list.push(resolve);
        waiting.set(key(method, path), list);
      });
    },
  };
}

export type FetchFake = ReturnType<typeof createFetchFake>;

function respond(
  status: number,
  body: string | ReadableStream<Uint8Array>,
  contentType: string,
): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}
