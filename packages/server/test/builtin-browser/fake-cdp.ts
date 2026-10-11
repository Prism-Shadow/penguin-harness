/**
 * Test doubles for the hosted backend's far side: a headless Chrome as its CDP pipe (CdpPipe),
 * and the machine that has it (ChromeHost). The fake Chrome speaks the browser's side of CDP the
 * way the real one does for what the link uses — its version, target discovery, creating,
 * attaching to, activating and closing page targets, and a page session's navigation with the
 * events around it — over JSON text, so the link's own parsing runs. Everything else a session
 * is asked comes from a handler each test supplies.
 */
import type { CdpPipe, ChromeHost } from "../../src/builtin-browser/hosted-chrome.js";

export interface SentCommand {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Answers a command the fake has no answer of its own for (or overrides one of its own); throw
 * to make Chrome refuse it with that message, return undefined for the fake's own answer.
 */
export type CdpAnswer = (
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
) => unknown;

export class FakeCdpChrome implements CdpPipe {
  readonly sent: SentCommand[] = [];
  /** The page targets open now: target id → address. */
  readonly targets = new Map<string, string>();
  cdp: CdpAnswer = () => undefined;
  product = "Chrome/140.0.7339.16";
  /** What it has printed to stderr. */
  printed = "";
  /** `hang`: never answers anything. `exit`: exits with code 1 at its first command. */
  startup: "ok" | "hang" | "exit" = "ok";
  killed = false;
  exited = false;
  private nextTarget = 1;
  private messageListener: ((text: string) => void) | null = null;
  private readonly closeListeners = new Set<
    (exit: { code: number | null; signal: string | null }) => void
  >();

  send(text: string): void {
    if (this.exited) throw new Error("Chrome has exited.");
    const command = JSON.parse(text) as SentCommand;
    this.sent.push(command);
    // Asynchronous, like a real pipe: never inside the sender's own call.
    setImmediate(() => void this.handle(command));
  }

  onMessage(listener: (text: string) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: (exit: { code: number | null; signal: string | null }) => void): void {
    this.closeListeners.add(listener);
  }

  stderr(): string {
    return this.printed;
  }

  kill(): void {
    this.killed = true;
    setImmediate(() => this.exit(0));
  }

  /** The process ends on its own (a crash, or somebody killed it). */
  exit(code: number | null = 1, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    for (const listener of this.closeListeners) listener({ code, signal });
  }

  /** An event from Chrome: the browser's, or a session's. */
  emit(method: string, params: Record<string, unknown>, sessionId?: string): void {
    if (this.exited) return;
    this.messageListener?.(
      JSON.stringify({ method, params, ...(sessionId !== undefined ? { sessionId } : {}) }),
    );
  }

  /** The session id a target is attached under. */
  sessionOf(targetId: string): string {
    return `S-${targetId}`;
  }

  /** A page opens a popup: a target nobody asked this fake for. */
  popup(url: string): string {
    const targetId = `T${this.nextTarget++}`;
    this.targets.set(targetId, url);
    this.emit("Target.targetCreated", { targetInfo: { targetId, type: "page", url, title: "" } });
    return targetId;
  }

  /** The commands sent so far, as `Domain.method` names. */
  methods(): string[] {
    return this.sent.map((command) => command.method);
  }

  private reply(id: number, outcome: { result: unknown } | { error: { message: string } }): void {
    if (this.exited) return;
    this.messageListener?.(JSON.stringify({ id, ...outcome }));
  }

  private async handle(command: SentCommand): Promise<void> {
    if (this.exited || this.startup === "hang") return;
    if (this.startup === "exit") {
      this.exit(1);
      return;
    }
    const { id, method, params, sessionId } = command;
    try {
      const own = await this.cdp(method, params, sessionId);
      this.reply(id, { result: own !== undefined ? own : this.answer(method, params, sessionId) });
    } catch (err) {
      this.reply(id, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
  }

  private answer(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): unknown {
    const targetId = sessionId !== undefined ? sessionId.slice(2) : String(params.targetId ?? "");
    switch (method) {
      case "Browser.getVersion":
        return { product: this.product };
      case "Target.createTarget": {
        const created = `T${this.nextTarget++}`;
        const url = String(params.url ?? "about:blank");
        this.targets.set(created, url);
        this.emit("Target.targetCreated", {
          targetInfo: { targetId: created, type: "page", url, title: "" },
        });
        return { targetId: created };
      }
      case "Target.attachToTarget":
        if (!this.targets.has(targetId)) throw new Error("No target with given id found");
        return { sessionId: this.sessionOf(targetId) };
      case "Target.closeTarget":
        if (!this.targets.delete(targetId)) throw new Error("No target with given id found");
        this.emit("Target.targetDestroyed", { targetId });
        return { success: true };
      case "Page.navigate": {
        const url = String(params.url);
        this.targets.set(targetId, url);
        this.emit("Page.frameStartedLoading", { frameId: targetId }, sessionId);
        this.emit("Target.targetInfoChanged", {
          targetInfo: { targetId, type: "page", url, title: `Title of ${url}` },
        });
        this.emit("Page.frameNavigated", { frame: { id: targetId, url } }, sessionId);
        this.emit("Page.frameStoppedLoading", { frameId: targetId }, sessionId);
        return { frameId: targetId };
      }
      case "Page.getNavigationHistory":
        return { currentIndex: 0, entries: [{ id: 1, url: this.targets.get(targetId) ?? "" }] };
      default:
        return {};
    }
  }
}

/** A machine with a Chrome at `path` (null: none installed); every launch is a new FakeCdpChrome. */
export class FakeChromeHost implements ChromeHost {
  path: string | null = "/fake/bin/chrome";
  readonly launched: FakeCdpChrome[] = [];
  /** The profile directories the launches were given, in order. */
  readonly profiles: string[] = [];
  /** Sets up each Chrome before the link first speaks to it. */
  prepare: (chrome: FakeCdpChrome) => void = () => {};

  find(configured: string | null): string | null {
    return configured ?? this.path;
  }

  launch(_chromePath: string, profileDir: string): CdpPipe {
    const chrome = new FakeCdpChrome();
    this.prepare(chrome);
    this.launched.push(chrome);
    this.profiles.push(profileDir);
    return chrome;
  }

  /** The Chrome launched last. */
  get chrome(): FakeCdpChrome {
    const chrome = this.launched.at(-1);
    if (chrome === undefined) throw new Error("no Chrome was launched");
    return chrome;
  }
}

/** A JPEG just long enough to say its size, as base64 (a screencast frame's `data`). */
export function jpeg(width: number, height: number): string {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]).toString("base64");
}
