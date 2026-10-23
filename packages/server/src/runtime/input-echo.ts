/**
 * The input echo of a run: the input a host submitted, published on the Session's channel by the
 * server because core never yields a run's own input (only a stop hook's later injections).
 *
 * It goes out right behind the run's first `task_begin`, so the stream carries a Task's records
 * in the order its Trace has them:
 * - on a Session's first message `session_meta`, `task_begin`, then the input — a `session_meta`
 *   the run opens with stays ahead of the echo;
 * - on the first message after a compaction, `task_begin`, the new context's `session_meta`,
 *   then the input: the input is what opens the new Trace file, so its meta comes first. The
 *   manager says so up front (core `Session.contextOpenPending`), and the echo then waits for
 *   that meta;
 * - otherwise `task_begin`, then the input.
 *
 * A stream that opens with anything else (a RuntimeSession that writes no Task records) gets the
 * echo ahead of that first record, a held echo whose meta does not come goes out ahead of the next
 * record instead, and one that ends without yielding anything gets it at the end: whatever the
 * stream, the echo is published exactly once.
 */
import { isSessionMeta, isTaskBegin } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";

export class InputEcho {
  private pending: AmspRecord[];
  /** The opening `task_begin` has gone out. */
  private begun = false;

  constructor(
    input: readonly AmspRecord[],
    private readonly publish: (msg: AmspRecord) => void,
    /** This run opens a new context's file: the echo waits behind its `session_meta`. */
    private readonly afterContextMeta = false,
  ) {
    this.pending = [...input];
  }

  /** Call with each streamed message before it is published: anything but an opening record takes the echo out first. */
  before(msg: AmspRecord): void {
    const opening =
      isMain(msg) &&
      ((!this.begun && isTaskBegin(msg)) ||
        (isSessionMeta(msg) && (!this.begun || this.afterContextMeta)));
    if (!opening) this.flush();
  }

  /** Call with each streamed message after it is published: the opening `task_begin` (or the meta it waits for) takes the echo out behind it. */
  after(msg: AmspRecord): void {
    if (!isMain(msg)) return;
    if (isTaskBegin(msg) && !this.begun) {
      this.begun = true;
      if (!this.afterContextMeta) this.flush();
      return;
    }
    if (isSessionMeta(msg) && this.begun) this.flush();
  }

  /** Publishes what is still held (nothing, once published); call when the stream ends. */
  flush(): void {
    const held = this.pending;
    this.pending = [];
    for (const msg of held) this.publish(msg);
  }
}

function isMain(msg: AmspRecord): boolean {
  return msg.origin === undefined || msg.origin.length === 0;
}
