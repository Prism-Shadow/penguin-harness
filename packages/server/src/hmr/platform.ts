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
import type { PlatformBundle } from "../hmr/host.js";
import { TerminalManager } from "../terminal/manager.js";
import type { TerminalSession } from "../terminal/session.js";
import { identityFrom } from "../terminal/identity.js";
import { bindTerminalStream } from "../terminal/stream.js";
import type { SandboxProviderSource, SandboxSettings } from "../sandbox/index.js";
import { SandboxService } from "../sandbox/index.js";
import { buildAppDeps, createApp, type AppDeps, type BuildDepsOverrides } from "../app.js";
import { seamHttp } from "./hono-seam.js";
import {
  PENGUIN_FAMILY,
  PLATFORM_CURRENT_RESOURCE_ID,
  RESOURCE_IFACES_RESOURCE_ID,
  RUNTIME_OVERRIDES_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "./capabilities.js";
import type { Interfaces, MembersOf, PlatformCurrent } from "./capabilities.js";
import type { PenguinInterface, WorkflowFactory } from "./plugin.js";
import { instantiateWorkflows, pluginHostFrom } from "./plugin.js";

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
}

/**
 * `terminals` is the linear-state half of this document: the pty processes themselves live
 * in the runtime's resource registry (they must — a swap disposes this tree), and the
 * document carries only their handle ids so the next instance can claim them back.
 */
export type PlatformCtx = {
  motd: string;
  terminals?: string[];
  /**
   * Active sandbox settings — parked state, not service memory: a hot swap constructs a
   * fresh SandboxService, and without this the swap would silently reset a confining
   * deployment to unconfined. Optional so a document parked before the field existed
   * (and a default deployment, which never writes it) restores as confinement off.
   */
  sandbox?: SandboxSettings;
};

export const PlatformIface = defineIface<PlatformApi, PlatformCtx>({
  name: "platform",
  version: 1,
  context: schema<PlatformCtx>(
    type({
      motd: "string",
      "terminals?": "string[]",
      "sandbox?": {
        mode: "'read-only' | 'workspace-write' | 'danger-full-access'",
        "network?": "'none'",
        "maskPaths?": "string[]",
      },
    }),
  ),
  methods: ["park", "info", "http", "terminals", "attachStream"],
});

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
  platform: MembersOf<PlatformCurrent>;
}

export const DECLARED_RESOURCES: ParkedInterfaces = {
  family: PENGUIN_FAMILY,
  // A parked pty, as its adopter uses it (see TerminalManager.adopt).
  terminal: ["id", "info", "capture", "write", "alive", "dispose"],
  // The current-App pointer (see PlatformCurrent).
  platform: ["deps", "app"],
};

