/**
 * The hub's side of its machines' browser channels. A machine runs a plain server with no
 * browser of its own, so this server relays the person's own browser to it: the one its built-in
 * admin's agents drive here, the built-in browser or their paired Chrome. An agent in a Session
 * on the machine then drives that browser (design: 05「内置浏览器 › 机器上的会话」).
 *
 * `MachineRelays` looks the machines over every few seconds and dials each connected one without
 * a channel at `/api/builtin-browser/hub/ws`, through the connection this server holds to it (the
 * machine proxy's dial), signed in with the admin session minted there. On the channel the
 * machine is the server and this side the far side (hub-link.ts on the machine): it answers the
 * machine's hello with the backend driven now, and carries each command out in that browser
 * through the browser's own runtime — never more than the machine may ask:
 *
 * - every command names a page held for that machine (one its Sessions opened here, or a popup
 *   of one), and `tabs` lists only those;
 * - `open-tab` must name a Project that uses the machine; the page is the Session's, in that
 *   Project's partition;
 * - raw CDP goes through the user's-Chrome refusal list whatever the backend (the machine sees no
 *   cookie or store of the person's), and a navigation only to a web page; CDP events of the
 *   network and of the refused domains are not relayed;
 * - cookie, data and throttle commands are not relayed (`unknown_op`).
 *
 * The admin switching backend closes every channel and dials again, so each machine's next hello
 * names the browser driven now. A machine whose build has no hub endpoint (404) is not dialled
 * again until it has been seen disconnected.
 */
import type http from "node:http";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import type {
  BrowserBackend,
  BuiltinBrowserAction,
  BuiltinBrowserTab,
  DesktopBrowserCommand,
  DesktopBrowserEvent,
} from "@prismshadow/penguin-server/api";
import { isHttpError } from "@prismshadow/penguin-server/plugin";
import { refusedOutsideOwnStore } from "./backend-runtime.js";
import type { BrowserBackendRuntime } from "./backend-runtime.js";
import { HUB_WS_PATH } from "./hub-ws.js";
import { BrowserLinkError, BrowserUnavailableError } from "./link.js";
import { browserUrl } from "./service.js";
import type { Actor } from "./service.js";

/** A dial to a machine's server through the connection this server holds (the machine proxy's). */
export interface MachineTarget {
  agent: http.Agent;
  port: number;
  cookie: string;
}

/** A machine a Project uses, and whether this server holds a connection to it now. */
export interface RelayMachine {
  machineId: string;
  connected: boolean;
}

/** What the relay needs of the browser (service.ts). */
export interface RelayBrowser {
  backendOf(actor: Actor): BrowserBackend;
  relayRuntime(actor: Actor): BrowserBackendRuntime;
  openTab(
    actor: Actor,
    opts: {
      url?: unknown;
      sessionId?: string;
      projectId?: string;
      machineId?: string;
      activate?: boolean;
    },
  ): Promise<BuiltinBrowserTab>;
  onBackendChange(listener: (userId: string, backend: BrowserBackend) => void): () => void;
}

export interface MachineRelaysDeps {
  browser: RelayBrowser;
  /** Who the channels act for: this server's built-in admin (the desktop window's account). */
  admin: Actor;
  /** The Projects whose machines get a channel: the admin's. */
  projectIds(): string[];
  /** The machines a Project uses. */
  machines(projectId: string): Promise<RelayMachine[]>;
  /** A dial to a connected machine's server, or null when it is not connected. */
  dial(machineId: string): Promise<MachineTarget | null>;
  log(line: string): void;
  /** How often the machines are looked over. */
  sweepMs?: number;
}

const SWEEP_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
/** A screenshot of a tall page is the largest frame: well under this. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
/** The longest a relayed command may run here: the machine gives up on its own clock first. */
const RELAY_TIMEOUT_MS = 120_000;

