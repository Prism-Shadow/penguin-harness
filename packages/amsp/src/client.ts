/**
 * The client of one Agent's API: runs it, continues its Sessions, answers its approvals.
 *
 * Only `fetch`, `Headers`, `ReadableStream`, `TextDecoder` and `AbortController` are used (by
 * the default transport), so the same code runs in Node 24 and in a browser.
 */
import { RunCollector } from "./collect.js";
import type { RunResult } from "./collect.js";
import { AmspHttpError, AmspStreamError } from "./errors.js";
import { HttpTransport } from "./transport.js";
import type { HttpTransportOptions, Transport } from "./transport.js";
import type {
  AgentInfo,
  AgentResponse,
  AmspRecord,
  ApprovalRequest,
  ApprovalsResponse,
  InputItem,
  MessageOrigin,
  MessagesPage,
  MessagesResponse,
  PendingApproval,
  RunRequest,
  SessionInfo,
  SessionResponse,
  ToolCallPayload,
} from "./types.js";

export interface AgentClientOptions extends Partial<HttpTransportOptions> {
  /** The Agent, as `<projectId>/<agentId>`, e.g. `demo/coder`. */
  agent: string;
  /**
   * How requests reach the server. Omitted, an {@link HttpTransport} over `baseUrl` (the server's
   * AMSP base URL, e.g. `http://localhost:7364/api/amsp/v1`) with `apiKey` and the other options.
   */
  transport?: Transport;
}

/** The answer to one approval. */
export type ApprovalAnswer = "allow" | "deny";

/**
 * Decides one tool call the server holds for an answer: the call (a `tool_call` record's payload)
 * and, for a subagent's call, the child Session chain it came through.
 */
export type OnApproval = (
  toolCall: ToolCallPayload,
  origin: MessageOrigin[] | undefined,
  ctx: { sessionId: string },
) => Promise<ApprovalAnswer> | ApprovalAnswer;

export interface RunOptions {
  /** The new user input: text, or text and image items. */
  input: string | InputItem[];
  /** Continues this Session; omitted, the run starts a new one, named by its `session_meta`. */
  sessionId?: string;
  /** Aborting it closes the connection, which aborts the run on the server, and rejects the run with the signal's reason. */
  signal?: AbortSignal;
  /**
   * Decides the calls the Session's approval mode asks about; the client finds them through the
   * Session's approvals resource and posts each answer for you. Absent, or throwing, = `"deny"`.
   */
  onApproval?: OnApproval;
}

/**
 * One run of the Agent, under way from the moment `stream()` returns. Iterate it for the records as
 * they arrive — once; records are kept until they are read, so use `run()` when only the result
 * matters. `result()` resolves when the stream reaches `[DONE]`. Approvals are answered as they
 * come, whether or not anyone iterates. Leaving the loop early stops the iteration, not the run;
 * call `abort()` or abort the signal for that.
 */
export interface Run extends AsyncIterable<AmspRecord> {
  /**
   * The Session id, once the run is under way: for a continued Session the `sessionId` passed, at
   * the stream's first frame; for a new one, at its `session_meta`, the stream's first record.
   * Rejects when the run is refused, or its stream breaks, before then.
   */
  readonly session: Promise<string>;
  /** The outcome. Rejects with an {@link AmspHttpError} on a refusal, an {@link AmspStreamError} when the stream broke, or the abort reason. */
  result(): Promise<RunResult>;
  /** Asks the server to abort the run. The stream stays open and still ends with `[DONE]`; the result says `aborted`. */
  abort(): Promise<void>;
}

