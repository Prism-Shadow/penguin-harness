/**
 * THE platform: the one hot-swappable unit this build of the server packages.
 *
 * The repo carries exactly one platform — versions exist BETWEEN deployments
 * (this packaged build vs the next bundle pushed over HTTP), not as parallel
 * files. When a future build changes the context shape, it bumps `version`
 * and ships the migrator alongside the new schema; the previous shape lives
 * only in already-parked documents out in the world.
 *
 * This packaged default is deliberately a bare stub: the runtime (HmrHost,
 * routes.ts) is mechanism only, and carries no business methods of its own.
 * A real business platform is pushed over HTTP and dispatched through the
 * generic /api/hmr/platform/call route — the method set is data read off the
 * running iface, so adding or removing an API needs no runtime change.
 */
import type { Impl, Json, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, schema, type } from "@prismshadow/penguin-core/kernel";

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
    return {
      park: () => ({ motd: context.motd }),
      info: () => ({
        impl: "packaged",
        ifaceVersion: PlatformIface.version,
        motd: context.motd,
      }),
    };
  },
};

/** The packaged bundle the runtime boots when nothing has been pushed yet. */
export const packagedPlatform = { id: "packaged", iface: PlatformIface, impl: platformImpl };
