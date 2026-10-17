import { armDeadline } from "../../../internal/deadline-timer.js";

/**
 * WakeSignal —— a single wakeup point shared by background sessions.
 *
 * Producer events (data arrival / run finished / new approval request) call `notify()`;
 * waiters use `wait(ms)` to wait for "woken up" or expiry, whichever comes first. `notify`
 * swaps in a new promise before resolving the old one, so a waiter that wakes up just
 * re-checks state — it never misses an event that immediately follows.
 */
export class WakeSignal {
  private promise!: Promise<void>;
  private resolve!: () => void;

  constructor() {
    this.arm();
  }

  private arm(): void {
    this.promise = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Wakes up all waiters: swaps in a new promise before resolving the old one (avoids missing an event that immediately follows). */
  notify(): void {
    const r = this.resolve;
    this.arm();
    r();
  }

  /** Waits for "woken up" or `ms` to elapse, whichever comes first. */
  async wait(ms: number): Promise<void> {
    let settle!: () => void;
    const timeout = new Promise<void>((resolve) => {
      settle = resolve;
    });
    // wait is part of an active operation: the timer needs to keep the process alive, and is cleaned up immediately below after notify.
    const cancel = armDeadline(ms, settle);
    try {
      await Promise.race([this.promise, timeout]);
    } finally {
      cancel();
    }
  }
}
