/**
 * Runtime helpers over the sandbox vocabulary, plus a re-export of it.
 *
 * The vocabulary itself is `@prismshadow/penguin-core/extension` — a backend compiles
 * against those names, so they belong with the rest of the extension contract rather than
 * inside the harness that routes them. What stays here is the code that READS those
 * shapes, which is the embedder's business and must not become a runtime dependency of
 * every extension package.
 */
import type {
  SandboxDimension,
  SandboxProvider,
  SandboxSettings,
} from "@prismshadow/penguin-core/extension";

export type {
  ConfinedArgv,
  ConfinedSandboxMode,
  RunnerFailureRule,
  SandboxControl,
  SandboxDimension,
  SandboxEnforcement,
  SandboxMode,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderRegistry,
  SandboxProviderSource,
  SandboxSettings,
} from "@prismshadow/penguin-core/extension";

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
