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
 * This packaged platform carries the WHOLE business surface (see ./business.ts):
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
import { TerminalManager } from "./terminal/manager.js";
import type { TerminalSession } from "./terminal/session.js";
import { terminalHttp } from "./terminal/routes.js";
import { identityFrom } from "./terminal/identity.js";
import { bindTerminalStream } from "./terminal/stream.js";
import type { BuildDepsOverrides } from "../app.js";
import { buildBusinessDeps, createBusinessApp } from "./business.js";
import { seamHttp } from "./hono-seam.js";
import {
  BUSINESS_DEPS_RESOURCE_ID,
  GRACEFUL_SHUTDOWN_RESOURCE_ID,
  RUNTIME_OVERRIDES_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "./capabilities.js";

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

export const platformImpl: Impl<PlatformApi, PlatformCtx> = {
  async create(ctx, context) {
    const terminals = new TerminalManager(ctx.resources);
    // Shells started before this instance existed are still running in the registry: claim
    // them back so a push is invisible to whoever was typing in one.
    terminals.adopt(context.terminals ?? []);
    const terminalHandler = terminalHttp(terminals, identityFrom(ctx.resources));

    // The business surface (services + routes), built per App over the runtime's
    // published capabilities — see ./business.ts for what it is and ./capabilities.ts for
    // what it stands on. A runtime that publishes nothing (an older runtime, a bare
    // kernel) gets a terminals-only platform rather than a failed boot.
    let businessHandler: ((request: Request) => Promise<Response | null>) | null = null;
    const caps = claimRuntimeCapabilities(ctx.resources);
    if (caps === null) {
      console.warn("[platform] runtime publishes no business capabilities; terminals only");
    } else {
      const overrides = ctx.resources.claim<BuildDepsOverrides>(RUNTIME_OVERRIDES_RESOURCE_ID);
      const deps = buildBusinessDeps(caps, overrides ?? {});
      // Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic
      // scan; only active while this App is.
      await deps.scheduler.start();
      // Goal mode runs only in SessionManager memory: a hard crash (SIGKILL, power loss)
      // can leave goal_state rows stuck `active` with no runner behind them — and so can
      // the previous App, whose manager a swap hard-aborts. Reconcile them to `aborted`
      // now — nothing is running in THIS App yet — so the chat banner never restores a
      // phantom "running" goal. GOAL.yaml on disk stays `active` as the resume point.
      deps.goalsRepo.abortOrphanedActive();
      ctx.resources.register(BUSINESS_DEPS_RESOURCE_ID, deps);
      // Process exit wants the manager's graceful ≤5s drain, which a synchronous dispose
      // effect cannot await — published separately for index.ts's shutdown to claim.
      ctx.resources.register(GRACEFUL_SHUTDOWN_RESOURCE_ID, () => deps.manager.shutdown(5000));
      ctx.effect(() => {
        // Swap semantics for unparked state: HARD STOP. Pending approvals converge to
        // deny, active runs abort, the scheduler's timer dies with this App; the next
        // App rebuilds all of it. Only parked resources (terminals) ride across.
        deps.scheduler.stop();
        void deps.manager.shutdown(0);
        ctx.resources.release(BUSINESS_DEPS_RESOURCE_ID);
        ctx.resources.release(GRACEFUL_SHUTDOWN_RESOURCE_ID);
      });
      businessHandler = seamHttp(createBusinessApp(deps));
    }

    const http = async (request: Request): Promise<Response | null> => {
      const own = await terminalHandler(request);
      if (own !== null) return own;
      return businessHandler === null ? null : businessHandler(request);
    };

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