/** A CDP event a machine may hear: not the network's (cookies ride its headers), nor a refused domain's. */
function relayedEvent(method: string): boolean {
  return !method.startsWith("Network.") && !refusedOutsideOwnStore(method);
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** Every machine's channel, kept up while the machine is connected. */
export class MachineRelays {
  private readonly channels = new Map<string, MachineChannel>();
  private readonly dialing = new Set<string>();
  /** Machines whose build has no hub endpoint: not dialled again until seen disconnected. */
  private readonly unsupported = new Set<string>();
  /** The Projects that use each machine, as of the last look. */
  private projectsOf = new Map<string, Set<string>>();
  private timer: NodeJS.Timeout | null = null;
  private sweeping: Promise<void> | null = null;
  private disposed = false;
  private readonly unwatch: () => void;

  constructor(private readonly deps: MachineRelaysDeps) {
    this.unwatch = deps.browser.onBackendChange((userId) => {
      if (userId === deps.admin.userId) this.redial();
    });
  }

  start(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.deps.sweepMs ?? SWEEP_MS);
    this.timer.unref?.();
  }

  /** The machines with a channel now. */
  linked(): string[] {
    return [...this.channels.keys()];
  }

  /** Looks the machines over and dials each connected one without a channel. Never throws. */
  sweep(): Promise<void> {
    if (this.sweeping !== null) return this.sweeping;
    this.sweeping = this.look()
      .catch((err: unknown) =>
        this.deps.log(`hub browser: looking over the machines failed: ${messageOf(err)}`),
      )
      .finally(() => {
        this.sweeping = null;
      });
    return this.sweeping;
  }

  /** Whether the Project uses the machine, as of the last look. */
  uses(machineId: string, projectId: string): boolean {
    return this.projectsOf.get(machineId)?.has(projectId) === true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unwatch();
    for (const channel of this.channels.values()) channel.close(1012, "server_restart");
    this.channels.clear();
  }

  private async look(): Promise<void> {
    const projectsOf = new Map<string, Set<string>>();
    const connected = new Set<string>();
    for (const projectId of this.deps.projectIds()) {
      for (const machine of await this.deps.machines(projectId)) {
        const projects = projectsOf.get(machine.machineId) ?? new Set<string>();
        projects.add(projectId);
        projectsOf.set(machine.machineId, projects);
        if (machine.connected) connected.add(machine.machineId);
      }
    }
    this.projectsOf = projectsOf;
    for (const machineId of this.unsupported) {
      if (!connected.has(machineId)) this.unsupported.delete(machineId);
    }
    const opening: Promise<void>[] = [];
    for (const machineId of connected) {
      if (this.disposed) return;
      if (this.channels.has(machineId) || this.dialing.has(machineId)) continue;
      if (this.unsupported.has(machineId)) continue;
      opening.push(this.open(machineId));
    }
    await Promise.all(opening);
  }

  private async open(machineId: string): Promise<void> {
    this.dialing.add(machineId);
    try {
      const target = await this.deps.dial(machineId);
      if (target === null || this.disposed) return;
      // The channel takes the socket the moment it opens: the machine says hello at once.
      const outcome = await connect(target, (socket) => this.attach(machineId, socket));
      if ("status" in outcome) {
        // A build older than the channel has no such endpoint; its Sessions keep no browser.
        if (outcome.status === 404) this.unsupported.add(machineId);
        else
          this.deps.log(
            `hub browser: machine ${machineId} refused the channel (${outcome.status})`,
          );
        return;
      }
      if ("error" in outcome) {
        this.deps.log(`hub browser: the channel to machine ${machineId} failed: ${outcome.error}`);
      }
    } catch (err) {
      this.deps.log(`hub browser: dialling machine ${machineId} failed: ${messageOf(err)}`);
    } finally {
      this.dialing.delete(machineId);
    }
  }

  /** A socket that just opened becomes the machine's channel (or is closed, past dispose). */
  private attach(machineId: string, socket: WebSocket): void {
    if (this.disposed) {
      socket.close(1012, "server_restart");
      return;
    }
    const channel = new MachineChannel(machineId, socket, {
      browser: this.deps.browser,
      admin: this.deps.admin,
      uses: (projectId) => this.uses(machineId, projectId),
      log: this.deps.log,
    });
    this.channels.set(machineId, channel);
    channel.onClose(() => {
      if (this.channels.get(machineId) === channel) this.channels.delete(machineId);
    });
  }

  /** Closes every channel and dials again at once: each machine's next hello names the browser now. */
  private redial(): void {
    for (const channel of this.channels.values()) channel.close(1012, "backend_changed");
    this.channels.clear();
    void this.sweep();
  }
}

/**
 * Opens the channel through the dial, handing the socket to `opened` as it opens — before any of
 * its frames is read — or says the status the machine refused it with.
 */