const sessionPath = (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}`;

const approvalPath = (sessionId: string, toolCallId: string) =>
  `${sessionPath(sessionId)}/approvals/${encodeURIComponent(toolCallId)}`;

/** How long one look at the approvals resource waits for a call to appear, in seconds. */
const APPROVAL_WAIT_S = 30;

/** One tool call, as approvals are told apart: its Session chain and its id. */
const originKey = (origin: MessageOrigin[] | undefined): string => origin?.join("/") ?? "";
const approvalKey = (origin: MessageOrigin[] | undefined, toolCallId: string): string =>
  `${originKey(origin)} ${toolCallId}`;

type Outcome = { ok: true } | { ok: false; error: unknown };

const END: IteratorResult<AmspRecord> = { value: undefined, done: true };

/**
 * The approval loop of one run. While the run is open and some completed `tool_call` on the stream
 * has no `approval_decision` yet, it keeps one look open on `GET …/sessions/:id/approvals?wait=30`
 * and hands every call that look returns to `onApproval` once, posting the answer. It stops when
 * every call it saw has its decision or ended with a Request that did not complete, or the run
 * ends. The engine records a decision for every call it runs, the automatic ones included,
 * before the call's Request ends, so the loop always comes to rest.
 *
 * No look is opened while an answer is being decided or posted: the server still lists that call
 * until the answer lands, and the look would come back with it at once, over and over.
 */
class ApprovalLoop {
  readonly #transport: Transport;
  readonly #onApproval: OnApproval | undefined;
  readonly #fail: (error: unknown) => void;
  readonly #runSignal: AbortSignal;
  #sessionId: string | null = null;
  /** Completed calls seen on the stream with no decision yet: approvalKey → originKey. */
  readonly #undecided = new Map<string, string>();
  /** Calls this loop has answered, or is answering. */
  readonly #answered = new Set<string>();
  #inFlight = 0;
  #look: AbortController | null = null;
  #open = true;

  constructor(
    transport: Transport,
    onApproval: OnApproval | undefined,
    runSignal: AbortSignal,
    fail: (error: unknown) => void,
  ) {
    this.#transport = transport;
    this.#onApproval = onApproval;
    this.#runSignal = runSignal;
    this.#fail = fail;
  }

  started(sessionId: string): void {
    this.#sessionId = sessionId;
    this.#kick();
  }

  record(rec: AmspRecord): void {
    const p = rec.payload as { type?: string; tool_call_id?: string; status?: string };
    if (rec.type === "model_msg" && p.type === "tool_call") {
      // A decision follows every call the server dispatches, before its Request ends.
      this.#undecided.set(approvalKey(rec.origin, p.tool_call_id ?? ""), originKey(rec.origin));
      this.#kick();
    } else if (rec.type === "event_msg" && p.type === "approval_decision") {
      this.#undecided.delete(approvalKey(rec.origin, p.tool_call_id ?? ""));
      if (!this.#wanted()) this.#look?.abort();
    } else if (rec.type === "event_msg" && p.type === "request_end" && p.status !== "completed") {
      // A Request that did not complete: a call of its Session still undecided was closed with
      // it (an interruption or a failure cut the call short) and is never dispatched.
      const origin = originKey(rec.origin);
      for (const [key, from] of this.#undecided) if (from === origin) this.#undecided.delete(key);
      if (!this.#wanted()) this.#look?.abort();
    }
  }

  /** The run is over: nothing more is answered. */
  stop(): void {
    this.#open = false;
    this.#look?.abort();
  }

  /** Whether a look should be open: an undecided call nobody is answering, and no answer underway. */
  #wanted(): boolean {
    if (!this.#open || this.#runSignal.aborted) return false;
    if (this.#sessionId === null || this.#inFlight > 0) return false;
    for (const key of this.#undecided.keys()) if (!this.#answered.has(key)) return true;
    return false;
  }

  #kick(): void {
    if (this.#look !== null || !this.#wanted()) return;
    void this.#poll();
  }

  async #poll(): Promise<void> {
    const sessionId = this.#sessionId!;
    while (this.#wanted()) {
      const look = new AbortController();
      const onRunAbort = () => look.abort(this.#runSignal.reason);
      this.#runSignal.addEventListener("abort", onRunAbort, { once: true });
      this.#look = look;
      let approvals: PendingApproval[];
      try {
        const res = await this.#transport.get<ApprovalsResponse>(
          `${sessionPath(sessionId)}/approvals?wait=${APPROVAL_WAIT_S}`,
          { signal: look.signal },
        );
        approvals = res.body?.approvals ?? [];
      } catch (err) {
        this.#look = null;
        // Closed on purpose (every call decided, or the run over): look again only if a call
        // arrived meanwhile, which the loop's condition says.
        if (look.signal.aborted) continue;
        this.#fail(err);
        return;
      } finally {
        this.#runSignal.removeEventListener("abort", onRunAbort);
      }
      this.#look = null;
      for (const approval of approvals) {
        const key = approvalKey(approval.origin, approval.tool_call.tool_call_id);
        if (this.#answered.has(key)) continue;
        this.#answered.add(key);
        void this.#answer(sessionId, approval);
      }
    }
    this.#look = null;
  }

  /**
   * One answer: the callback's decision, else `deny`. The call being gone by then (someone
   * answered first in the Web App, or the run ended) is not a failure. Any other failure to answer
   * would leave the run waiting for good, so it ends the run.
   */
  async #answer(sessionId: string, approval: PendingApproval): Promise<void> {
    this.#inFlight += 1;
    try {
      let decision: ApprovalAnswer = "deny";
      if (this.#onApproval) {
        try {
          const answer = await this.#onApproval(approval.tool_call, approval.origin, { sessionId });
          decision = answer === "allow" ? "allow" : "deny";
        } catch {
          decision = "deny";
        }
      }
      if (!this.#open) return;
      try {
        await this.#transport.post(
          approvalPath(sessionId, approval.tool_call.tool_call_id),
          { decision } satisfies ApprovalRequest,
          { signal: this.#runSignal },
        );
      } catch (err) {
        if (err instanceof AmspHttpError && err.code === "approval_not_found") return;
        if (this.#runSignal.aborted) return;
        this.#fail(err);
      }
    } finally {
      this.#inFlight -= 1;
      this.#kick();
    }
  }
}

class AgentRun implements Run {
  readonly session: Promise<string>;
  readonly #transport: Transport;
  readonly #result: Promise<RunResult>;
  /** Aborted by the caller's signal, or by an approval that could not be answered. */
  readonly #control = new AbortController();
  /** Records not yet read by the iterator; null when nobody will read them (`run()`, or after the loop left). */
  #queue: AmspRecord[] | null;
  #iterated = false;
  #waiter: {
    resolve: (result: IteratorResult<AmspRecord>) => void;
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
    await this.#transport.post(`${sessionPath(sessionId)}/abort`);
  }

  [Symbol.asyncIterator](): AsyncIterator<AmspRecord> {
    if (this.#iterated) throw new TypeError("A run's records can be iterated once.");
    this.#iterated = true;
    return {
      next: () => this.#next(),
      return: () => {
        this.#queue = null;
        return Promise.resolve(END);
      },
    };
  }

  #next(): Promise<IteratorResult<AmspRecord>> {
    if (this.#queue === null) return Promise.resolve(END);
    // Aborted: reads fail at once and what was buffered is dropped, as an aborted fetch body does.
    // A run that completed is not undone by an abort that came after it.
    if (this.#control.signal.aborted && this.#outcome?.ok !== true) {
      this.#queue = null;
      return Promise.reject(this.#control.signal.reason);
    }
    const record = this.#queue.shift();
    if (record !== undefined) return Promise.resolve({ value: record, done: false });
    const outcome = this.#outcome;
    if (outcome !== null) {
      this.#queue = null;
      return outcome.ok ? Promise.resolve(END) : Promise.reject(outcome.error);
    }
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  #push(record: AmspRecord): void {
    if (this.#waiter !== null) {
      this.#waiter.resolve({ value: record, done: false });
      this.#waiter = null;
    } else {
      this.#queue?.push(record);
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
    const collector = new RunCollector(
      opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {},
    );
    const approvals = new ApprovalLoop(this.#transport, opts.onApproval, control.signal, (err) =>
      control.abort(err),
    );
    let named = false;
    /** Resolves `session` once the collector knows the Session and the stream has a frame. */
    const name = () => {
      const sessionId = collector.sessionId;
      if (named || sessionId === null) return;
      named = true;
      this.#resolveSession(sessionId);
      approvals.started(sessionId);
    };
    try {
      const request: RunRequest = {
        ...(opts.sessionId !== undefined ? { session_id: opts.sessionId } : {}),
        input: opts.input,
      };
      let end: "done" | "closed";
      try {
        end = await this.#transport.stream(`${agentPath}/runs`, {
          method: "POST",
          body: request,
          signal: control.signal,
          onControl: name,
          onRecord: (_id, record) => {
            collector.add(record);
            name();
            approvals.record(record);
            this.#push(record);
          },
        });
      } catch (err) {
        if (control.signal.aborted) throw control.signal.reason;
        if (err instanceof AmspHttpError || err instanceof AmspStreamError) throw err;
        throw new AmspStreamError(`The stream broke before [DONE]: ${String(err)}`, { cause: err });
      }
      if (end !== "done") {
        throw new AmspStreamError(
          "The stream ended before [DONE]: the connection broke, or the server did.",
        );
      }
      const result = collector.result();
      this.#end({ ok: true });
      return result;
    } catch (error) {
      this.#end({ ok: false, error });
      throw error;
    } finally {
      approvals.stop();
      signal?.removeEventListener("abort", forward);
    }
  }
}

/** The query string of a history page. */
function pageQuery(page: MessagesPage | undefined): string {
  if (page === undefined) return "";
  if ("tailLimit" in page) return `?tailLimit=${page.tailLimit}`;
  const limit = page.limit !== undefined ? `&limit=${page.limit}` : "";
  return `?before=${encodeURIComponent(page.before)}${limit}`;
}

/**
 * A client of one Agent's API.
 *
 * ```ts
 * const client = new AgentClient({ baseUrl: "http://localhost:7364/api/amsp/v1", agent: "demo/coder", apiKey });
 * const { text, sessionId } = await client.run({ input: "Summarize README.md" });
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
    if (opts.transport === undefined && opts.baseUrl === undefined) {
      throw new TypeError("AgentClient needs a baseUrl, or a transport.");
    }
    this.#transport =
      opts.transport ??
      new HttpTransport({ ...opts, baseUrl: opts.baseUrl! } as HttpTransportOptions);
    this.#agentPath = `/agents/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}`;
  }

  /** Starts a run and streams its records; see {@link Run}. */
  stream(opts: RunOptions): Run {
    return new AgentRun(this.#transport, this.#agentPath, opts, true);
  }

  /** Runs to the end and returns the result; nothing is kept for iteration. */
  run(opts: RunOptions): Promise<RunResult> {
    return new AgentRun(this.#transport, this.#agentPath, opts, false).result();
  }

  /** The Agent's id, name and description. */
  async agent(): Promise<AgentInfo> {
    const res = await this.#transport.get<AgentResponse>(this.#agentPath);
    return res.body!.agent;
  }

  /** One of the Agent's API Sessions: its status and model. */
  async session(sessionId: string): Promise<SessionInfo> {
    const res = await this.#transport.get<SessionResponse>(sessionPath(sessionId));
    return res.body!.session;
  }

  /** A Session's history: all of it, or one window of whole Tasks (see {@link MessagesResponse}). */
  async messages(sessionId: string, page?: MessagesPage): Promise<MessagesResponse> {
    const res = await this.#transport.get<MessagesResponse>(
      `${sessionPath(sessionId)}/messages${pageQuery(page)}`,
    );
    return res.body!;
  }

  /**
   * The calls the Session waits on a decision for. With `wait` (1–60 seconds) the server holds
   * the answer until there is one, or the time is up (an empty list).
   */
  async approvals(sessionId: string, wait?: number): Promise<PendingApproval[]> {
    const query = wait !== undefined ? `?wait=${wait}` : "";
    const res = await this.#transport.get<ApprovalsResponse>(
      `${sessionPath(sessionId)}/approvals${query}`,
    );
    return res.body?.approvals ?? [];
  }

  /** Aborts the Session's running run; `false` when nothing was running. */
  async abort(sessionId: string): Promise<boolean> {
    const res = await this.#transport.post(`${sessionPath(sessionId)}/abort`);
    return res.status === 202;
  }

  /** Answers a pending approval; an {@link AmspHttpError} `approval_not_found` when it was already decided. */
  async approve(sessionId: string, toolCallId: string, decision: ApprovalAnswer): Promise<void> {
    await this.#transport.post(approvalPath(sessionId, toolCallId), {
      decision,
    } satisfies ApprovalRequest);
  }
}
