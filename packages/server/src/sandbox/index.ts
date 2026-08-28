/**
 * The sandbox capability: the service that routes each spawn's policy to whatever backend
 * implements it. Reached from hmr/platform.ts, so it rides the platform bundle — a
 * deployment changes it by one hot push.
 *
 * The vocabulary it routes ON is not here. `SandboxPolicy`, `SandboxProvider`,
 * `ConfinedArgv` and the mode/dimension unions belong to the extension contract in
 * `@prismshadow/penguin-core/extension`, because a backend is written against those names
 * and nothing else. What this directory holds is the embedder's half: which policy reaches
 * which backend, the settings behind it, and the fail-closed behaviour when nothing covers
 * the request.
 *
 * No backend is part of it. Backends are EXTENSION PACKAGES a deployment configures
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
export { SANDBOX_DIMENSIONS, providerDimensions, requestedDimensions } from "./dimensions.js";
