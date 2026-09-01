/**
 * Runtime helpers over the sandbox vocabulary.
 *
 * The vocabulary itself is `@prismshadow/penguin-core/plugin` — a backend compiles
 * against those names, so they belong with the rest of the plugin contract rather than
 * inside the harness that routes them. What stays here is the code that READS those
 * shapes: which dimensions a provider covers and which a settings object requires, the two
 * questions service.ts routes on. That is the embedder's business, and keeping it out of
 * the contract is what stops it becoming a runtime dependency of every plugin package.
 */
import type {
  SandboxDimension,
  SandboxProvider,
  SandboxSettings,
} from "@prismshadow/penguin-core/plugin";

/** Every dimension, in the order error messages list them. */
export const SANDBOX_DIMENSIONS: readonly SandboxDimension[] = [
  "fs-write",
  "network",
  "mask-paths",
];

/** The dimensions a provider implements (absent declaration = filesystem only). */
export function providerDimensions(provider: SandboxProvider): readonly SandboxDimension[] {
  return provider.dimensions ?? ["fs-write"];
}

/** The dimensions a settings object actually requires. */
export function requestedDimensions(settings: SandboxSettings): SandboxDimension[] {
  const dims: SandboxDimension[] = ["fs-write"];
  if (settings.network !== undefined) dims.push("network");
  if (settings.maskPaths !== undefined && settings.maskPaths.length > 0) dims.push("mask-paths");
  return dims;
}
