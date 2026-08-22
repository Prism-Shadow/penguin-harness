/**
 * The sandbox capability: the harness's own sandbox INTERFACE and the service that
 * routes policies to whatever backend implements them.
 *
 * PLATFORM-LAYER CODE living outside `platform/` on purpose: the folder tree follows
 * DOMAIN, the four-layer model (see ../hmr/README.md) follows OWNERSHIP, and the two
 * are not the same axis. This module is reached from platform.ts, so it rides the
 * platform bundle and a deployment changes it by one hot push.
 *
 * No backend is part of it. Backends are PLUGIN PACKAGES a deployment configures,
 * loaded from the installation by ../plugin/loader.ts — which is why nothing here
 * imports one, and why the harness does not depend on the DSH ecosystem at all:
 *
 *   sandbox service  ←  registered backends  ←  plugins.json
 *
 * The backends shipped in this repo, and what each implements:
 *
 *   plugin                            platform   fs-write  network  mask-paths
 *   penguin-plugin-sandbox-bwrap      Linux      yes       yes      yes
 *   penguin-plugin-sandbox-seatbelt   macOS      yes       yes      yes
 *   penguin-plugin-sandbox-mxc        Windows    yes       yes      yes
 *   penguin-plugin-sandbox-dsh        all three  yes       —        —
 *
 * The DSH adaptor is the portable floor (its own chain picks bwrap/Landlock, Seatbelt
 * or the Windows ACL runner per host) and covers file effects only; the three native
 * backends add the other two dimensions, one per platform — bubblewrap on Linux,
 * Seatbelt on macOS, and Microsoft MXC's processcontainer on Windows, which is the one
 * Windows mechanism that expresses all three.
 *
 * A deployment installs whichever it wants; where none implements a requested
 * dimension, service.ts fails closed and says which backend covers what, rather than
 * quietly confining less than was asked.
 */
export { SandboxService } from "./service.js";
export {
  SANDBOX_DIMENSIONS,
  providerDimensions,
  requestedDimensions,
  type ConfinedArgv,
  type ConfinedSandboxMode,
  type RunnerFailureRule,
  type SandboxDimension,
  type SandboxEnforcement,
  type SandboxMode,
  type SandboxPolicy,
  type SandboxProvider,
  type SandboxProviderSource,
  type SandboxSettings,
} from "./types.js";
