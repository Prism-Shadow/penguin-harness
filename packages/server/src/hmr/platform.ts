/**
 * THE platform: the one hot-swappable unit this build of the server packages.
 *
 * The repo carries exactly one platform — versions exist BETWEEN deployments
 * (this packaged build vs the next bundle pushed over HTTP), not as parallel
 * files. When a future build changes the context shape, it bumps `version`
 * and ships the migrator alongside the new schema; the previous shape lives
 * only in already-parked documents out in the world.
 *
 * PLATFORM LAYER — WHERE POLICY BELONGS. Anything a deployment might want to
 * change (business APIs, what an agent sees, how a capability behaves) goes
 * here rather than in the runtime, and reaches installations by one HTTP push
 * instead of a rebuild. Worth remembering when something looks like it must
 * live in the shell: this code runs INSIDE the server process, so in-process
 * effects (e.g. extending process.env for the shells agents spawn) are
 * deliverable from boot() with no runtime change. See ../hmr/README.md.
 *
 * This packaged platform carries the WHOLE business surface (see app.ts):
 * every business service and route is assembled inside create() over the runtime's
 * published capabilities, and serves through the seam in ../hmr/http-seam.ts — it
 * sees every request before the runtime's own routes do and answers null for the
 * ones it does not own. A pushed bundle therefore replaces the business wholesale:
 * adding or changing an endpoint or a service needs no runtime change.
 */
