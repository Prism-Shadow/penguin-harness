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
  BARE_KERNEL_RESOURCE_ID,
  PENGUIN_FAMILY,
  PLATFORM_CURRENT_RESOURCE_ID,
  PLATFORM_DRAIN_RESOURCE_ID,
  RESOURCE_IFACES_RESOURCE_ID,
  RUNTIME_OVERRIDES_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "./capabilities.js";
import type { Interfaces, MembersOf, PlatformCurrent } from "./capabilities.js";

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
  platform: MembersOf<PlatformCurrent>;
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
  // The current-App pointer (see PlatformCurrent).
  platform: ["deps", "app"],
};

/**
 * How long a swap waits for aborted work to actually end (the successor awaits this via
 * PLATFORM_DRAIN_RESOURCE_ID). A cap, not a sleep: the drain resolves the moment the last
 * aborted run settles. Matches the process-exit grace, because "the old App is gone"
 * should mean the same thing on both paths.
 */
const SWAP_DRAIN_MS = 5000;

export const platformImpl: Impl<PlatformApi, PlatformCtx> = {
  async create(ctx, context) {
    // The capability claim comes FIRST, before a single registry read is acted on, and a
    // shortfall is a REFUSAL — not a degradation — unless the host declared itself a bare
    // kernel. A platform that cannot claim the capabilities can only serve terminals, and a
    // runtime old enough to publish none still answers the business API out of its own
    // routes: the seam would hand /api/me back to the OLD build while the SAME push's web
    // dist is already being served, so one atomic push lands as half a version and the
    // browser crashes on a field the older API does not carry. The runtime already treats
    // this as fatal when it starts (app.ts's bootAppDeps: "the packaged platform built no
    // business surface"); making it fatal here too means a hot upgrade cannot land what a
    // fresh start would refuse. It has to be HERE rather than in the runtime to be any use:
    // the check travels inside the bundle, so it also protects installations whose runtime
    // is already too old for any push to fix. Failing this early costs the operator nothing
    // beyond an error — doUpgradeAll rolls the whole upgrade back (old instance keeps
    // serving, the web is not committed, nothing is persisted). What it cannot undo is a
    // half version committed BEFORE this check existed: that bundle carries no check, so a
    // restart restores it degraded again — repairing such a machine means updating the
    // installation (the committed bundle then claims successfully and serves whole) or
    // clearing <root>/hmr/harness.json to fall back to the packaged default.
    const caps = claimRuntimeCapabilities(ctx.resources);
    if (caps === null && ctx.resources.claim(BARE_KERNEL_RESOURCE_ID) === undefined) {
      throw new Error(
        "this runtime publishes no business capabilities this platform can claim " +
          "(too old for the resource-interface handshake, or speaking different interfaces) " +
          "— update the installation itself; a push replaces the platform, never the runtime",
      );
    }
    // LOAD, step one: wait until the predecessor is actually gone. The kernel's park and
    // dispose are synchronous, but suspending a business surface is not — aborted agent
    // runs take real time to end. The previous App registered its drain on the way out
    // (see the dispose effect below); awaiting it here is what makes "the process is
    // clean" true before this App restarts the suspended machinery and adopts the
    // delivered resources. Absent on the first boot, after a process restart (the
    // registry is in-memory), and under a predecessor that predates the contract.
    const drain = ctx.resources.claim<Promise<unknown>>(PLATFORM_DRAIN_RESOURCE_ID);
    if (drain !== undefined) {
      await drain;
      // Released only AFTER it resolves: if this create() fails later, the (settled)
      // drain stays claimable, so the host's recovery boot of the previous version
      // consumes it and starts clean instead of finding nothing.
      ctx.resources.release(PLATFORM_DRAIN_RESOURCE_ID);
    }

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

    // The business deps, built per App over the runtime's published capabilities — see
    // app.ts's buildAppDeps and ./capabilities.ts. Null only for a declared bare kernel;
    // every other capability-less host was refused above.
    let deps: AppDeps | null = null;
    if (caps === null) {
      console.warn("[platform] bare kernel: terminals only, no business surface");
    } else {
      const overrides = ctx.resources.claim<BuildDepsOverrides>(RUNTIME_OVERRIDES_RESOURCE_ID);
      deps = buildAppDeps(caps, overrides ?? {});
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
    // actually end) cannot — dispose is sync — so it is registered as a promise the
    // successor's create() awaits before building: that handshake is what makes the
    // process clean between generations.
    ctx.effect(() => {
      terminals.quiesce();
      const drains: Promise<unknown>[] = [];
      if (business !== null) {
        business.scheduler.stop();
        drains.push(business.manager.shutdown(SWAP_DRAIN_MS));
      }
      ctx.resources.register(
        PLATFORM_DRAIN_RESOURCE_ID,
        Promise.allSettled(drains).then(() => undefined),
      );
      // Ownership-checked, because the registry does not pair register with release: both
      // are unconditional writes to a shared slot, so a naked release here would be
      // ordering-dependent — correct only while the kernel happens to dispose the old App
      // before booting the new one. If generations ever overlap (tests boot two live Apps
      // over one registry; recovery paths reorder things), an unconditional delete is a
      // dead generation releasing the successor's live pointer — the exact bug-class the
      // DETACHED list exists for. Releasing only what is provably ours makes the pair
      // real instead of positional.
      if (ctx.resources.claim(PLATFORM_CURRENT_RESOURCE_ID) === current) {
        ctx.resources.release(PLATFORM_CURRENT_RESOURCE_ID);
      }
    });

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
