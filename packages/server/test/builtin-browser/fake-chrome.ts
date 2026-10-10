/**
 * Test double for the chrome backend's far side: the PenguinHarness Browser extension, as the
 * socket the server's ExtensionLink holds (ExtensionSocket). It speaks the extension's side of
 * the protocol the way the real one does — answers hello, tabs, ping, open-tab, close-tab,
 * activate-tab and cdp, pushes tab events, and fails a released tab's commands with
 * `tab_released` — over JSON text frames, so the link's own parsing runs. Its CDP answers come
 * from a handler each test supplies.
 *
 * extension-link.test.ts drives the real `ws` socket instead; this one is for the scenarios
 * above the wire (the runtime, the routes).
 */
import type {
  BuiltinBrowserTab,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserEvent,
} from "../../src/api/types.js";
import type { ExtensionSocket } from "../../src/builtin-browser/extension-link.js";
import type { CdpHandler } from "./fake-shell.js";

export class FakeChrome implements ExtensionSocket {
  readonly guests = new Map<number, BuiltinBrowserTab>();
  readonly commands: DesktopBrowserCommand[] = [];
  /** The tabs the user took back, with why. */
  readonly released = new Map<number, string>();
  /** How the server closed this socket, once it has. */
  closedWith: { code: number; reason: string } | null = null;
  /** Answers `cdp`; throw to refuse the command with that message. */
  cdp: CdpHandler = () => ({});
  /** False plays an extension that stopped answering pings. */
  answersPings = true;
  private nextTabId = 100;
  /** cdp commands waiting for their answer, by tab, so a release can fail them. */
  private readonly waiting = new Map<string, number>();
  private messageListener: ((text: string) => void) | null = null;
  private closeListener: ((code: number) => void) | null = null;

  send(text: string): void {
    void this.handle(JSON.parse(text) as DesktopBrowserCommandMessage);
  }

  close(code: number, reason: string): void {
    this.closedWith ??= { code, reason };
  }

  onMessage(listener: (text: string) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: (code: number) => void): void {
    this.closeListener = listener;
  }

  /** The extension went away (Chrome closed, the network dropped). */
  drop(code = 1006): void {
    this.closeListener?.(code);
  }

  /** A tab changes in Chrome: the extension pushes its state. */
  show(tab: BuiltinBrowserTab): void {
    this.guests.set(tab.id, tab);
    this.event({ kind: "tab", tab });
  }

  /** The user pressed Cancel on Chrome's debugging bar (or the like): the tab is theirs again. */
  release(tabId: number, reason: "user" | "detached" | "restricted" = "user"): void {
    this.released.set(tabId, reason);
    this.event({ kind: "tab-released", tabId, reason });
    for (const [id, tab] of this.waiting) {
      if (tab !== tabId) continue;
      this.waiting.delete(id);
      this.reply(id, { ok: false, error: "tab_released" });
    }
  }

  event(event: DesktopBrowserEvent): void {
    this.messageListener?.(JSON.stringify({ type: "desktop-browser-event", event }));
  }

  private reply(id: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }) {
    // Asynchronous, like a real socket: never inside the sender's own call.
    setImmediate(() =>
      this.messageListener?.(JSON.stringify({ type: "desktop-browser-reply", id, ...outcome })),
    );
  }

  private async handle(msg: DesktopBrowserCommandMessage): Promise<void> {
    const command = msg.command;
    this.commands.push(command);
    switch (command.op) {
      case "hello":
        this.reply(msg.id, {
          ok: true,
          result: {
            version: 1,
            backend: "chrome",
            extension: { version: "0.2.13", chrome: "130", name: "Chrome 130 on Linux" },
          },
        });
        return;
      case "tabs":
        this.reply(msg.id, { ok: true, result: { tabs: [...this.guests.values()] } });
        return;
      case "ping":
        if (this.answersPings) this.reply(msg.id, { ok: true, result: {} });
        return;
      case "open-tab": {
        const tab: BuiltinBrowserTab = {
          id: this.nextTabId++,
          url: command.url,
          title: command.url,
          loading: false,
          canGoBack: false,
          canGoForward: false,
        };
        this.show(tab);
        this.reply(msg.id, { ok: true, result: { tab } });
        return;
      }
      case "close-tab":
        this.guests.delete(command.tabId);
        this.event({ kind: "tab-closed", tabId: command.tabId });
        this.reply(msg.id, { ok: true, result: {} });
        return;
      case "activate-tab":
        this.reply(msg.id, { ok: true, result: {} });
        return;
      case "cdp": {
        if (this.released.has(command.tabId)) {
          this.reply(msg.id, { ok: false, error: "tab_released" });
          return;
        }
        if (!this.guests.has(command.tabId)) {
          this.reply(msg.id, { ok: false, error: "no_such_tab" });
          return;
        }
        this.waiting.set(msg.id, command.tabId);
        try {
          const result = await this.cdp(command.tabId, command.method, command.params);
          if (this.waiting.delete(msg.id)) this.reply(msg.id, { ok: true, result });
        } catch (err) {
          if (this.waiting.delete(msg.id)) {
            this.reply(msg.id, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }
      default:
        this.reply(msg.id, { ok: false, error: "unknown_op" });
    }
  }
}
