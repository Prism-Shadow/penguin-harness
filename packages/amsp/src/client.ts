/**
 * The client of one Agent's API: runs it, continues its Sessions, answers its approvals.
 *
 * Only `fetch`, `Headers`, `ReadableStream`, `TextDecoder` and `AbortController` are used, so the
 * same code runs in Node 24 and in a browser.
 */
import { RunCollector, type RunResult } from "./collect.js";
import { AmspHttpError, AmspStreamError, httpError } from "./errors.js";
import { sseData } from "./sse.js";
import type {
  AgentInfo,
  AgentResponse,
  AmspEvent,
  ApprovalRequest,
  ApprovalRequested,
  InputItem,
  RunRequest,
  SessionInfo,
  SessionResponse,
} from "./types.js";

export interface AgentClientOptions {
  /** The server's AMSP base URL, e.g. `http://localhost:7364/api/amsp/v1`. */
  baseUrl: string;
  /** The Agent, as `<projectId>/<agentId>`, e.g. `demo/coder`. */
  agent: string;
  /** The Agent's API key, sent as a Bearer token. Omit it only for an Agent that allows keyless access; no environment variable is read for it. */
  apiKey?: string;
  /** The `fetch` to send requests with; the global one by default. */
  fetch?: typeof fetch;
  /** Extra headers for every request. A browser sends a cross-origin request only with the headers the server allows (`Authorization`, `Content-Type`). */
  headers?: Record<string, string>;
}

export interface RunOptions {
  /** The new user input: text, or text and image items. */
  input: string | InputItem[];
  /** Continues this Session; omitted, the run starts a new one, named by `run.started`. */
  sessionId?: string;
  /** Aborting it closes the connection, which aborts the run on the server, and rejects the run with the signal's reason. */
  signal?: AbortSignal;
  /** Called for every `approval.requested`; the answer is POSTed for you. Absent, or throwing, = `"deny"`. */
  onApproval?: (
    req: ApprovalRequested,
    ctx: { sessionId: string },
  ) => Promise<"allow" | "deny"> | "allow" | "deny";
}

/**
 * One run of the Agent, under way from the moment `run()` returns. Iterate it for the events as
 * they arrive — once; events are kept until they are read, so use `ask()` when only the result
 * matters. `result()` resolves when the stream ends. Approvals are answered as they arrive,
 * whether or not anyone iterates. Leaving the loop early stops the iteration, not the run; call
 * `abort()` or abort the signal for that.
 */
export interface Run extends AsyncIterable<AmspEvent> {
  /** The Session id, from `run.started`, before any other event. */
  readonly session: Promise<string>;
  /** The outcome. Rejects with an {@link AmspHttpError} on a refusal, an {@link AmspStreamError} when the stream broke, or the abort reason. */
  result(): Promise<RunResult>;
  /** Asks the server to abort the run. The stream stays open and ends with `run.done` `aborted`. */
  abort(): Promise<void>;
}

/** How every request is sent: the base URL, the key and extra headers, the chosen `fetch`. */
class Transport {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch | undefined;

