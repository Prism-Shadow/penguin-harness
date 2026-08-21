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
  RESOURCE_IFACES_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "./capabilities.js";
import type { Interfaces, MembersOf } from "./capabilities.js";
import type { PenguinInterface, WorkflowFactory } from "./plugin.js";
import { pluginHostFrom } from "./plugin.js";
import { resolveRoot } from "@prismshadow/penguin-core";
import { machinesHttp } from "../machines/http.js";
import { machinesProxy } from "../machines/proxy.js";
import { MachinesService } from "../machines/service.js";
import type { ParkedConnect } from "../machines/service.js";
import { WorkflowRegistry } from "../workflows/registry.js";
import { WorkflowLifecycle } from "../workflows/service.js";
import { WorkflowStore } from "../workflows/store.js";
import type { WorkflowRef } from "../workflows/store.js";

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
   * The business deps this App built (null on a declared bare kernel). In-process member,
   * NOT a registry entry: the runtime holds this instance already (hmr.ensure()), so a
   * "current App" pointer in the registry would be a duplicate channel.
   */
  business(): AppDeps | null;
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
export type PlatformCtx = {
  motd: string;
  terminals?: string[];
  /**
   * The installations this App carries, as refs into the store (../workflows/store.ts).
   * Parked for the same reason terminal handle ids are: the scripts live in agent folders
   * and outlive every push, so the next App reloads exactly these rather than sweeping
   * the disk for whatever happens to be there.
   */
  workflows?: WorkflowRef[];
  /**
   * Active sandbox settings — parked state, not service memory: a hot swap constructs a
   * fresh SandboxService, and without this the swap would silently reset a confining
   * deployment to unconfined. Optional so a document parked before the field existed
   * (and a default deployment, which never writes it) restores as confinement off.
   */
  sandbox?: SandboxSettings;
  /**
   * A machine connect that was in flight when this App parked. Delivered rather than
   * suspended: a connect can spend minutes installing a Node runtime on the far side, and
   * a push must not throw that away. The successor re-runs it (every step is idempotent —
   * see MachinesService.park) with the parked log as its prefix. Omitted when no connect
   * is running, which is the normal case, so an ordinary push keeps parking exactly the
   * document it always did.
   */
  connect?: ParkedConnect;
};

