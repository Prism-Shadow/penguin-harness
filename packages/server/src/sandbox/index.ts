/**
 * The sandbox capability: the harness's own sandbox INTERFACE and the service that
 * routes policies to whatever backend implements them. Reached from hmr/platform.ts,
 * so it rides the platform bundle — a deployment changes it by one hot push.
 *
 * No backend is part of it. Backends are PLUGIN PACKAGES a deployment configures
 * (../extension/loader.ts), which is why nothing here imports one and why the harness does
 * not depend on the DSH ecosystem at all:
 *
 *   sandbox service  ←  registered backends  ←  extensions.json
 *
 * The backends shipped in this repo:
 *
 *   extension                            platform   fs-write  network  mask-paths
 *   penguin-extension-sandbox-bwrap      Linux      yes       yes      yes
 *   penguin-extension-sandbox-seatbelt   macOS      yes       yes      yes
 *   penguin-extension-sandbox-mxc        Windows    yes       yes      yes
 *   penguin-extension-sandbox-dsh        all three  yes       —        —
 *
 * The DSH adaptor is the portable floor covering file effects only (its own chain picks
 * bwrap/Landlock, Seatbelt or the Windows ACL runner per host); the three native
 * backends add the other two dimensions, one per platform. Where none implements a
 * requested dimension, service.ts fails closed naming what each covers rather than
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
