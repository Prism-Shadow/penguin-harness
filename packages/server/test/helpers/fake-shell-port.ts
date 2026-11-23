/**
 * The desktop shell's message port as the server sees it (`process.parentPort`, services/
 * desktop-update-port.ts `ShellPort`): frames the server posts are recorded, frames the shell
 * sends are emitted. One fake for every suite that plays the shell — the updater, the tray,
 * folder access, window opening, and the agent browser's link (which also unsubscribes).
 */
import type { ShellPort } from "@prismshadow/penguin-library-setting/desktop-update-port";

type Listener = (e: { data: unknown }) => void;

export class FakePort implements ShellPort {
  readonly sent: unknown[] = [];
  onPost: ((message: unknown) => void) | null = null;
  private readonly listeners = new Set<Listener>();

  on(_event: "message", listener: Listener): void {
    this.listeners.add(listener);
  }

  off(_event: "message", listener: Listener): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    this.sent.push(message);
    this.onPost?.(message);
  }

  /** A frame from the shell. */
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data });
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
