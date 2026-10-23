/**
 * The input echo of a run: the input a host submitted, published on the Session's channel by the
 * server because core never yields a run's own input (only a stop hook's later injections).
 *
 * It goes out right behind the run's first `task_begin`, so the stream carries a Task's records
 * in the order its Trace has them — `task_begin`, then the input, then the rest. A stream that
 * opens with anything else (a RuntimeSession that writes no Task records) gets the echo ahead of
 * that first record, and one that ends without yielding anything gets it at the end: whatever the
 * stream, the echo is published exactly once.
 */
import { isTaskBegin } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";

export class InputEcho {
  private pending: OmniMessage[];

  constructor(
    input: readonly OmniMessage[],
    private readonly publish: (msg: OmniMessage) => void,
  ) {
    this.pending = [...input];
  }

  /** Call with each streamed message before it is published: anything but the opening `task_begin` takes the echo out first. */
  before(msg: OmniMessage): void {
    if (this.pending.length > 0 && !isMainTaskBegin(msg)) this.flush();
  }

  /** Call with each streamed message after it is published: the opening `task_begin` takes the echo out behind it. */
  after(msg: OmniMessage): void {
    if (isMainTaskBegin(msg)) this.flush();
  }

  /** Publishes what is still held (nothing, once published); call when the stream ends. */
  flush(): void {
    const held = this.pending;
    this.pending = [];
    for (const msg of held) this.publish(msg);
  }
}

function isMainTaskBegin(msg: OmniMessage): boolean {
  return (msg.origin === undefined || msg.origin.length === 0) && isTaskBegin(msg);
}