function connect(
  target: MachineTarget,
  opened: (socket: WebSocket) => void,
): Promise<{ socket: WebSocket } | { status: number } | { error: string }> {
  return new Promise((resolve) => {
    // No Origin: the machine refuses one (hub-ws.ts), since only a browser page sends it.
    const socket = new WebSocket(`ws://127.0.0.1:${target.port}${HUB_WS_PATH}`, {
      agent: target.agent,
      headers: { host: `localhost:${target.port}`, cookie: target.cookie },
      perMessageDeflate: false,
      maxPayload: MAX_FRAME_BYTES,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
    });
    socket.on("error", (err) => resolve({ error: err.message }));
    socket.once("unexpected-response", (request, response) => {
      response.resume();
      request.destroy();
      resolve({ status: response.statusCode ?? 0 });
    });
    socket.once("open", () => {
      opened(socket);
      resolve({ socket });
    });
  });
}

interface ChannelDeps {
  browser: RelayBrowser;
  admin: Actor;
  /** Whether the Project uses this machine. */
  uses(projectId: string): boolean;
  log(line: string): void;
}

/**
 * One machine's channel: the machine's commands carried out in the browser, and that browser's
 * events about the machine's pages sent back. The browser is the one the admin drives when the
 * channel opens; a switch closes the channel (MachineRelays.redial), so it never changes under it.
 */