export const PlatformIface = defineIface<PlatformApi, PlatformCtx>({
  name: "platform",
  version: 1,
  context: schema<PlatformCtx>(
    type({
      motd: "string",
      "terminals?": "string[]",
      "workflows?": [{ projectId: "string", agentId: "string", workflowId: "string" }, "[]"],
      "sandbox?": {
        mode: "'read-only' | 'workspace-write' | 'danger-full-access'",
        "network?": "'none'",
        "maskPaths?": "string[]",
      },
      "connect?": {
        machineId: "string",
        "allowRestart?": "boolean",
        log: "string[]",
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

    const terminals = new TerminalManager(ctx.resources, {
      // A pushed bundle's node-pty binaries live where the host materialized them.
      assets: () => caps?.hmr.assetsDir() ?? null,
    });
    // Shells started before this instance existed are still running in the registry: claim
    // them back so a push is invisible to whoever was typing in one.
    terminals.adopt(context.terminals ?? []);
    // Ordinary code over the claimed capability (see terminal/identity.ts): the resolver
    // wraps caps.authService, the same object the business routes authenticate with. A
    // bare kernel has no auth — terminals stay fail-closed there.
    const identity = identityFrom(caps?.authService ?? null);
    // "Which machines can this window switch to, and how" is policy: the whole capability
    // (host list, probe, auto-install, tunnel) lives here and reaches deployed machines by
    // push. Tunnels it spawned before a swap are re-adopted through its state file, not
    // held objects, so a push does not strand one.
    const machinesRoot = process.env.PENGUIN_HOME ?? resolveRoot();
    const machines = new MachinesService(machinesRoot);
    const machinesRoutes = machinesHttp(machines, machinesRoot, {
      // The env var is how the shell marks the server it spawned; env is stable for the
      // process's lifetime, so a hot-pushed bundle reads the same answer as the packaged one.
      desktopMode: process.env.PENGUIN_DESKTOP_TOKEN !== undefined,
    });
    // `/server/<id>/api/…` — the same-origin proxy onto a connected machine's tunnel.
    const serverProxy = machinesProxy((id) => machines.tunnelPortFor(id));
    // A connect the previous App was running rides the document across and continues here
    // (see MachinesService.park/resume): the steps are idempotent, so the successor picks
    // it up where it stands rather than making the user start over after a push.
    if (context.connect !== undefined) machines.resume(context.connect);
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
    // The workflow store is anchored at the runtime's own root; a declared bare kernel has
    // no root to anchor at — the same absence that leaves this App terminals-only.
    // Installed workflows register into the very map plugins just wrote, so both kinds are
    // one thing downstream. Only the refs parked in this document are reloaded: an
    // installation is remembered, never discovered by sweeping agent folders.
    const runWorkflowAgent = caps?.overrides.runWorkflowAgent;
    const workflows = new WorkflowRegistry(pluginIface.workflow, (ref) => ({
      runAgent: async (prompt) => {
        if (runWorkflowAgent === undefined) {
          throw new Error("workflow runAgent is not configured");
        }
        return await runWorkflowAgent(ref.projectId, ref.agentId, prompt);
      },
    }));
    const workflowStore = caps === null ? null : new WorkflowStore(caps.config.root);
    // A workflow is live only while its agent is: the lifecycle registers on the agent's
    // first session and parks on its last. The refs this document carries say which
    // agents were live when the previous App parked, so a push is invisible to them.
    const workflowLifecycle =
      workflowStore === null ? null : new WorkflowLifecycle(workflowStore, workflows);
    if (workflowLifecycle !== null) {
      await workflowLifecycle.reseed(context.workflows ?? []);
    }
    plugins.emit("create", {
      workflows: workflows.instanceView(),
      terminals,
      sandbox: {
        configure: (settings) => sandbox.configure(settings),
        settings: () => sandbox.currentSettings(),
      },
    });

    // The business deps, built per App over the runtime's published capabilities — see
    // app.ts's buildAppDeps and ./capabilities.ts. Null only for a declared bare kernel;
    // every other capability-less host was refused above.
    let deps: AppDeps | null = null;
    if (caps === null) {
      console.warn("[platform] bare kernel: terminals only, no business surface");
    } else {
      deps = buildAppDeps(
        caps,
        caps.overrides,
        () => sandbox.confiner(),
        workflowLifecycle ?? undefined,
      );
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
    const app = createApp(
      deps,
      terminals,
      identity,
      workflowStore === null || caps === null
        ? undefined
        : { store: workflowStore, registry: workflows, lifecycle: workflowLifecycle! },
    );
    const business = deps;
    // The runtime's two mid-request needs of the CURRENT App are hooks installed over the
    // claimed capabilities — ordinary capability use, overwrite-only across swaps (a dead
    // generation's hook is replaced, never removed, so nothing ever un-installs a
    // successor's): "is this session busy" for channel sweep, and "what does a fresh user
    // get" for login provisioning.
    if (caps !== null && business !== null) {
      caps.channels.setActivityProbe((key) => business.manager.statusOf(key) !== "idle");
      caps.authService.setProvisioner((user, isAdmin) =>
        business.projectService.provisionInitialProject(user, isAdmin),
      );
    }
    // PARK — the App's complete resource inventory, split by fate. Everything stateful
    // this App creates is on one of these three lists; a new resource must pick its list
    // when it is added, or the swap leaks it.
    //
    // DELIVERED (survives the swap; the successor adopts it at load):
    //   - pty sessions        registry `terminal:*` + parked handle ids → terminals.adopt
    //   - ssh tunnels         OS processes + state file (pid, port)     → adoptedOrigin
    //   - sandbox settings    parked doc `sandbox`                      → sandbox.configure
    //   - workflow refs       parked doc `workflows`                    → lifecycle.reseed
    //   - in-flight connect   parked doc `connect` (machine, opts, log) → machines.resume
    //   - runtime singletons  db / auth / channels / config / proxy / desktop / plugins —
    //                         runtime-owned, re-claimed by every App; not this App's to park
    // SUSPENDED (stopped here; the successor rebuilds it fresh at load):
    //   - scheduler           stop() now; successor start() reconciles missed fires
    //   - agent runs          approvals → deny, drives → abort; goal rows reconciled by
    //                         the successor's abortOrphanedActive
    //   - session environments dispose() after the drive settles — kills background
    //                         commands (dev servers etc.) that would otherwise run on
    //                         orphaned and invisible to the successor's fresh Session
    //   - reap timers         TerminalManager.quiesce runs them now (dead ptys only)
    // DETACHED (the object survives, this App's grip on it does not):
    //   - pty exit listeners  unsubscribed, so a dead generation never releases a
    //                         registry id the successor owns
    //   - tunnel exit handlers silenced (detach), so they stop mutating the state file
    //                         the successor now adopts from
    // Known exceptions, accepted with reasons: an in-flight self-update child (rare,
    // bounded by its own 10-minute cap, and a successful update restarts the process
    // anyway) and SSE subscriber closures (they serve the old generation's stream until
    // the client reloads on web_updated — the channel hub itself is runtime-owned).
    // A build that adds a service with state of its own picks its list here — the list is
    // the contract, not a description of today's services.
    //
    // The synchronous part runs here; the ASYNC part (waiting for aborted runs to
    // actually end) cannot — dispose is sync — so it is exposed as api.drained(), which
    // the KERNEL awaits between dispose and the successor's boot (kernel/upgrade.ts).
    // Nothing about the handover touches the registry.
    let drained: Promise<void> | undefined;
    ctx.effect(() => {
      terminals.quiesce();
      // Detaches the tunnels (the connect it also parks was read by park() above).
      machines.park();
      const drains: Promise<unknown>[] = [];
      if (business !== null) {
        business.scheduler.stop();
        drains.push(business.manager.shutdown(DRAIN_GRACE_MS));
      }
      drained = Promise.allSettled(drains).then(() => undefined);
    });

    // The machines surface and the tunnel proxy answer the seam directly rather than as
    // Hono groups: the proxy streams a whole upstream response through, and neither takes
    // part in the business app's error shaping.
    const appHttp = seamHttp(app);
    const http = async (request: Request): Promise<Response | null> =>
      (await machinesRoutes(request)) ?? (await serverProxy(request)) ?? (await appHttp(request));

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
        const parkedWorkflows = workflowLifecycle?.refs() ?? [];
        // Omitted unless a connect is actually running: an ordinary push keeps parking
        // exactly the document it always did, which is what a connect-ignorant bundle can
        // still accept (the same rule the sandbox field follows).
        const parkedConnect = machines.park();
        return {
          motd: context.motd,
          terminals: terminals.handleIds(),
          ...(parkedWorkflows.length > 0 ? { workflows: parkedWorkflows } : {}),
          ...(parkedSandbox !== undefined ? { sandbox: parkedSandbox } : {}),
          ...(parkedConnect !== undefined ? { connect: parkedConnect } : {}),
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
        if (business !== null) await business.manager.shutdown(DRAIN_GRACE_MS);
        // After the manager drains: every activation the sessions held is released by
        // then, and this parks whatever an abandoned one still carries.
        await workflowLifecycle?.shutdown();
      },
      drained: () => drained,
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
