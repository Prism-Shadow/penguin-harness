/**
 * The built-in browser's place in the platform tree: one group, two nodes.
 *
 * - `ProcessShellPort` answers which port reaches the desktop shell — Electron's
 *   `process.parentPort`, absent under a plain `penguin server|web` — and is the node a test
 *   replaces with a fake shell.
 * - `BuiltinBrowserRoutes` builds the generation's BuiltinBrowser over it and mounts the routes.
 *   The browser (and with it the port listener) is disposed with the App, so a hot swap hands
 *   the port to the next generation's link rather than leaving two listening.
 *
 * UI events go to every admin who has the event stream open; the browser is the admin's tool
 * (see routes.ts), and a channel nobody listens on is not opened for it.
 */
import { Bind, Component, Interface, Module, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Opaque } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { Channels, Desktop, Log, Paths } from "../hmr/capabilities.js";
import { userChannelKey } from "../http/routes/events.js";
import type { Users } from "../mechanisms/identity.js";
import { shellPortOf } from "../services/desktop-update-port.js";
import { builtinBrowserRoutes } from "./routes.js";
import { BuiltinBrowser } from "./service.js";
import type { BrowserShellPort } from "./shell-link.js";

/** The desktop shell's message port as the built-in browser reaches it; null outside the shell. */
export abstract class BuiltinBrowserPort extends Interface<{
  current(): Opaque<"BrowserShellPort", BrowserShellPort> | null;
}>() {}

/** The real port: the one Electron gives a utilityProcess. */
@Component()
export class ProcessShellPort implements BuiltinBrowserPort {
  current(): Opaque<"BrowserShellPort", BrowserShellPort> | null {
    return shellPortOf(process) as BrowserShellPort | null;
  }
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "BuiltinBrowserRoutes.routes",
        prefix: "/api/builtin-browser",
        auth: "user",
        order: 205,
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
  @Bind("BuiltinBrowserRoutes.routes") routes!: Hono<AppEnv>;

  setup({ effect }: ClassCtx) {
    const users = this.users;
    const channels = this.channels;
    const log = this.log;
    // Only a server the shell spawned hosts the browser: a desktop window attached to a
    // separately running server has no port into that server.
    const port = this.desktop.current() !== null ? this.port.current() : null;
    const browser = new BuiltinBrowser({
      port,
      root: this.paths.root,
      publish: (event) => {
        for (const user of users.list()) {
          if (user.isAdmin)
            channels.peek(userChannelKey(user.userId))?.publish(event, "server_event");
        }
      },
      log: (line) => log.line(line),
    });
    this.routes = builtinBrowserRoutes(browser);
    effect(() => browser.dispose());
  }
}

/** The built-in browser (desktop only): the shell link, the tabs, the agent's actions, import and history. */
@Module({
  children: [ProcessShellPort, BuiltinBrowserRoutes],
  exports: [],
})
export class BuiltinBrowserModule {}
