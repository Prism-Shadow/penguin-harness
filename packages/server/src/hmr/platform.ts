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
import { buildAppDeps, createApp, type AppDeps, type BuildDepsOverrides } from "../app.js";
import { seamHttp } from "./hono-seam.js";
import {
  PENGUIN_FAMILY,
  RESOURCE_IFACES_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "./capabilities.js";
import type { Interfaces, MembersOf } from "./capabilities.js";

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
export type PlatformCtx = { motd: string; terminals?: string[] };

export const PlatformIface = defineIface<PlatformApi, PlatformCtx>({
  name: "platform",
  version: 1,
  context: schema<PlatformCtx>(type({ motd: "string", "terminals?": "string[]" })),
  methods: ["park", "info", "http", "terminals", "attachStream"],
});

/**
 * The resource interfaces this platform parks, by ID-prefix group (see
 * RESOURCE_IFACES_RESOURCE_ID in ./capabilities.ts): create() integrates a group its
 * predecessor declared only at the same family AND version, and hard-stops it otherwise.
 * `terminal` is the spawn primitive — a live pty behind a deliberately stable contract,
 * expected to stay at v1 across upgrades that change everything else; `platform` is the
 * current-App pointer. A platform that does not want to inherit any of penguin's parked
 * resources declares a different `family` instead of arguing with each version.
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
    // once this App is fully built. Everything between can still throw (plugin handlers,
    // workflow factories, the scheduler), and a boot that fails there is recovered by
    // re-booting the previous bundle; that recovery is only honest if the resources it
    // re-adopts are still alive.
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

    const terminals = new TerminalManager(ctx.resources, {
      // A pushed bundle's node-pty binaries live where the host materialized them.
      assets: () => caps?.hmr.assetsDir() ?? null,
    });
    // Shells started before this instance existed are still running in the registry: claim
    // them back so a push is invisible to whoever was typing in one — unless their group
    // is doomed, in which case this build cannot speak the contract behind those handles
    // and must not adopt them. It does not dispose them either: that happens at the
    // commit below, so a failed boot leaves them for the recovered predecessor.
    terminals.adopt(doomedGroups.includes("terminal") ? [] : (context.terminals ?? []));
    // Ordinary code over the claimed capability (see terminal/identity.ts): the resolver
    // wraps caps.authService, the same object the business routes authenticate with. A
    // bare kernel has no auth — terminals stay fail-closed there.
    const identity = identityFrom(caps?.authService ?? null);

    // The business deps, built per App over the runtime's published capabilities — see
    // app.ts's buildAppDeps and ./capabilities.ts. Null only for a declared bare kernel;
    // every other capability-less host was refused above.
    let deps: AppDeps | null = null;
    if (caps === null) {
      console.warn("[platform] bare kernel: terminals only, no business surface");
    } else {
      deps = buildAppDeps(caps, caps.overrides);
      // Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic
      // scan; only active while this App is.
      await deps.scheduler.start();
      // Feishu bridge: connect every enabled Session binding (long-connection event
      // streams); only active while this App is, like the scheduler.
      await deps.feishu.start();
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
    //   - runtime singletons  db / auth / channels / config / proxy / desktop —
    //                         runtime-owned, re-claimed by every App; not this App's to park
    // SUSPENDED (stopped here; the successor rebuilds it fresh at load):
    //   - scheduler           stop() now; successor start() reconciles missed fires
    //   - feishu bridge       stop() closes the long connections; successor start()
    //                         reconnects every enabled binding from the DB
    //   - agent runs          approvals → deny, drives → abort; goal rows reconciled by
    //                         the successor's abortOrphanedActive
    //   - session environments dispose() after the drive settles — kills background
    //                         commands (dev servers etc.) that would otherwise run on
    //                         orphaned and invisible to the successor's fresh Session
    //   - reap timers         TerminalManager.quiesce runs them now (dead ptys only)
    // DETACHED (the object survives, this App's grip on it does not):
    //   - pty exit listeners  unsubscribed, so a dead generation never releases a
    //                         registry id the successor owns
    // Known exceptions, accepted with reasons: an in-flight self-update child (rare,
    // bounded by its own 10-minute cap, and a successful update restarts the process
    // anyway) and SSE subscriber closures (they serve the old generation's stream until
    // the client reloads on web_updated — the channel hub itself is runtime-owned).
    // A build that adds a service with state of its own (sandbox settings, workflow
    // refs, ssh tunnels, an in-flight job) adds it to the right list here — the list is
    // the contract, not a description of today's services.
    //
    // The synchronous part runs here; the ASYNC part (waiting for aborted runs to
    // actually end) cannot — dispose is sync — so it is exposed as api.drained(), which
    // the KERNEL awaits between dispose and the successor's boot (kernel/upgrade.ts).
    // Nothing about the handover touches the registry.
    let drained: Promise<void> | undefined;
    ctx.effect(() => {
      terminals.quiesce();
      const drains: Promise<unknown>[] = [];
      if (business !== null) {
        business.scheduler.stop();
        business.feishu.stop();
        drains.push(business.manager.shutdown(DRAIN_GRACE_MS));
      }
      drained = Promise.allSettled(drains).then(() => undefined);
    });

    // COMMIT: from here the App is built and nothing below throws, so the irreversible
    // half of the resource reconciliation runs — the groups this build cannot speak for
    // are disposed, and the declaration is overwritten (never released — see the ID's
    // doc) so the NEXT App reads this build's.
    for (const group of doomedGroups) ctx.resources.disposeGroup?.(group);
    ctx.resources.register(RESOURCE_IFACES_RESOURCE_ID, DECLARED_RESOURCES);

    const http = seamHttp(app);

    return {
      // Deliberately NOT disposing the terminals here (no ctx.effect): the shells are
      // resources, and outliving a swap is the whole point. Process exit sweeps them
      // through the registry's own disposers.
      park: () => ({ motd: context.motd, terminals: terminals.handleIds() }),
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
