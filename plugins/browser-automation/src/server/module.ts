/**
 * The agent browser's server module, which the browser-automation plugin adds to the platform
 * tree: one group, two nodes.
 *
 * - `ProcessShellPort` answers which port reaches the desktop shell — Electron's
 *   `process.parentPort`, absent under a plain `penguin server|web` — and is the node a test
 *   replaces with a fake shell.
 * - `BuiltinBrowserRoutes` builds the generation's BuiltinBrowser — the built-in browser over
 *   that port, and the users' own Chromes through the extension hub — mounts the routes, and
 *   contributes the extension's WebSocket endpoint (`HttpModule.upgrades`, extension-ws.ts),
 *   which the runtime hands the upgrade to. The browser (and with it the port listener and
 *   every extension socket) is disposed with the App: a hot swap hands the port to the next
 *   generation's link, and the extensions reconnect to the next generation's hub (close 1012).
 * - It reaches the host only through the plugin face (`@prismshadow/penguin-server/plugin`), the
 *   API's types (`@prismshadow/penguin-server/api`), core and the library packages, all bundled
 *   into the plugin's dist (tsup.config.ts) but for the API's types, which are erased.
 *
 * Two names are kept for runtimes older than the WebSocket slot, which find the extension's gate
 * by name rather than by path: this module stays `BuiltinBrowserModule` and keeps exporting
 * `BrowserExtensionGate` with its `admit` / `connect` shape (until 1.0).
 *
 * The built-in browser's UI events go to every admin who has the event stream open (it is the
 * admins' tool, see routes.ts); a user's Chrome's go to that user. A channel nobody listens on
 * is not opened for them.
 */
import type { DatabaseSync } from "node:sqlite";
import pkg from "../../package.json" with { type: "json" };
import { Bind, Component, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Opaque } from "@prismshadow/penguin-core/plugin";
import type { Hono } from "hono";
import type {
  BrowserBackend,
  BuiltinBrowserServerEvent,
  UiPrefs,
} from "@prismshadow/penguin-server/api";
import { BrowserExtensionsRepo } from "@prismshadow/penguin-library-machine/browser-extensions";
import { readResourceLimit } from "@prismshadow/penguin-library-setting/resource-limits";
import { BROWSER_EXTENSIONS_KEY } from "@prismshadow/penguin-library-setting/repos/server-settings";
import { ensureInstallId, shellPortOf, userChannelKey } from "@prismshadow/penguin-server/plugin";
import type {
  AppEnv,
  Channels,
  Clock,
  Config,
  Db,
  Desktop,
  Log,
  Paths,
  SessionDrivers,
  SessionIndex,
  Settings,
  UiPrefsStore,
  Users,
  WebSocketUpgrade,
} from "@prismshadow/penguin-server/plugin";
import type { BrowserExtensionAdmission } from "./extension-hub.js";
import type { ExtensionSocket } from "./extension-link.js";
import { ExtensionPairing } from "./extension-pairing.js";
import { extensionUpgrade } from "./extension-ws.js";
import { builtinBrowserRoutes, extensionPairRoutes } from "./routes.js";
import { BuiltinBrowser } from "./service.js";
import type { BrowserShellPort } from "./shell-link.js";

/**
 * The version a paired extension is told it paired with: this package's, which a release sets with
 * every other package's (core's `VERSION`, what `buildInfo()` reports, among them) — a builtin
 * plugin is built and shipped with the platform it runs on. Read from core's root entry instead,
 * the bundle would carry the whole SDK.
 */
const SERVER_VERSION = pkg.version;

/** The desktop shell's message port as the built-in browser reaches it; null outside the shell. */
@Interface()
export abstract class BuiltinBrowserPort {
  abstract current(): Opaque<"BrowserShellPort", BrowserShellPort> | null;
}

/** The real port: the one Electron gives a utilityProcess. */
@Component()
export class ProcessShellPort implements BuiltinBrowserPort {
  current(): Opaque<"BrowserShellPort", BrowserShellPort> | null {
    return shellPortOf(process) as BrowserShellPort | null;
  }
}

/**
 * Where the extension's WebSocket hands its socket: it asks what the token may do before
 * upgrading (an unknown one is refused 401), then gives the live socket over. The contributed
 * endpoint uses it in-process; a runtime older than the WebSocket slot looks it up by this name
 * (`BuiltinBrowserModule` / `BrowserExtensionGate`) and does the handshake itself.
 */
@Interface()
export abstract class BrowserExtensionGate {
  abstract admit(token: string): BrowserExtensionAdmission;
  abstract connect(token: string, socket: Opaque<"ExtensionSocket", ExtensionSocket>): void;
}

