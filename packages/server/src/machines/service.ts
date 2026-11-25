/**
 * The machines service moved to the machines domain package
 * (@prismshadow/penguin-library-machine/service, machines restack S16) — it speaks library
 * vocabulary, and the pushed-build seam its image and upgrade effects need is this server's
 * own. This file keeps the assembly: the module binds the service to the server's
 * capabilities and re-exports the moved shapes for the server's own import paths.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { Access, Projects, ServerEvent } from "@prismshadow/penguin-library-project";
import type { Auth, Users } from "@prismshadow/penguin-library-auth";
import type { Traces } from "@prismshadow/penguin-library-trace";
import type { AppEnv } from "@prismshadow/penguin-library-http/app-env";
import type { Hono } from "hono";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";
import {
  MachineAnswers,
  MachineEventHub,
  MachineSockets,
  MachinesService,
  machineHistory,
  machinesServerProxyRoutes,
  traceCacheAt,
  type Machines,
} from "@prismshadow/penguin-library-machine/service";
import type { MachineSessionForward } from "@prismshadow/penguin-library-machine/session-forward";
import { machinesRoutes } from "@prismshadow/penguin-library-machine/routes";
import { machineSessionForward } from "@prismshadow/penguin-library-machine/session-forward";
import { SESSION_GROUP, attachSessionRegistry } from "@prismshadow/penguin-library-machine/transport";
import { deployPacker, findCheckout } from "@prismshadow/penguin-library-machine/checkout-image";
import { shippedImage } from "@prismshadow/penguin-library-machine/install-server";
import { readPushedBuild, writePushedBuild } from "../hmr/pushed-build.js";
import type { Channels, Db, Hmr, Paths, ResourceGroups } from "../hmr/capabilities.js";
import type { LiveStreams } from "../auth/live-streams.js";
import { streamRevocation } from "../http/sse.js";
import { userChannelKey } from "../http/routes/events.js";

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "MachinesModule.routes",
        prefix: "/api/projects/:projectId/machines",
        auth: "user",
        order: 50,
      },
      {
        id: "MachinesModule.server-proxy",
        // The manifest is data: the literal, not machines/proxy.ts's SERVER_PROXY_PREFIX,
        // which the generator reads statically and cannot follow.
        prefix: "/server/",
        auth: "user",
        order: 51,
      },
    ],
  },
})
export class MachinesModule {
  @Use() private readonly paths!: Paths;
  @Use() private readonly db!: Db;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly access!: Access;
  @Use() private readonly channels!: Channels;
  @Use() private readonly users!: Users;
  @Use() private readonly resourceGroups!: ResourceGroups;
  @Use() private readonly liveStreams!: LiveStreams;
  @Use() private readonly auth!: Auth;
  /** The Trace analysis the hub computes over its copy of a machine's file (history-routes.ts). */
  @Use() private readonly traces?: Traces;
  /** This server's Projects: an analysis is priced here only for a Project it has config for. */
  @Use() private readonly projects?: Projects;
  @Provide() machines!: Machines;
  /** Session-level requests for a machine's Session, routed by its id (session-forward.ts). */
  @Provide() sessionForward!: MachineSessionForward;
  @Bind("MachinesModule.routes") routes!: Hono<AppEnv>;
  @Bind("MachinesModule.server-proxy") serverProxyRoutes!: Hono<AppEnv>;
  setup({ effect }: ClassCtx) {
    // This machine's own id is minted on the first boot of this data root and stable ever
    // after — every stored reference to this machine, here and on the machines it reaches,
    // points at it. A test that supplies its own service mints none.
    const repo = new MachinesRepo(this.db as unknown as DatabaseSync);
    // The held ssh sessions a predecessor left in the registry are claimed back only when the
    // platform judged their contract this build's; this generation's are registered there too.
    attachSessionRegistry(this.hmr.resources, this.resourceGroups.adoptable(SESSION_GROUP));
    // A server running from a checkout builds the image its installs need (checkout-image.ts);
    // asked of this module's own file, which a packaged program or a pushed platform keeps
    // outside any checkout.
    const checkout = findCheckout(path.dirname(fileURLToPath(import.meta.url)));
    // The machines page and the proxy are admins' alone, so their events are too: told to every
    // admin with GET /api/events open (`peek`, never `get` — a channel opened here would be one
    // nobody listens on). Never throws: it runs in timers and ssh events as well as requests.
    const users = this.users;
    const channels = this.channels;
    const toAdmins = (event: ServerEvent) => {
      try {
        for (const user of users.list()) {
          if (user.isAdmin)
            channels.peek(userChannelKey(user.userId))?.publish(event, "server_event");
        }
      } catch {
        // Best effort: a page reads the list again on its next change or visit.
      }
    };
    // The generation's one socket cache and the event hub over it (PRFC-0011): the proxy's
    // streams and the machines' aggregate event stream share both, so the hub holds ONE
    // subscription per machine however many tabs read it.
    // A machine whose server answers HTTP and never the socket's handshake reads as needing a
    // restart on the Machines page: that reading arrives with the list, so its start and its end
    // are told like any other change to it. A dial that finds no socket also asks the service —
    // built next, so the reader is a closure — for one settle.
    let service: MachinesService | null = null;
    const sockets = new MachineSockets((line) => console.log(line), {
      announce: () => toAdmins({ type: "machines_changed" }),
      settle: (machineId) => service?.settleForStream(machineId) ?? null,
      // A socket is alive while its machine's link is: any byte on any connection to it.
      heardAt: (machineId) => service?.links.heardAt(machineId) ?? null,
      rateOf: (machineId) => service?.links.rate(machineId) ?? 0,
    });
    const events = new MachineEventHub(sockets, (line) => console.log(line));
    // The copy of the machines' Trace lines a remote conversation's history is read from
    // (trace-cache.ts): a cache under this data root, kept across generations and restarts.
    // One per directory for the whole process: generations share it (traceCacheAt).
    const historyCache = traceCacheAt(path.join(this.paths.root, "machines", "traces"));
    // The last answer of each machine read the proxy relayed, to revalidate (answer-cache.ts):
    // this generation's, in memory, as the sockets are.
    const answers = new MachineAnswers();
    const machines = new MachinesService(
      this.paths.root,
      repo.ownId(),
      repo,
      {
        ...(checkout === null ? {} : { packCheckout: deployPacker(checkout) }),
        // An installed release installs the image its build shipped, unless it was pushed to.
        shippedImage: shippedImage(),
        readBuild: readPushedBuild,
        writeBuild: writePushedBuild,
        socketFact: (machineId) => sockets.fact(machineId),
        announce: () => toAdmins({ type: "machines_changed" }),
        historyCache,
        answers,
      },
      () => this.hmr.assetsDir(),
    );
    service = machines;
    this.machines = machines;
    const { history, sync } = machineHistory({
      cache: historyCache,
      sockets,
      target: (machineId) => machines.proxyTarget(machineId),
      known: (machineId) => machines.knows(machineId),
      accessible: (userId, projectId, machineId) =>
        this.access.accessibleProjectIds(userId).includes(projectId) &&
        machines.usesMachine(projectId, machineId),
      heardAt: (machineId) => machines.links.heardAt(machineId),
      ...(this.traces !== undefined
        ? {
            analyze: (projectId: string, records: readonly AmspRecord[]) =>
              this.traces!.analyzeRecords(projectId, records),
          }
        : {}),
      ...(this.projects !== undefined
        ? { hasProject: (projectId: string) => this.projects!.findById(projectId) !== null }
        : {}),
      log: (line) => console.log(line),
    });
    this.routes = machinesRoutes({ machines, access: this.access, events });
    this.serverProxyRoutes = machinesServerProxyRoutes(machines, {
      sockets,
      events,
      history,
      answers,
      revocation: (c) =>
        streamRevocation(c, c.var.user, { liveStreams: this.liveStreams, auth: this.auth }),
    });
    this.sessionForward = machineSessionForward(
      machines,
      { sockets, events, history, answers },
      (line) => console.log(line),
    );
    // A Session deleted on its machine takes the hub's copy of it along (history-routes.ts).
    const untap = events.tap((machineId, data) => history.hear(machineId, data));
    // Every transient ssh session THIS generation opened closes with it, and every held one is
    // left for the successor, whose start() re-holds each one the record says was held.
    effect(() => {
      untap();
      machines.stop();
      sync.close();
      events.close();
      sockets.close();
    });
  }
}

export * from "@prismshadow/penguin-library-machine/service";
