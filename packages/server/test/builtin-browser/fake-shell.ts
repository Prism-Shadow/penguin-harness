/**
 * Test doubles for the built-in browser's shell side: a fake `process.parentPort`, and a fake
 * shell behind it that speaks the desktop-browser protocol the way builtin-browser.ts does —
 * one reply per command, tab events pushed as its guests change. Its CDP answers come from a
 * handler each test supplies.
 */
import type {
  BuiltinBrowserTab,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserCookie,
  DesktopBrowserEvent,
} from "../../src/api/types.js";
import type { BrowserShellPort } from "../../src/builtin-browser/shell-link.js";

type Listener = (e: { data: unknown }) => void;

/** `process.parentPort`, as the link uses it: frames out are recorded, frames in are emitted. */
export class FakePort implements BrowserShellPort {
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

export type CdpHandler = (
  tabId: number,
  method: string,
  params: Record<string, unknown> | undefined,
) => unknown;

export function tab(id: number, patch: Partial<BuiltinBrowserTab> = {}): BuiltinBrowserTab {
  return {
    id,
    url: `https://example.test/${id}`,
    title: `Page ${id}`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...patch,
  };
}

/** A shell hosting guests: answers commands (hello, tabs, cdp, cookies, clear-data) and pushes events. */
export class FakeShell {
  readonly port = new FakePort();
  readonly guests = new Map<number, BuiltinBrowserTab>();
  readonly cookies: DesktopBrowserCookie[] = [];
  readonly commands: DesktopBrowserCommand[] = [];
  /** False plays a shell older than the browser: it never answers anything. */
  speaksBrowser = true;
  /** Answers `cdp`; throw to make the shell refuse the command with that message. */
  cdp: CdpHandler = () => ({});

  constructor() {
    this.port.onPost = (message) => void this.handle(message);
  }

  /** A guest attaches (or changes): the shell pushes its state. */
  show(t: BuiltinBrowserTab): void {
    this.guests.set(t.id, t);
    this.event({ kind: "tab", tab: t });
  }

  /** A guest is destroyed. */
  close(tabId: number): void {
    this.guests.delete(tabId);
    this.event({ kind: "tab-closed", tabId });
  }

  event(event: DesktopBrowserEvent): void {
    this.port.emit({ type: "desktop-browser-event", event });
  }

  private reply(id: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }) {
    // Asynchronous, like a real port: never inside the sender's own call.
    setImmediate(() => this.port.emit({ type: "desktop-browser-reply", id, ...outcome }));
  }

  private async handle(message: unknown): Promise<void> {
    const msg = message as DesktopBrowserCommandMessage;
    if (msg?.type !== "desktop-browser-command" || !this.speaksBrowser) return;
    const command = msg.command;
    this.commands.push(command);
    switch (command.op) {
      case "hello":
        this.reply(msg.id, {
          ok: true,
          result: { version: 1, partition: "persist:penguin-browser" },
        });
        return;
      case "tabs":
        this.reply(msg.id, { ok: true, result: { tabs: [...this.guests.values()] } });
        return;
      case "cdp": {
        if (!this.guests.has(command.tabId)) {
          this.reply(msg.id, { ok: false, error: "no_such_tab" });
          return;
        }
        try {
          const result = await this.cdp(command.tabId, command.method, command.params);
          this.reply(msg.id, { ok: true, result });
        } catch (err) {
          this.reply(msg.id, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case "set-cookies":
        this.cookies.push(...command.cookies);
        this.reply(msg.id, {
          ok: true,
          result: { set: command.cookies.length, failed: 0, errors: [] },
        });
        return;
      case "clear-data":
        this.reply(msg.id, { ok: true, result: {} });
        return;
    }
  }
}

/** A Runtime.evaluate answer carrying `value`, as CDP returns one by value. */
export function evaluated(value: unknown): unknown {
  return value === undefined
    ? { result: { type: "undefined" } }
    : { result: { type: typeof value, value } };
}

/** The expression a Runtime.evaluate command carries. */
export function expressionOf(params: Record<string, unknown> | undefined): string {
  return typeof params?.expression === "string" ? params.expression : "";
}
