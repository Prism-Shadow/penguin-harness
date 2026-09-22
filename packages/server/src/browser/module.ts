/**
 * The Browser as a node of the platform tree: the sites it has minted, the way its requests
 * leave this server, its API group on the App, and the hosts it answers on its own.
 *
 * Platform layer end to end. The isolation is a HOST (`<label>.localhost`), which a request
 * carries in its headers and HttpModule dispatches on before anything of the App's runs —
 * no listener, no port and no route of the runtime's is added, so a hot push delivers the
 * whole feature. A WebSocket on a Browser host reaches it through the runtime's upgrade
 * seam (terminal/ws.ts offers every upgrade to the platform first) and is tunnelled
 * (upgrade.ts).
 */
import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { Bind, Module, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { Clock, Config, Db, Log } from "../hmr/capabilities.js";
import { Machines } from "../machines/service.js";
import { Settings } from "../mechanisms/settings.js";
import { HttpFetch } from "../services/update-check-service.js";
import { BrowserEgress } from "./egress.js";
import { browserApiRoutes, browserHostApp } from "./routes.js";
import { browserHostUpgrade } from "./upgrade.js";
import type { HostApp } from "../http/app.js";
import { BrowserSitesRepo } from "./sites.js";

const PROXY_ENV = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"] as const;

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "BrowserModule.routes",
        prefix: "/api/browser",
        auth: "user",
        order: 53,
      },
    ],
    "HttpModule.hosts": [
      {
        id: "BrowserModule.hosts",
        // address.ts BROWSER_HOST_PATTERN — the manifest is data, read statically.
        pattern: "^[a-z2-7]{26}\\.localhost$",
      },
    ],
  },
})
export class BrowserModule {
  @Use() private readonly db!: Db;
  @Use() private readonly config!: Config;
  @Use() private readonly clock!: Clock;
  @Use() private readonly settings!: Settings;
  @Use() private readonly machines!: Machines;
  @Use() private readonly http!: HttpFetch;
  @Use() private readonly log!: Log;
  @Bind("BrowserModule.routes") routes!: Hono<AppEnv>;
  @Bind("BrowserModule.hosts") hostApp!: HostApp;
  setup({ effect }: ClassCtx) {
    const sites = new BrowserSitesRepo(this.db as unknown as DatabaseSync, () => this.clock.now());
    const egress = new BrowserEgress({
      dialPort: (machineId, remotePort) => this.machines.dialPort(machineId, remotePort),
      ownPort: () => this.config.port,
      // The same reading net/proxy.ts makes of the same settings: the app switch, then an
      // explicit address or the environment's.
      proxied: () =>
        this.settings.getProxyForApp() &&
        (this.settings.getProxyUrl() !== null ||
          PROXY_ENV.some((name) => (process.env[name] ?? "") !== "")),
      fetch: (input, init) => this.http.fetch(input, init),
    });
    this.routes = browserApiRoutes({
      sites,
      knowsMachine: (machineId) => this.machines.knows(machineId),
      port: () => this.config.port,
    });
    this.hostApp = {
      app: browserHostApp({ sites, egress }),
      upgrade: browserHostUpgrade({ sites, egress, log: (line) => this.log.line(line) }),
    };
    effect(() => egress.close());
  }
}