import type { WebSocket } from "ws";
import type { Impl, Json, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, schema, type } from "@prismshadow/penguin-core/kernel";
import type { PlatformBundle } from "./host.js";
import { TerminalManager } from "../terminal/manager.js";
import type { TerminalSession } from "../terminal/session.js";
import { identityFrom } from "../terminal/identity.js";
import { bindTerminalStream } from "../terminal/stream.js";
import type {
  IfaceTable,
  ManifestTable,
  ModuleDef,
  ModuleTree,
} from "@prismshadow/penguin-core/kernel";
import { bootModules } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { terminalRoutes } from "../terminal/routes.js";
import type { Identity } from "../terminal/identity.js";
import { platformDef } from "../platform.js";
import { SandboxModule } from "../sandbox/service.js";
import { moduleDefOf } from "@prismshadow/penguin-core/kernel";
import ifaceTable from "../ifaces.json" with { type: "json" };
import { declined, seamHttp } from "./hono-seam.js";
import {
  PENGUIN_FAMILY,
  RESOURCE_IFACES_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "./capabilities.js";
import type { Interfaces, MembersOf } from "./capabilities.js";
import { pluginHostFrom } from "../plugin/host.js";

export interface PlatformApi extends Park {
  info(): Json;
  /**
   * The HTTP seam (hmr/http-seam.ts): every request is offered here first, and null
   * declines it to the runtime's own routes. This is how a business API ships by push
   * instead of by rebuilding and redeploying every installation.
   */
  http(request: Request): Promise<Response | null>;
  /**
   * In-process accessors for the one thing the seam cannot carry: a live socket. The
   * runtime's ws transport authenticates an upgrade, then asks for the session and hands
   * the socket back for the platform's protocol to drive.
   */
  terminals(): TerminalManager;
  attachStream(ws: WebSocket, session: TerminalSession, url: URL, log: (l: string) => void): void;
  /**
   * The module tree this App built (null on a declared bare kernel). In-process member,
   * NOT a registry entry: the runtime holds this instance already (hmr.ensure()), so a
   * "current App" pointer in the registry would be a duplicate channel.
   */
  business(): ModuleTree | null;
  /** Process-exit graceful drain (manager ≤5s wrap-up, workflow park); no-op without business. */
  shutdown(): Promise<void>;
  /**
   * The asynchronous tail of this App's dispose — set by the dispose effect, awaited by
   * the KERNEL between dispose and the successor's boot (see core kernel/upgrade.ts), so
   * a new App never races the old one's aborted work. Undefined until disposed.
   */
  drained(): Promise<void> | undefined;
}

/**
 * `terminals` is the linear-state half of this document: the pty processes themselves live
 * in the runtime's resource registry (they must — a swap disposes this tree), and the
 * document carries only their handle ids so the next instance can claim them back.
 */
/**
 * The platform node's parked document. It has ONE version and only grows: a field, once
 * written, keeps its meaning and stays written, so any platform ever pushed to a data
 * root can read the document the newest one parks — the rollback a hot update must never
 * lose. `terminals` and `sandbox` are what the first platforms parked and still read;
 * `modules` is what the module tree parks, one document per node. This platform writes
 * all three and reads `modules` first.
 */
export type PlatformCtx = {
  motd: string;
  /** pty handle ids (the terminal module's parked state, also written here for older readers). */
  terminals?: string[];
  /** Sandbox settings (the sandbox module's parked state, also written here for older readers). */
  sandbox?: Json;
  /** Each module's parked document, by node name (kernel bootModules). */
  modules?: Record<string, Json>;
};

export const PlatformIface = defineIface<PlatformApi, PlatformCtx>({
  name: "platform",
  version: 1,
  context: schema<PlatformCtx>(
    // arktype infers `unknown` for the index signature where the context says Json; the
    // runtime shape is the same, so the one cast lives here. Undeclared keys pass, so a
    // reader that predates a field is not stopped by it.
    type({
      motd: "string",
      "terminals?": "string[]",
      "sandbox?": "unknown",
      "modules?": { "[string]": "unknown" },
    }) as never,
  ),
  methods: ["park", "info", "http", "terminals", "attachStream"],
});

/** The node names the two parking modules were keyed by before nodes were named by class. */
const RENAMED_NODES: Record<string, string> = {
  terminal: "TerminalModule",
  sandbox: "SandboxModule",
};

/**
 * The module documents to boot from: what the last platform parked under `modules`
 * (older node names mapped to the current ones), completed from the top-level fields
 * when a platform older than the module tree parked them there.
 */
function parkedModules(context: PlatformCtx): Record<string, Json> {
  const modules: Record<string, Json> = {};
  for (const [key, value] of Object.entries(context.modules ?? {}))
    modules[RENAMED_NODES[key] ?? key] = value;
  if (modules.TerminalModule === undefined && context.terminals !== undefined)
    modules.TerminalModule = { v: 1, self: { terminals: context.terminals } };
  if (modules.SandboxModule === undefined && context.sandbox !== undefined)
    modules.SandboxModule = { v: 1, self: { settings: context.sandbox } };
  return modules;
}

/** A parking module's own state out of the tree's parked documents, for the top-level fields. */
function parkedSelf(modules: Record<string, Json>, node: string): Record<string, Json> | null {
  const doc = modules[node];
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const self = (doc as { self?: Json }).self;
  return self !== null && typeof self === "object" && !Array.isArray(self)
    ? (self as Record<string, Json>)
    : null;
}

/**
 * The resource interfaces this platform parks, by ID-prefix group (see
 * RESOURCE_IFACES_RESOURCE_ID in ./capabilities.ts): create() integrates a group its
 * predecessor declared only at the SAME version and hard-stops it otherwise. `terminal`
 * is the spawn primitive — a live pty behind a deliberately stable contract, expected to
 * stay at v1 across upgrades that change everything else; `platform` is the current-App
 * pointer.
 */
interface ParkedInterfaces extends Interfaces {
  family: string;
  terminal: MembersOf<TerminalSession>;
}

export const DECLARED_RESOURCES: ParkedInterfaces = {
  family: PENGUIN_FAMILY,
  // A parked pty, as its adopters use it — EVERY member reached after adoption, not a
  // representative sample: the manager (id, seq, ownerUserId, alive, info, onExit, kill,
  // dispose), the routes (capture, write, rename, exit) and the stream binding
  // (onOutput, resize, releaseSize, restoreStream). A short list would let a predecessor
  // satisfy the descriptor and still TypeError on the first keystroke after a swap,
  // which is exactly what this check exists to prevent.
  terminal: [
    "id",
    "seq",
    "ownerUserId",
    "alive",
    "exit",
    "info",
    "rename",
    "capture",
    "write",
    "resize",
    "releaseSize",
    "restoreStream",
    "onOutput",
    "onExit",
    "kill",
    "dispose",
  ],
};

/**
 * How long a swap or a process exit waits for aborted work to actually end (the kernel
 * awaits api.drained() between dispose and the successor's boot). A cap, not a sleep: the
 * drain resolves the moment the last aborted run settles.
 */
const DRAIN_GRACE_MS = 5000;

export const platformImpl: Impl<PlatformApi, PlatformCtx> = {
  async create(ctx, context) {
    // The claim comes FIRST, before a single registry read is acted on, and "refused" is a
    // throw — what each outcome means and why lives on RuntimeClaim (capabilities.ts).
    // The check sits HERE, in the bundle, because the runtime that needs it is by
    // definition too old to receive it; failing this early costs nothing — doUpgradeAll
    // rolls the whole upgrade back, and a hot upgrade cannot land what a fresh start
    // would refuse (bootAppDeps treats a business-less platform as fatal too).
    const claim = claimRuntimeCapabilities(ctx.resources);
    if (claim.kind === "refused") {
      throw new Error(
        `this runtime publishes no business capabilities this platform can claim ` +
          `(${claim.reason}) — update the installation itself; a push replaces the ` +
          `platform, never the runtime`,
      );
    }
    const caps = claim.kind === "claimed" ? claim.caps : null;
    // Resource-interface reconciliation, BEFORE anything is adopted: integrate the groups
    // the predecessor declared at the version this build also declares, hard-stop the
    // rest — a version bump or a dropped group means this create() does not speak the
    // contract behind those handles, and adopting them anyway is how a swap turns into a
    // TypeError. A predecessor from before the declaration existed reads as `{}`:
    // nothing provable, nothing disposed on its behalf (pre-declaration behavior).
    const inherited = ctx.resources.claim<Interfaces>(RESOURCE_IFACES_RESOURCE_ID);
    const inheritable = inherited !== undefined && inherited.family === DECLARED_RESOURCES.family;
    // DECIDE ONLY. Disposing a group kills live ptys and child processes, and nothing
    // brings them back — so the decision is computed here and ACTED ON at the bottom,
    // once this App is fully built. Everything between can still throw (a module's
    // create, a workflow factory), and a boot that fails there is recovered by re-booting
    // the previous bundle; that recovery is only honest if the resources it re-adopts are
    // still alive.
    const doomedGroups = Object.entries(inherited ?? {})
      .filter(([group]) => group !== "family")
      .filter(([group, offered]) => {
        // Wrong family, wrong version, or a group this build no longer declares: this
        // create() cannot speak the contract behind those handles.
        const need = DECLARED_RESOURCES[group];
        const offers =
          Array.isArray(need) && Array.isArray(offered) && need.every((m) => offered.includes(m));
        return !inheritable || !offers;
      })
      .map(([group]) => group);
    const adoptable = (group: string) => !doomedGroups.includes(group);

    // Plugins are modules (see ../plugin/): the host is CLAIMED from the registry,
    // never imported (see pluginHostFrom), and its modules join the tree below.
    const plugins = pluginHostFrom(ctx.resources);

    let tree: ModuleTree;
    let business: ModuleTree | null = null;
    let terminals: TerminalManager;
    if (caps === null) {
      // A declared bare kernel: terminals only, no business surface. The module tree is
      // reduced to what needs no runtime capability — the sandbox floor and the backends
      // registered into it — so confinement settings still park and restore.
      console.warn("[platform] bare kernel: terminals only, no business surface");
      terminals = new TerminalManager(ctx.resources, { assets: () => null });
      terminals.adopt(adoptable("TerminalModule") ? (context.terminals ?? []) : []);
      tree = await bootModules(bareTree([...plugins.modules()]), {
        ifaces: ifaceTable as unknown as IfaceTable,
        resources: ctx.resources,
        parked: parkedModules(context),
      });
    } else {
      // THE MODULE TREE (see ../platform.ts): every business service, every route
      // group and the terminal manager are modules wired by their manifests — checked as
      // data before any create() runs, created in dependency order. Sandbox backends the
      // plugin host registered enter the same tree as one contributing module.
      tree = await bootModules(platformDef(caps, adoptable, [...plugins.modules()]), {
        ifaces: ifaceTable as unknown as IfaceTable,
        resources: ctx.resources,
        parked: parkedModules(context),
      });
      business = tree;
      terminals = tree.api<TerminalManager>("TerminalModule", "terminals");
    }
    // Ordinary code over this App's own auth: the same object the business routes
    // authenticate with. A bare kernel has none — terminals stay fail-closed.
    const auth = business?.api<AuthService>("AuthService", "AuthService") ?? null;
    const identity = identityFrom(auth);
    const manager = business?.api<SessionManager>("SessionsModule", "manager") ?? null;
    // The runtime's one mid-request need of the CURRENT App is a hook installed over a
    // claimed capability — overwrite-only across swaps, so a dead generation's hook is
    // replaced and never removed: "is this session busy" for the channel sweep.
    if (caps !== null && manager !== null) {
      caps.channels.setActivityProbe((key) => manager.statusOf(key) !== "idle");
    }
    // PARK — the App's resource inventory, split by fate:
    //
    // DELIVERED (survives the swap; the successor adopts it at load):
    //   - pty sessions        registry `terminal:*` + the terminal module's parked ids
    //   - machine tunnels     ssh children + machines-connect.json (pid/port) → adopted by
    //                         the successor's tunnelPortFor, which checks the pid is alive
    //   - runtime singletons  db / auth-state / channels / config / proxy / desktop —
    //                         runtime-owned, re-claimed by every App
    // SUSPENDED (stopped here; the successor rebuilds it fresh at load):
    //   - scheduler, messaging bridge, machine connections   their modules' dispose effects
    //                         stop them; each successor's setup starts over from the record
    //   - agent runs          approvals → deny, drives → abort (manager.shutdown below)
    //   - session environments dispose() after the drive settles
    //   - reap timers         the terminal module's effect quiesces them
    // DETACHED (the object survives, this App's grip on it does not):
    //   - pty exit listeners  unsubscribed, so a dead generation never releases a
    //                         registry id the successor owns
    // Known exceptions, accepted with reasons: an in-flight self-update child (rare,
    // bounded by its own 10-minute cap, and a successful update restarts the process
    // anyway); an in-flight machines install (same shape — its ssh children run to their
    // own timeouts, the far side's installer stages-and-swaps or rolls back on its own,
    // and the progress log is simply lost, which re-running recovers); and SSE subscriber
    // closures (they serve the old generation's stream until the client reloads on
    // web_updated — the channel hub itself is runtime-owned).
    // A module with state of its own (sandbox settings, workflow refs, ssh tunnels, an
    // in-flight job) belongs in the right list here — the list is the contract, not a
    // description of today's modules.
    // The tree's dispose runs every module's effects in reverse creation order; the
    // asynchronous tail (waiting for aborted runs to end) cannot run inside a sync
    // effect, so it is exposed as api.drained(), which the KERNEL awaits between dispose
    // and the successor's boot (kernel/upgrade.ts). Nothing about the handover touches
    // the registry.
    let drained: Promise<void> | undefined;
    ctx.effect(() => {
      // Forwards to machines are DELIVERED, not suspended: the ssh children are separate
      // processes that keep forwarding across the swap, and the successor adopts them by the
      // pid recorded in web.db (machines/service.ts).
      const drains: Promise<unknown>[] = [];
      if (manager !== null) drains.push(manager.shutdown(DRAIN_GRACE_MS));
      tree.dispose();
      if (business === null) terminals.quiesce();
      drained = Promise.allSettled(drains).then(() => undefined);
    });

    // COMMIT: from here the App is built and nothing below throws, so the irreversible
    // half of the resource reconciliation runs — the groups this build cannot speak for
    // are disposed, and the declaration is overwritten (never released — see the ID's
    // doc) so the NEXT App reads this build's.
    for (const group of doomedGroups) ctx.resources.disposeGroup?.(group);
    ctx.resources.register(RESOURCE_IFACES_RESOURCE_ID, DECLARED_RESOURCES);

    const httpApi = business?.api<{ fetch(request: Request): Promise<Response> }>(
      "HttpModule",
      "http",
    );
    const http = httpApi !== undefined ? seamHttp(httpApi) : seamHttp(bareApp(terminals, identity));

    return {
      park: () => {
        const modules = tree.park();
        // The top-level fields are written for every platform that reads them: a bare
        // kernel's own ptys, and the two parking modules' state in the form the first
        // platforms parked it — so a rollback to any of them keeps terminals and confinement.
        const terminalIds =
          business === null
            ? terminals.handleIds()
            : (parkedSelf(modules, "TerminalModule")?.terminals as string[] | undefined);
        const sandbox = parkedSelf(modules, "SandboxModule")?.settings;
        return {
          motd: context.motd,
          modules,
          ...(terminalIds !== undefined ? { terminals: terminalIds } : {}),
          ...(sandbox !== undefined ? { sandbox } : {}),
        };
      },
      info: () => ({
        impl: "packaged",
        ifaceVersion: PlatformIface.version,
        motd: context.motd,
        terminals: terminals.handleIds().length,
      }),
      http,
      terminals: () => terminals,
      attachStream: (ws, session, url, log) => bindTerminalStream(ws, session, url, log),
      business: () => business,
      // Process exit wants the manager's graceful ≤5s drain, which a synchronous dispose
      // effect cannot await — exposed for index.ts's shutdown to call before disposing.
      shutdown: async () => {
        if (manager !== null) await manager.shutdown(DRAIN_GRACE_MS);
      },
      drained: () => drained,
    };
  },
};

/** A bare kernel's tree: the sandbox floor and whatever contributes to it, nothing that needs a capability. */
function bareTree(plugins: ModuleDef[]): ModuleDef {
  return {
    manifest: {
      name: "platform",
      requires: {},
      provides: {},
      contributes: {},
      children: ["SandboxModule", "*"],
    },
    children: [
      moduleDefOf(SandboxModule, { manifests: ifaceTable.modules as ManifestTable }),
      ...plugins,
    ],
    create: () => ({ api: {} }),
  };
}

/** The terminal-only surface of a declared bare kernel. */
function bareApp(terminals: TerminalManager, identity: Identity): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.notFound(() => declined());
  app.route("/", terminalRoutes(terminals, identity));
  return app;
}

/**
 * The packaged bundle the runtime boots when nothing has been pushed yet — code AND its
 * initial context together, so the runtime never hardcodes a business value of its own
 * (see hmr/host.ts's PlatformBundle: every bundle, packaged or pushed, carries `context`).
 */
export const packagedPlatform: PlatformBundle = {
  id: "packaged",
  iface: PlatformIface,
  impl: platformImpl,
  context: { motd: "hello from the penguin hot platform" } satisfies PlatformCtx,
};
