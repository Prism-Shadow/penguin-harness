/**
 * Port forwarding as a node of the platform tree: the service over this server's database
 * and the machines feature's held connections, and its route group.
 *
 * A platform-layer feature end to end — the listeners are opened by this process and the
 * dials ride the machine connection that already exists — so a hot push delivers it, and a
 * swap hands it over the way it hands over the machine connections: this generation closes
 * its listeners on the way out, and the successor's setup binds them again from the record.
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
    // Local binds only — no machine is spoken to until a client connects (service.ts).
    void forwards.start();
    effect(() => forwards.stop());
  }
}
