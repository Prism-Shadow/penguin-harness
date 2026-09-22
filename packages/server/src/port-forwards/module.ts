/**
 * Port forwarding as a node of the platform tree: the service over this server's database
 * and the machines feature's held connections, and its route group.
 *
 * A platform-layer feature end to end — the forwards ride the machine session that already
 * exists — so a hot push delivers it, and a swap keeps every forward up: the session that
 * carries them is delivered to the successor (machines/transport/ssh-session.ts), and the
 * successor's setup only hands it the same wanted set again.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { Bind, Module, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { PortForwardsRepo } from "../db/repos/port-forwards.js";
import { Db } from "../hmr/capabilities.js";
import { Machines } from "../machines/service.js";
import { portForwardRoutes } from "./routes.js";
import { PortForwardService } from "./service.js";

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PortForwardsModule.routes",
        prefix: "/api/port-forwards",
        auth: "user",
        order: 52,
      },
    ],
  },
})
export class PortForwardsModule {
  @Use() private readonly db!: Db;
  @Use() private readonly machines!: Machines;
  @Bind("PortForwardsModule.routes") routes!: Hono<AppEnv>;
  setup({ effect }: ClassCtx) {
    const forwards = new PortForwardService(
      new PortForwardsRepo(this.db as unknown as DatabaseSync),
      this.machines,
    );
    this.routes = portForwardRoutes(forwards);
    // Each machine's wanted set, handed to its session — asked of ssh only where a session
    // is up; a machine that is down keeps it for later (service.ts).
    void forwards.start();
    effect(() => forwards.stop());
  }
}
