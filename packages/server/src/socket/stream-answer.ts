/**
 * How a route answers a socket-transported streaming call (PRFC-0011): the frames go out
 * directly — a `start`, then one `event` per event, then an `end` — with no HTTP Response in
 * between. The platform's `fetchStream` carries one on the Request into the route
 * (socket/serve.ts); a route that answers a Response instead — an auth refusal, a machine's
 * non-streaming answer — never touches it, and the socket frames that Response like any
 * call's answer.
 *
 * `start` goes first and the route sends it itself: that is the whole ordering rule — there
 * is no queue, because nothing can be written before the stream it belongs to has begun.
 * The call's Request signal is the one release path: a cancel frame, the socket closing and
 * a reader lagging past the send watermark all end the route's own subscription through it.
 */
import type { EndFrame, EventFrame, ServerFrame, StreamStartFrame } from "./frames.js";

/** The frames an answer sends, its id stamped in by the class. */
type AnswerFrame = Omit<StreamStartFrame, "id"> | Omit<EventFrame, "id"> | Omit<EndFrame, "id">;

/** One streaming call's way out: a bound `send`, a start that has to go first, and an end. */
export class StreamAnswer {
  readonly #send: (frame: AnswerFrame) => void;
  readonly #abort: () => void;
  readonly #lagging: () => boolean;
  #started = false;
  #ended = false;
  #settle: () => void = () => {};

  constructor(
    id: number,
    send: (frame: ServerFrame) => void,
    controller: AbortController,
    /** Whether the reader is beyond the send watermark (the socket's bufferedAmount). */
    lagging: () => boolean,
  ) {
    this.#send = (frame) => send({ ...frame, id } as ServerFrame);
    this.#abort = () => controller.abort();
    this.signal = controller.signal;
    this.#lagging = lagging;
    this.done = new Promise((resolve) => {
      this.#settle = () => resolve();
    });
    // The call's release ends the answer too — the one end its reader never hears.
    controller.signal.addEventListener("abort", this.#settle, { once: true });
  }

  /** The call's Request's signal: a route wires its own cleanup to it (see the class comment). */
  readonly signal: AbortSignal;

  /** Settles when the answer is over, however it ended — its `end`, the lagging break, or the call's release (serve.ts waits on it). */
  readonly done: Promise<void>;

  /** Whether the route answered a stream; a Response it returned otherwise is framed like any call's. */
  get started(): boolean {
    return this.#started;
  }

  /** The stream has begun: its status and its headers, once. */
  start(status: number, headers: Record<string, string>): void {
    if (this.#started || this.#ended) return;
    this.#started = true;
    this.#send({
      status,
      stream: true,
      headers: { date: new Date().toUTCString(), ...headers },
    });
  }

  /** One event of the stream, in SSE's three fields. */
  event(event: string, eventId: string | null, data: string): void {
    if (this.#ended || !this.#started || this.signal.aborted) return;
    if (this.#lagging()) {
      // Fast-forward, never buffer without bound: the client re-issues the call with its
      // last event id and the endpoint's own buffer fills the gap (or says resync). This
      // is the one end a released call still hears.
      this.#ended = true;
      this.#settle();
      this.#abort();
      this.#send({ end: true, reason: "lagging" });
      return;
    }
    this.#send({ event, eventId, data });
  }

  /**
   * The stream is over; `reason` is the client's to act on ("closed"). No frame is sent for
   * a stream that never began, or for a call already released — its reader is gone or
   * re-issuing already, which is every end but the lagging break above.
   */
  end(reason: string = "closed"): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#settle();
    if (!this.#started || this.signal.aborted) return;
    this.#send({ end: true, reason });
  }
}

/** Where a call's answer rides its Request, from the platform's fetchStream into the route. */
const ANSWER = Symbol("stream-answer");

/** Carries the answer of the call `request` is, for the route to find. */
export function carryStreamAnswer<T extends Request>(request: T, answer: StreamAnswer): T {
  (request as T & { [ANSWER]?: StreamAnswer })[ANSWER] = answer;
  return request;
}

/** The answer of the call a request is, when the socket transported it; null over HTTP. */
export function answerOf(request: Request): StreamAnswer | null {
  return (request as Request & { [ANSWER]?: StreamAnswer })[ANSWER] ?? null;
}
