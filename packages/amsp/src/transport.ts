/**
 * How the client reaches a server: one interface for the requests and the streams, and the
 * implementation over `fetch`.
 *
 * Paths are AMSP's own, relative to the Agent API's base: `/agents/<projectId>/<agentId>/runs`,
 * `/sessions/<id>/stream`, `/sessions/<id>/messages`, … A host with a channel of its own (the Web
 * App's socket, a test) implements {@link Transport} and maps them where it needs to.
 */
import { AmspStreamError, httpError } from "./errors.js";
import { readAmsp } from "./sse.js";
import type { AmspFrame } from "./sse.js";
import type { AmspControl, AmspRecord } from "./types.js";

/** What a stream delivers, as it arrives. */
export interface StreamHandlers {
  /** A record, with its event id (null on a record that came without one). */
  onRecord(id: string | null, record: AmspRecord): void;
  /** A control frame: `ping`. */
  onControl(control: AmspControl): void;
  /** A named event AMSP does not define; most readers leave it out. */
  onOther?(name: string, data: string): void;
}

export interface StreamRequest extends StreamHandlers {
  /** `GET` (a Session stream) unless a body is sent; a run is a `POST`. */
  method?: "GET" | "POST";
  body?: unknown;
  /** Resume after this event id: sent as `Last-Event-ID`. */
  lastEventId?: string;
  /** Aborting it closes the connection; the stream then rejects with the signal's reason. */
  signal?: AbortSignal;
}

/**
 * How a stream ended: `done` at `data: [DONE]` (a run stream's end), `closed` when the body ended
 * without it (the connection, or a Session stream the server closed).
 */
export type StreamEnd = "done" | "closed";

/** An answer that is not a stream: its status and its JSON body (null for an empty one). */
export interface TransportResponse<T> {
  status: number;
  body: T | null;
}

export interface Transport {
  /**
   * Opens a stream and delivers it until it ends. Rejects with an {@link AmspHttpError} when the
   * server refused it before streaming, with an `AmspStreamError` when it carried a record that
   * is not one, and with the signal's reason once the signal aborts.
   */
  stream(path: string, req: StreamRequest): Promise<StreamEnd>;
  /** One `GET`; an answer other than 2xx rejects with an {@link AmspHttpError}. */
  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<TransportResponse<T>>;
  /** One `POST` with an optional JSON body; an answer other than 2xx rejects likewise. */
  post<T>(
    path: string,
    body?: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<TransportResponse<T>>;
}

export interface HttpTransportOptions {
  /**
   * Where the AMSP paths are mounted: the Agent API's base, e.g. `http://localhost:7364/api/amsp/v1`.
   * A page on the server's own origin that reads the cookie door gives `/api` and its paths
   * (`/sessions/<id>/amsp`) accordingly.
   */
  baseUrl: string;
  /** The Agent's API key, sent as a Bearer token. Omit it for keyless access, or for the cookie door. */
  apiKey?: string;
  /** Passed to `fetch`: `include` or `same-origin` for the cookie door. */
  credentials?: RequestCredentials;
  /** The `fetch` to send requests with; the global one by default. */
  fetch?: typeof fetch;
  /** Extra headers for every request. A browser sends a cross-origin request only with the headers the server allows (`Authorization`, `Content-Type`). */
  headers?: Record<string, string>;
}

/** {@link Transport} over `fetch`, for the key door and for a page reading the cookie door. */
export class HttpTransport implements Transport {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #credentials: RequestCredentials | undefined;
  readonly #fetch: typeof fetch | undefined;

  constructor(opts: HttpTransportOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#headers = {
      ...opts.headers,
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    };
    this.#credentials = opts.credentials;
    this.#fetch = opts.fetch;
  }

  async #send(
    method: "GET" | "POST",
    path: string,
    init: { body?: unknown; accept?: string; lastEventId?: string; signal?: AbortSignal },
  ): Promise<Response> {
    const headers: Record<string, string> = { ...this.#headers };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.accept !== undefined) headers.Accept = init.accept;
    if (init.lastEventId !== undefined) headers["Last-Event-ID"] = init.lastEventId;
    // Called bare: a browser's fetch throws "Illegal invocation" when called as another object's method.
    const fetchImpl = this.#fetch ?? globalThis.fetch;
    const response = await fetchImpl(this.#baseUrl + path, {
      method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(this.#credentials !== undefined ? { credentials: this.#credentials } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (!response.ok) throw await httpError(response);
    return response;
  }

  async #json<T>(response: Response): Promise<TransportResponse<T>> {
    const text = await response.text();
    return { status: response.status, body: text === "" ? null : (JSON.parse(text) as T) };
  }

  async stream(path: string, req: StreamRequest): Promise<StreamEnd> {
    const method = req.method ?? (req.body !== undefined ? "POST" : "GET");
    const response = await this.#send(method, path, {
      ...(req.body !== undefined ? { body: req.body } : {}),
      accept: "text/event-stream",
      ...(req.lastEventId !== undefined ? { lastEventId: req.lastEventId } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.body === null || !/^text\/event-stream\b/i.test(contentType)) {
      // Not a stream: the request was answered by something else (a proxy page, another server).
      throw new AmspStreamError(
        `Expected an event stream, got ${contentType || "a response without a content type"}.`,
      );
    }
    return await deliver(readAmsp(response.body, req.signal), req);
  }

  async get<T>(path: string, opts: { signal?: AbortSignal } = {}): Promise<TransportResponse<T>> {
    return await this.#json<T>(await this.#send("GET", path, opts));
  }

  async post<T>(
    path: string,
    body?: unknown,
    opts: { signal?: AbortSignal } = {},
  ): Promise<TransportResponse<T>> {
    return await this.#json<T>(
      await this.#send("POST", path, { ...(body !== undefined ? { body } : {}), ...opts }),
    );
  }
}

/**
 * Hands the frames of a stream to its handlers until `[DONE]` or the body's end. A transport
 * that reads an SSE body itself (with its own `fetch`, its own URLs) ends its `stream` with this.
 */
export async function deliver(
  frames: AsyncIterable<AmspFrame>,
  handlers: StreamHandlers,
): Promise<StreamEnd> {
  for await (const frame of frames) {
    switch (frame.kind) {
      case "done":
        return "done";
      case "record":
        handlers.onRecord(frame.id, frame.record);
        break;
      case "control":
        handlers.onControl(frame.control);
        break;
      case "other":
        handlers.onOther?.(frame.name, frame.data);
        break;
    }
  }
  return "closed";
}
