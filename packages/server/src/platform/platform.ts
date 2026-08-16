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
 * This packaged default is deliberately a bare stub: the runtime (HmrHost,
 * routes.ts) is mechanism only, and carries no business methods of its own.
 * A real business platform is pushed over HTTP and serves its own HTTP through
 * the seam in ../hmr/http-seam.ts: it sees every request before the runtime's
 * own routes do and answers null for the ones it does not own, so adding or
 * changing an endpoint needs no runtime change.
 */
import { resolveRoot } from "@prismshadow/penguin-core";
import type { Impl, Json, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, schema, type } from "@prismshadow/penguin-core/kernel";
import type { PlatformBundle } from "../hmr/host.js";
import { ensureCliOnPath } from "./agent-cli-path.js";
import { machinesHttp } from "./machines/http.js";
import { MachinesService } from "./machines/service.js";

export interface PlatformApi extends Park {
  info(): Json;
}

export type PlatformCtx = { motd: string };

export const PlatformIface = defineIface<PlatformApi, PlatformCtx>({
  name: "platform",
  version: 1,
  context: schema<PlatformCtx>(type({ motd: "string" })),
  methods: ["park", "info"],
});

export const platformImpl: Impl<PlatformApi, PlatformCtx> = {
  create(_ctx, context) {
    // "What PATH does the agent's shell see" is policy (see ../hmr/README.md), not
    // mechanism: it belongs here, in-process at platform boot, rather than in the
    // Electron shell that forks the server — that's what makes the fix reach
    // already-deployed machines via a normal hot push instead of a rebuild. Idempotent,
    // so re-running it on every create() (including hot swaps) is harmless.
    ensureCliOnPath();
    // "Which machines can this window switch to, and how" is policy of the same kind —
    // the earlier home for it was the Electron shell, which was the layer mistake this
    // README exists to prevent. Living here, the whole capability (host list, probe,
    // auto-install, tunnel) reaches deployed machines by push; tunnels it spawned before
    // a swap are re-adopted through the state file, not held objects.
    const machines = new MachinesService(process.env.PENGUIN_HOME ?? resolveRoot());
    const machinesRoutes = machinesHttp(machines, process.env.PENGUIN_HOME ?? resolveRoot(), {
      // The env var is how the shell marks the server it spawned; env is stable for the
      // process's lifetime, so a hot-pushed bundle reads the same answer as the packaged one.
      desktopMode: process.env.PENGUIN_DESKTOP_TOKEN !== undefined,
    });
    // `http` rides beside the iface methods (not IN them: a Request/Response pair is not
    // Json) — the seam calls it in-process on the booted object. See ../hmr/http-seam.ts.
    return {
      http: (request: Request) => machinesRoutes(request),
      park: () => ({ motd: context.motd }),
      info: () => ({
        impl: "packaged",
        ifaceVersion: PlatformIface.version,
        motd: context.motd,
      }),
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