  constructor(opts: AgentClientOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#headers = {
      ...opts.headers,
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    };
    this.#fetch = opts.fetch;
  }

  /** Sends one request; an answer other than 2xx is thrown as an {@link AmspHttpError}. */
  async send(
    method: "GET" | "POST",
    path: string,
    init: { body?: unknown; accept?: string; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...this.#headers };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.accept !== undefined) headers.Accept = init.accept;
    // Called bare: a browser's fetch throws "Illegal invocation" when called as another object's method.
    const fetchImpl = this.#fetch ?? globalThis.fetch;
    const response = await fetchImpl(this.#baseUrl + path, {
      method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (!response.ok) throw await httpError(response);
    return response;
  }
}

const sessionPath = (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}`;

const approvalPath = (sessionId: string, toolCallId: string) =>
  `${sessionPath(sessionId)}/approvals/${encodeURIComponent(toolCallId)}`;

/** One block of the stream as an event; anything that is not an object with a `type` breaks the stream. */
function parseEvent(data: string): AmspEvent {
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch (err) {
    throw new AmspStreamError(
      `The stream carried a block that is not JSON: ${data.slice(0, 200)}`,
      {
        cause: err,
      },
    );
  }
  if (
    event === null ||
    typeof event !== "object" ||
    typeof (event as { type?: unknown }).type !== "string"
  ) {
    throw new AmspStreamError(
      `The stream carried a block that is not an event: ${data.slice(0, 200)}`,
    );
  }
  return event as AmspEvent;
}

type Outcome = { ok: true } | { ok: false; error: unknown };

const END: IteratorResult<AmspEvent> = { value: undefined, done: true };

class AgentRun implements Run {
  readonly session: Promise<string>;
  readonly #transport: Transport;
  readonly #result: Promise<RunResult>;
  /** Aborted by the caller's signal, or by an approval that could not be answered. */
  readonly #control = new AbortController();
  /** Events not yet read by the iterator; null when nobody will read them (`ask()`, or after the loop left). */
  #queue: AmspEvent[] | null;
  #iterated = false;
  #waiter: {
    resolve: (result: IteratorResult<AmspEvent>) => void;
    reject: (error: unknown) => void;
  } | null = null;
  #outcome: Outcome | null = null;
  #resolveSession!: (sessionId: string) => void;
  #rejectSession!: (error: unknown) => void;

  constructor(transport: Transport, agentPath: string, opts: RunOptions, iterable: boolean) {
    this.#transport = transport;
    this.#queue = iterable ? [] : null;
    this.session = new Promise<string>((resolve, reject) => {
      this.#resolveSession = resolve;
      this.#rejectSession = reject;
    });
    // Each failure reaches whoever awaits it; one nobody awaits is not an unhandled rejection.
    this.session.catch(() => {});
    this.#result = this.#drive(agentPath, opts);
    this.#result.catch(() => {});
  }

  result(): Promise<RunResult> {
    return this.#result;
  }

  async abort(): Promise<void> {
    let sessionId: string;
    try {
      sessionId = await this.session;
    } catch {
      return; // refused or broken before the run started: nothing runs
    }
    if (this.#outcome !== null) return;
    await this.#transport.send("POST", `${sessionPath(sessionId)}/abort`);
  }

  [Symbol.asyncIterator](): AsyncIterator<AmspEvent> {
    if (this.#iterated) throw new TypeError("A run's events can be iterated once.");
    this.#iterated = true;
    return {
      next: () => this.#next(),
      return: () => {
        this.#queue = null;
        return Promise.resolve(END);
      },
    };
  }

  #next(): Promise<IteratorResult<AmspEvent>> {
    if (this.#queue === null) return Promise.resolve(END);
    // Aborted: reads fail at once and what was buffered is dropped, as an aborted fetch body does.
    // A run that completed is not undone by an abort that came after it.
    if (this.#control.signal.aborted && this.#outcome?.ok !== true) {
      this.#queue = null;
      return Promise.reject(this.#control.signal.reason);
    }
    const event = this.#queue.shift();
    if (event !== undefined) return Promise.resolve({ value: event, done: false });
    const outcome = this.#outcome;
    if (outcome !== null) {
      this.#queue = null;
      return outcome.ok ? Promise.resolve(END) : Promise.reject(outcome.error);
    }
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  #push(event: AmspEvent): void {
    if (this.#waiter !== null) {
      this.#waiter.resolve({ value: event, done: false });
      this.#waiter = null;
    } else {
      this.#queue?.push(event);
    }
  }

  #end(outcome: Outcome): void {
    this.#outcome = outcome;
    if (!outcome.ok) this.#rejectSession(outcome.error);
    const waiter = this.#waiter;
    if (waiter === null) return;
    this.#waiter = null;
    this.#queue = null;
    if (outcome.ok) waiter.resolve(END);
    else waiter.reject(outcome.error);
  }

  async #drive(agentPath: string, opts: RunOptions): Promise<RunResult> {
    const { signal } = opts;
    const control = this.#control;
    const forward = () => control.abort(signal!.reason);
    if (signal?.aborted) forward();
    else signal?.addEventListener("abort", forward, { once: true });
    const collector = new RunCollector();
    try {
      const request: RunRequest = {
        ...(opts.sessionId !== undefined ? { session_id: opts.sessionId } : {}),
        input: opts.input,
      };
      const response = await this.#transport.send("POST", `${agentPath}/runs`, {
        body: request,
        accept: "text/event-stream",
        signal: control.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (response.body === null || !/^text\/event-stream\b/i.test(contentType)) {
        throw new AmspStreamError(
          `Expected an event stream, got ${contentType || "a response without a content type"}.`,
        );
      }
      try {
        for await (const data of sseData(response.body, control.signal)) {
          if (data === "[DONE]") break;
          const event = parseEvent(data);
          collector.add(event);
          if (event.type === "run.started") this.#resolveSession(event.session_id);
          else if (event.type === "approval.requested") this.#answer(event, opts.onApproval);
          this.#push(event);
        }
      } catch (err) {
        if (control.signal.aborted) throw control.signal.reason;
        // After run.done the outcome is known, whatever happens to the rest of the body.
        if (!collector.finished) {
          throw err instanceof AmspStreamError
            ? err
            : new AmspStreamError(`The stream broke before run.done: ${String(err)}`, {
                cause: err,
              });
        }
      }
      const result = collector.result();
      this.#end({ ok: true });
      return result;
    } catch (error) {
      this.#end({ ok: false, error });
      throw error;
    } finally {
      signal?.removeEventListener("abort", forward);
    }
  }

  /**
   * Answers one approval request: the callback's decision, else `deny`. The request being gone by
   * then (someone answered first in the Web App, or the run ended) is not a failure. Any other
   * failure to answer would leave the run waiting for good, so it ends a live run: the connection
   * closes, the server aborts the run, and the run rejects with that error.
   */
  #answer(event: ApprovalRequested, onApproval: RunOptions["onApproval"]): void {
    void (async () => {
      const sessionId = await this.session;
      let decision: ApprovalRequest["decision"] = "deny";
      if (onApproval) {
        try {
          decision = (await onApproval(event, { sessionId })) === "allow" ? "allow" : "deny";
        } catch {
          decision = "deny";
        }
      }
      try {
        await this.#transport.send("POST", approvalPath(sessionId, event.tool_call.tool_call_id), {
          body: { decision } satisfies ApprovalRequest,
          signal: this.#control.signal,
        });
      } catch (err) {
        if (err instanceof AmspHttpError && err.code === "approval_not_found") return;
        this.#control.abort(err);
      }
    })().catch(() => {});
  }
}

/**
 * A client of one Agent's API.
 *
 * ```ts
 * const client = new AgentClient({ baseUrl: "http://localhost:7364/api/amsp/v1", agent: "demo/coder", apiKey });
 * const { text, sessionId } = await client.ask({ input: "Summarize README.md" });
 * ```
 */
export class AgentClient {
  readonly #transport: Transport;
  readonly #agentPath: string;

  constructor(opts: AgentClientOptions) {
    const [projectId, agentId, ...rest] = opts.agent.split("/");
    if (!projectId || !agentId || rest.length > 0) {
      throw new TypeError(
        `agent must be "<projectId>/<agentId>", got ${JSON.stringify(opts.agent)}.`,
      );
    }
    this.#transport = new Transport(opts);
    this.#agentPath = `/agents/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}`;
  }

  /** Starts a run and streams it; see {@link Run}. */
  run(opts: RunOptions): Run {
    return new AgentRun(this.#transport, this.#agentPath, opts, true);
  }

  /** Runs to the end and returns the result; nothing is kept for iteration. */
  ask(opts: RunOptions): Promise<RunResult> {
    return new AgentRun(this.#transport, this.#agentPath, opts, false).result();
  }

  /** The Agent's id, name and description. */
  async agent(): Promise<AgentInfo> {
    const response = await this.#transport.send("GET", this.#agentPath);
    return ((await response.json()) as AgentResponse).agent;
  }

  /** One of the Agent's API Sessions: its status and model. */
  async session(sessionId: string): Promise<SessionInfo> {
    const response = await this.#transport.send("GET", sessionPath(sessionId));
    return ((await response.json()) as SessionResponse).session;
  }

  /** Aborts the Session's running run; `false` when nothing was running. */
  async abort(sessionId: string): Promise<boolean> {
    const response = await this.#transport.send("POST", `${sessionPath(sessionId)}/abort`);
    return response.status === 202;
  }

  /** Answers a pending approval; an {@link AmspHttpError} `approval_not_found` when it was already decided. */
  async approve(sessionId: string, toolCallId: string, decision: "allow" | "deny"): Promise<void> {
    await this.#transport.send("POST", approvalPath(sessionId, toolCallId), {
      body: { decision } satisfies ApprovalRequest,
    });
  }
}
