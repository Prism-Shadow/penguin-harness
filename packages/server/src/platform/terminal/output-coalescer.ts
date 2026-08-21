/**
 * Per-stream output throttle.
 *
 * A pty emits many small chunks; forwarding each one as its own socket frame floods the
 * event loop under build output. This merges chunks inside a short window — but as a
 * **leading + trailing** throttle, not a plain trailing one: the first chunk after an idle
 * window flushes synchronously, so a keystroke echo never pays the window. Only sustained
 * bursts wait for the trailing timer.
 *
 * Reverting this to trailing-only is the classic regression here: it adds a full window
 * (~5ms) to every single keystroke and the terminal immediately feels mushy.
 */

export const DEFAULT_COALESCE_WINDOW_MS = 5;

export class TerminalOutputCoalescer {
  private pending = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;

  constructor(
    private readonly flushFn: (data: string) => void,
    private readonly windowMs: number = DEFAULT_COALESCE_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  push(data: string): void {
    if (data.length === 0) return;
    this.pending += data;

    if (this.timer !== null) return; // a trailing flush is already scheduled

    const elapsed = this.now() - this.lastFlushAt;
    if (elapsed >= this.windowMs) {
      this.flush(); // leading edge: straight through, no added latency
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.windowMs - elapsed);
  }

  /**
   * Flushes anything buffered. Callers must invoke this before sending an out-of-band
   * message (restore, exit) so ordering with the output stream is preserved.
   */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastFlushAt = this.now();
    if (this.pending.length === 0) return;
    const data = this.pending;
    this.pending = "";
    this.flushFn(data);
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = "";
  }
}