/** The users' backend choice, kept in their ui_prefs (`browserBackend`). */
function backendPrefs(store: UiPrefsStore) {
  const read = (userId: string): UiPrefs => {
    const raw = store.get(userId);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as UiPrefs) : {};
    } catch {
      return {};
    }
  };
  return {
    get: (userId: string): BrowserBackend | null => {
      const chosen = read(userId).browserBackend;
      return chosen === "builtin" || chosen === "chrome" ? chosen : null;
    },
    set: (userId: string, backend: BrowserBackend): void => {
      store.set(userId, JSON.stringify({ ...read(userId), browserBackend: backend }));
    },
  };
}

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "BuiltinBrowserRoutes.routes",
        prefix: "/api/builtin-browser",
        auth: "user",
        order: 205,
      },
      {
        // In front of the cookie gate (the first gated group mounts at order 10): the
        // extension pairs with a code, not a session. It calls from its own
        // `chrome-extension://` origin, which the route admits itself (extensionPairRoutes):
        // the same-origin rule for writes is not this group's.
        id: "BuiltinBrowserRoutes.pair",
        prefix: "/api/builtin-browser/extension/pair",
        auth: "none",
        order: 7,
        origin: "own",
      },
    ],
    "HttpModule.upgrades": [
      {
        // The extension's own token (in the subprotocol) is the credential, and the handshake
        // admits only the extension's origin (extension-ws.ts): no session cookie is read.
        id: "BuiltinBrowserRoutes.extensionSocket",
        prefix: "/api/builtin-browser/extension/ws",
        auth: "none",
      },
    ],
    "MeRoutes.ownedPrefs": [
      {
        // Which browser the user's agents drive has its own route, which checks what the user
        // may choose, waits out an agent's action in flight, and tells their windows; a plain
        // prefs write would skip all three.
        id: "BuiltinBrowserRoutes.backendPref",
        key: "browserBackend",
        message:
          "browserBackend is chosen through PUT /api/builtin-browser/backend, not the prefs.",
      },
    ],
  },
})
export class BuiltinBrowserRoutes {
  @Use() private readonly port!: BuiltinBrowserPort;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly channels!: Channels;
  @Use() private readonly users!: Users;
  @Use() private readonly paths!: Paths;
  @Use() private readonly log!: Log;
  @Use() private readonly db!: Db;
  @Use() private readonly clock!: Clock;
  @Use() private readonly settings!: Settings;
  @Use() private readonly prefs!: UiPrefsStore;
  @Use() private readonly drivers!: SessionDrivers;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly config!: Config;
  @Provide() gate!: BrowserExtensionGate;
  @Bind("BuiltinBrowserRoutes.routes") routes!: Hono<AppEnv>;
  @Bind("BuiltinBrowserRoutes.pair") pairRoutes!: Hono<AppEnv>;
  @Bind("BuiltinBrowserRoutes.extensionSocket") extensionSocket!: WebSocketUpgrade;

  setup({ effect }: ClassCtx) {
    const users = this.users;
    const channels = this.channels;
    const log = this.log;
    const settings = this.settings;
    const drivers = this.drivers;
    const clock = this.clock;
    // Runs in the browser's timers, socket and shell events as well as in requests, so it never
    // throws: an exception there would be uncaught, and an uncaught exception ends the server.
    const publishTo = (userId: string, event: BuiltinBrowserServerEvent) => {
      try {
        channels.peek(userChannelKey(userId))?.publish(event, "server_event");
      } catch (err) {
        log.line(`builtin browser: a '${event.type}' event could not be sent: ${String(err)}`);
      }
    };
    // Only a server the shell spawned hosts the built-in browser: a desktop window attached to a
    // separately running server has no port into that server.
    const port = this.desktop.current() !== null ? this.port.current() : null;
    const store = new BrowserExtensionsRepo(this.db as unknown as DatabaseSync);
    const browser = new BuiltinBrowser({
      port,
      root: this.paths.root,
      maxOpen: () => readResourceLimit(settings, "browserMaxOpen"),
      projectOf: (sessionId) => this.sessions.findById(sessionId)?.projectId ?? null,
      publish: (event) => {
        try {
          for (const user of users.list()) if (user.isAdmin) publishTo(user.userId, event);
        } catch (err) {
          log.line(`builtin browser: a '${event.type}' event could not be sent: ${String(err)}`);
        }
      },
      log: (line) => log.line(line),
      chrome: {
        store,
        enabled: () => settings.getBrowserExtensionsEnabled(),
        publishTo,
      },
      prefs: backendPrefs(this.prefs),
    });
    const pairing = new ExtensionPairing({
      store,
      user: (userId) => {
        const user = users.findById(userId);
        return user === null ? null : { userId: user.userId, displayName: user.displayName };
      },
      installId: () => ensureInstallId(this.paths.root),
      serverVersion: SERVER_VERSION,
      now: () => clock.now().getTime(),
    });
    this.routes = builtinBrowserRoutes(browser, {
      // The human an agent's session acts for, as the browser knows people: by id and role.
      driverOf: (sessionId) => {
        const userId = drivers.driverOf(sessionId);
        const user = userId === null ? null : users.findById(userId);
        return user === null ? null : { userId: user.userId, isAdmin: user.isAdmin };
      },
      pairing,
      trustProxy: this.config.trustProxy,
    });
    this.pairRoutes = extensionPairRoutes(pairing);
    this.gate = {
      admit: (token) => browser.admit(token),
      connect: (token, socket) => browser.connect(token, socket as ExtensionSocket),
    };
    const gate = this.gate;
    this.extensionSocket = extensionUpgrade({ gate: () => gate, log: (line) => log.line(line) });
    // The admin's switch acts at once: off closes every connected Chrome (4009).
    const unwatch = settings.watch((key) => {
      if (key === BROWSER_EXTENSIONS_KEY && !settings.getBrowserExtensionsEnabled()) {
        browser.extensions?.closeAll();
      }
    });
    effect(() => {
      unwatch();
      browser.dispose();
    });
  }
}

/** The agent browser: the built-in one (desktop) and the users' own Chromes, their tabs, the agent's actions, import and history. */
@Module({
  children: [ProcessShellPort, BuiltinBrowserRoutes],
  exports: [BrowserExtensionGate],
})
export class BuiltinBrowserModule {}