class MachineChannel {
  /** The pages the machine was told of, so that one gone is told too. */
  private readonly told = new Set<number>();
  /** The pages an agent on the machine is acting in now: each `busy` balanced by its end. */
  private readonly busy = new Map<
    number,
    { action: BuiltinBrowserAction; sessionId: string | undefined }
  >();
  private runtime: BrowserBackendRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(
    private readonly machineId: string,
    private readonly socket: WebSocket,
    private readonly deps: ChannelDeps,
  ) {
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary) void this.receive(textOf(data));
    });
    socket.on("close", () => this.teardown());
    socket.on("error", (err) =>
      deps.log(`hub browser: the channel to machine ${machineId} failed: ${err.message}`),
    );
  }

  onClose(listener: () => void): void {
    if (this.closed) listener();
    else this.closeListeners.add(listener);
  }

  close(code: number, reason: string): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // Already closing.
    }
    this.teardown();
  }

  /** One frame from the machine. Never throws: what fails is answered or logged. */
  private async receive(text: string): Promise<void> {
    let message: { type?: unknown; id?: unknown; command?: unknown };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (message.type !== "desktop-browser-command" || typeof message.id !== "string") return;
    const id = message.id;
    const command = message.command as DesktopBrowserCommand | undefined;
    if (typeof command !== "object" || command === null || typeof command.op !== "string") {
      return this.reply(id, false, undefined, "bad_command");
    }
    try {
      this.reply(id, true, await this.carryOut(command));
    } catch (err) {
      this.reply(id, false, undefined, refusalOf(err));
    }
  }

  private async carryOut(command: DesktopBrowserCommand): Promise<unknown> {
    const admin = this.deps.admin;
    switch (command.op) {
      case "hello":
        return { version: 1, backend: this.deps.browser.backendOf(admin), hub: true };
      case "ping":
        return {};
      case "tabs": {
        const tabs = this.browser()
          .tabs.list()
          .filter((tab) => this.holds(tab));
        for (const tab of tabs) this.told.add(tab.id);
        return { tabs };
      }
      case "open-tab": {
        const { sessionId, projectId } = command;
        if (sessionId === undefined || projectId === undefined || !this.deps.uses(projectId)) {
          throw new BrowserLinkError("refused", "no_such_session");
        }
        const tab = await this.deps.browser.openTab(admin, {
          url: command.url,
          sessionId,
          projectId,
          machineId: this.machineId,
          activate: command.activate,
        });
        this.told.add(tab.id);
        return { tab };
      }
      case "close-tab": {
        const tab = this.page(command.tabId);
        await this.browser().close(String(tab.id), tab.sessionId);
        return {};
      }
      case "activate-tab": {
        const tab = this.page(command.tabId);
        await this.browser().activate(String(tab.id), tab.sessionId);
        return {};
      }
      case "cdp": {
        this.page(command.tabId);
        if (refusedOutsideOwnStore(command.method)) {
          throw new BrowserLinkError("refused", "cdp_refused");
        }
        if (command.method === "Page.navigate") {
          try {
            browserUrl(command.params?.url, false);
          } catch {
            throw new BrowserLinkError("refused", "bad_url");
          }
        }
        const events = command.events?.filter(relayedEvent);
        return this.browser().relay(
          { ...command, ...(events !== undefined ? { events } : {}) },
          RELAY_TIMEOUT_MS,
        );
      }
      case "activity": {
        const tab = this.page(command.tabId);
        const runtime = this.browser();
        const was = this.busy.get(tab.id);
        if (command.busy && was === undefined) {
          this.busy.set(tab.id, { action: command.action, sessionId: tab.sessionId });
          runtime.machineActivity(tab.id, command.action, tab.sessionId, true);
        } else if (!command.busy && was !== undefined) {
          this.busy.delete(tab.id);
          runtime.machineActivity(tab.id, was.action, was.sessionId, false);
        }
        return {};
      }
      default:
        // Cookies, data and throttling are this server's own: a machine has no say in them.
        throw new BrowserLinkError("refused", "unknown_op");
    }
  }

  /** The browser the channel carries out commands in, events subscribed on first use. */
  private browser(): BrowserBackendRuntime {
    if (this.runtime === null) {
      const runtime = this.deps.browser.relayRuntime(this.deps.admin);
      this.runtime = runtime;
      const events = runtime.link.onEvent((event) => this.forward(event));
      // A page becoming this machine's is no event of the shell's: the runtime says so itself.
      const owned = runtime.onMachineTab((tab) => {
        if (this.closed || !this.holds(tab)) return;
        this.told.add(tab.id);
        this.send({ kind: "tab", tab });
      });
      this.unsubscribe = () => {
        events();
        owned();
      };
    }
    return this.runtime;
  }

  /** Whether a page here is held for this machine. */
  private holds(tab: BuiltinBrowserTab | undefined): tab is BuiltinBrowserTab {
    return tab !== undefined && tab.machineId === this.machineId && tab.sessionId !== undefined;
  }

  /** The page a command names, which must be one held for this machine. */
  private page(tabId: number): BuiltinBrowserTab {
    const tab = this.browser().tabs.get(tabId);
    if (!this.holds(tab)) throw new BrowserLinkError("refused", "no_such_tab");
    return tab;
  }

  /** One event of the browser, sent on when it is about a page held for this machine. */
  private forward(event: DesktopBrowserEvent): void {
    if (this.closed) return;
    const runtime = this.runtime;
    if (runtime === null) return;
    switch (event.kind) {
      case "tab": {
        // The registry has applied it already (its listener runs first): read its owner there.
        const tab = runtime.tabs.get(event.tab.id);
        if (!this.holds(tab)) return;
        this.told.add(tab.id);
        return this.send({ kind: "tab", tab });
      }
      case "tab-closed":
      case "tab-released":
        if (!this.told.delete(event.tabId)) return;
        this.endActivity(event.tabId);
        return this.send(event);
      case "tab-crashed":
        if (!this.told.has(event.tabId)) return;
        return this.send(event);
      case "cdp-event":
        if (!this.told.has(event.tabId) || !relayedEvent(event.method)) return;
        return this.send(event);
      default:
        // Popups become tabs here (open-request), and the load is this server's to watch.
        return;
    }
  }

  private send(event: DesktopBrowserEvent): void {
    try {
      this.socket.send(JSON.stringify({ type: "desktop-browser-event", event }));
    } catch {
      // The socket is closing; its close ends the channel.
    }
  }

  private reply(id: string, ok: boolean, result?: unknown, error?: string): void {
    try {
      this.socket.send(
        JSON.stringify({
          type: "desktop-browser-reply",
          id,
          ok,
          ...(result !== undefined ? { result } : {}),
          ...(error !== undefined ? { error } : {}),
        }),
      );
    } catch {
      // The socket is closing; the machine fails what waits on it.
    }
  }

  private endActivity(tabId: number): void {
    const was = this.busy.get(tabId);
    if (was === undefined) return;
    this.busy.delete(tabId);
    this.runtime?.machineActivity(tabId, was.action, was.sessionId, false);
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const tabId of [...this.busy.keys()]) this.endActivity(tabId);
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const listener of this.closeListeners) {
      try {
        listener();
      } catch {
        // A listener's failure does not keep the channel open.
      }
    }
    this.closeListeners.clear();
  }
}

/**
 * A failure as the machine's link reads it (driver.ts mapLinkError): the far side's own words
 * for a page gone or crashed, `unavailable:<reason>` for a browser that cannot be driven here.
 */
function refusalOf(err: unknown): string {
  if (err instanceof BrowserLinkError) return err.message;
  if (err instanceof BrowserUnavailableError) return `unavailable:${err.reason}`;
  if (isHttpError(err)) {
    if (err.code === "no_such_tab" || err.code === "no_tab") return "no_such_tab";
    if (err.code === "tab_crashed" || err.code === "tab_released") return err.code;
    if (err.code === "invalid_url") return "bad_url";
    return err.message;
  }
  return messageOf(err);
}