export const platformImpl: Impl<PlatformApi, PlatformCtx> = {
  async create(ctx, context) {
    // Resource-interface reconciliation, BEFORE anything is adopted: integrate the groups
    // the predecessor declared at the version this build also declares, hard-stop the
    // rest — a version bump or a dropped group means this create() does not speak the
    // contract behind those handles, and adopting them anyway is how a swap turns into a
    // TypeError. A predecessor from before the declaration existed reads as `{}`:
    // nothing provable, nothing disposed on its behalf (pre-declaration behavior).
    const inherited = ctx.resources.claim<Interfaces>(RESOURCE_IFACES_RESOURCE_ID);
    const inheritable = inherited !== undefined && inherited.family === DECLARED_RESOURCES.family;
    for (const [group, offered] of Object.entries(inherited ?? {})) {
      if (group === "family") continue;
      // Wrong family, wrong version, or a group this build no longer declares: this
      // create() cannot speak the contract behind those handles.
      const need = DECLARED_RESOURCES[group];
      const offers =
        Array.isArray(need) && Array.isArray(offered) && need.every((m) => offered.includes(m));
      if (!inheritable || !offers) ctx.resources.disposeGroup?.(group);
    }
    // Overwritten (never released — see the ID's doc) so the NEXT App reads this build's
    // declaration, whatever generation it is.
    ctx.resources.register(RESOURCE_IFACES_RESOURCE_ID, DECLARED_RESOURCES);

    const terminals = new TerminalManager(ctx.resources);
    // Shells started before this instance existed are still running in the registry: claim
    // them back so a push is invisible to whoever was typing in one.
    terminals.adopt(context.terminals ?? []);
    const identity = identityFrom(ctx.resources);
    // The plugin seam (see ./plugin.ts). Every App creation — the packaged boot and each
    // hot-swap boot alike — offers plugins the definition view first, then the assembled
    // instance context. Workflows are built here, after registration closes, so a plugin
    // that registers one always sees it instantiated in the same App it registered into.
    // The host itself comes from the registry: the runtime loaded whatever plugins.json
    // named once, at startup, and this claims that one host rather than importing another.
    const plugins = pluginHostFrom(ctx.resources);
    // Sandbox backends arrive as plugins through iface.sandbox (see ./plugin.ts);
    // duplicates are refused, and the service routes policies by capability.
    const sandboxProviders = new Map<string, SandboxProviderSource>();
    const pluginIface: PenguinInterface = {
      workflow: new Map<string, WorkflowFactory>(),
      tool: new Map(),
      sandbox: {
        registerProvider(name, provider) {
          if (sandboxProviders.has(name)) {
            throw new Error(`sandbox provider '${name}' is already registered`);
          }
          sandboxProviders.set(name, provider);
        },
      },
    };
    plugins.createApp(pluginIface);
    // "Which commands run confined, under which policy, by which backend" is policy —
    // the whole capability lives in ../sandbox/ and reaches deployed machines by push;
    // only core's spawn seam is mechanism. The confiner reaches core as a plain argument
    // to buildAppDeps below — same-generation wiring, because the sessions that spawn
    // through it are hard-stopped with this App (see the dispose effect), so nothing
    // outlives the service that confines it.
    const sandbox = new SandboxService(sandboxProviders);
    // Rehydrate the parked settings (state rides the swap): without this, every hot push
    // would construct a fresh service on defaults and silently un-confine a deployment
    // that had confinement on.
    if (context.sandbox !== undefined) sandbox.configure(context.sandbox);
    plugins.emit("create", {
      workflows: instantiateWorkflows(pluginIface.workflow),
      terminals,
      sandbox: {
        configure: (settings) => sandbox.configure(settings),
        settings: () => sandbox.currentSettings(),
      },
    });

    // The business deps, built per App over the runtime's published capabilities — see
    // app.ts's buildAppDeps and ./capabilities.ts. A runtime that publishes nothing
    // (an older runtime, a bare kernel) gets a terminals-only platform rather than a
    // failed boot.
    let deps: AppDeps | null = null;
    const caps = claimRuntimeCapabilities(ctx.resources);
    if (caps === null) {
      console.warn("[platform] runtime publishes no business capabilities; terminals only");
    } else {
      const overrides = ctx.resources.claim<BuildDepsOverrides>(RUNTIME_OVERRIDES_RESOURCE_ID);
      deps = buildAppDeps(caps, overrides ?? {}, () => sandbox.confiner());
      // Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic
      // scan; only active while this App is.
      await deps.scheduler.start();
      // Goal mode runs only in SessionManager memory: a hard crash (SIGKILL, power loss)
      // can leave goal_state rows stuck `active` with no runner behind them — and so can
      // the previous App, whose manager a swap hard-aborts. Reconcile them to `aborted`
      // now — nothing is running in THIS App yet — so the chat banner never restores a
      // phantom "running" goal. GOAL.yaml on disk stays `active` as the resume point.
      deps.goalsRepo.abortOrphanedActive();
    }

    // ONE app, ONE pointer: every route this App serves — terminal group and business
    // groups — registers into a single Hono table, and the swap publishes deps + table +
    // wrap-up as a single registry write, so no reader can observe a half-swapped pair.
    const app = createApp(deps, terminals, identity);
    const business = deps;
    const current: PlatformCurrent = {
      deps,
      app,
      // Process exit wants the manager's graceful ≤5s drain, which a synchronous dispose
      // effect cannot await — carried on the pointer for index.ts's shutdown to call.
      ...(business === null ? {} : { shutdown: () => business.manager.shutdown(5000) }),
    };
    ctx.resources.register(PLATFORM_CURRENT_RESOURCE_ID, current);
    ctx.effect(() => {
      // Swap semantics for unparked state: HARD STOP. Pending approvals converge to
      // deny, active runs abort, the scheduler's timer dies with this App; the next
      // App rebuilds all of it. Only parked resources (terminals) ride across.
      if (business !== null) {
        business.scheduler.stop();
        void business.manager.shutdown(0);
      }
      ctx.resources.release(PLATFORM_CURRENT_RESOURCE_ID);
    });

    const http = seamHttp(app);

    return {
      // Deliberately NOT disposing the terminals here (no ctx.effect): the shells are
      // resources, and outliving a swap is the whole point. Process exit sweeps them
      // through the registry's own disposers.
      park: () => {
        // The sandbox field is omitted while settings are the pristine default: a
        // default deployment keeps parking what it always did, compatible with any
        // bundle's schema; once confinement is configured, pushing a sandbox-ignorant
        // bundle blocks rather than silently un-confining.
        const parkedSandbox = sandbox.parkedSettings();
        return {
          motd: context.motd,
          terminals: terminals.handleIds(),
          ...(parkedSandbox !== undefined ? { sandbox: parkedSandbox } : {}),
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
    };
  },
};

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
