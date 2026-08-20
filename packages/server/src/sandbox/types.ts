/**
 * The harness's OWN sandbox interface. DSH is one adaptor behind it, not the interface
 * itself — which is what lets `network` and `mask-paths` be built-in dimensions here,
 * implemented optionally by a backend.
 *
 * Confinement is argv rewriting and nothing else: a provider returns the argv the
 * caller should spawn instead of its own, and never executes anything itself.
 */

/**
 * File-effect mode. `read-only` permits only required sinks (e.g. /dev/null);
 * `workspace-write` also permits the workspace and a backend-defined temp area;
 * `danger-full-access` means confinement is off and no provider is consulted.
 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** A mode that actually confines — the modes a {@link SandboxPolicy} can carry. */
export type ConfinedSandboxMode = Exclude<SandboxMode, "danger-full-access">;

/**
 * The isolation dimensions of this interface. A provider declares the subset it
 * implements; `fs-write` is the floor every confining backend covers, while `network`
 * and `mask-paths` are optional implementations (see {@link SandboxProvider.dimensions}).
 */
export type SandboxDimension = "fs-write" | "network" | "mask-paths";

/** Every dimension, in the order error messages list them. */
export const SANDBOX_DIMENSIONS: readonly SandboxDimension[] = [
  "fs-write",
  "network",
  "mask-paths",
];

/**
 * What one confined execution is allowed to touch — carried PER CALL, not fixed on the
 * provider. The optional members are the optional dimensions: present means the policy
 * REQUIRES that dimension, and the service only routes such a policy to a provider that
 * implements it (never silently dropped).
 */
export interface SandboxPolicy {
  /** The file-effect mode this execution runs under (`fs-write`). */
  mode: ConfinedSandboxMode;
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string;
  /** `network`: "none" = the confined process gets no network at all. */
  network?: "none";
  /** `mask-paths`: absolute paths hidden from the confined process, reads included. */
  maskPaths?: readonly string[];
}

/**
 * Enforcement completeness for this host. `partial` means the backend or an older
 * kernel ABI cannot govern every promised effect; a caller requiring an absolute
 * boundary must not treat it as `full`. Reported as fact, never requested.
 */
export type SandboxEnforcement = "full" | "partial";

/**
 * Evidence identifying a runner that failed BEFORE executing the wrapped command.
 * A consumer applies `allowedExitCodes` when present, drops `informationalLines` by
 * exact line equality, then matches `fatalSignatures` case-insensitively per remaining
 * stderr line. Exit status alone never proves runner failure.
 */
export interface RunnerFailureRule {
  allowedExitCodes?: readonly number[];
  fatalSignatures: readonly string[];
  informationalLines?: readonly string[];
}

/** The result of confining one argv. */
export interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[];
  /** How completely the backend enforces this policy here. */
  enforcement: SandboxEnforcement;
  /**
   * The backend's denial DIALECT: the case-insensitive stderr substrings a denied
   * effect produces under THIS backend. A consumer inferring denials matches these
   * rather than a cross-backend union, which would claim denials a backend never emits.
   */
  denialSignatures: readonly string[];
  /** Structured runner-failure evidence (see {@link RunnerFailureRule}). */
  runnerFailureRules: readonly RunnerFailureRule[];
}

/**
 * A sandbox backend. `confine` must return enforcing argv or THROW — returning the
 * original argv unconfined is forbidden, which is what makes the whole capability
 * fail-closed.
 */
export interface SandboxProvider {
  /**
   * The dimensions this backend implements. Absent = `["fs-write"]`: a backend that
   * says nothing governs file writes only, which is the honest default and exactly
   * what a stock DSH backend is. The service routes by this declaration, so an
   * unimplemented dimension can never be silently ignored.
   */
  readonly dimensions?: readonly SandboxDimension[];
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv;
}

/** A provider, or a promise of one: backends load asynchronously (dynamic imports, probes). */
export type SandboxProviderSource = SandboxProvider | PromiseLike<SandboxProvider | null> | null;

/** The dimensions a provider implements (absent declaration = filesystem only). */
export function providerDimensions(provider: SandboxProvider): readonly SandboxDimension[] {
  return provider.dimensions ?? ["fs-write"];
}

/**
 * The active confinement settings, resolved per spawn. A type literal with plain
 * arrays because it parks as Json in the platform context (see PlatformCtx.sandbox).
 */
export type SandboxSettings = {
  /** `danger-full-access` = confinement off; commands spawn exactly as before. */
  mode: SandboxMode;
  network?: "none";
  maskPaths?: string[];
};

/** The dimensions a settings object actually requires. */
export function requestedDimensions(settings: SandboxSettings): SandboxDimension[] {
  const dims: SandboxDimension[] = ["fs-write"];
  if (settings.network !== undefined) dims.push("network");
  if (settings.maskPaths !== undefined && settings.maskPaths.length > 0) dims.push("mask-paths");
  return dims;
}

/**
 * Sandbox backend registration — the floor where extensions are PROVIDERS. Nothing is
 * built in: every backend is a package a deployment installs and names in extensions.json,
 * so a third-party one enters by the same door. A backend declares which dimensions it
 * implements (declaring none means filesystem only) and the service routes each policy
 * to one that covers it, so an unimplemented dimension can never be silently ignored.
 * A provider may be a promise — loading is async, and the service fails closed while it
 * is pending or failed.
 */
export interface SandboxProviderRegistry {
  registerProvider(name: string, provider: SandboxProviderSource): void;
}

/** Flips confinement. Settings park with the platform context, so they survive swaps. */
export interface SandboxControl {
  configure(settings: SandboxSettings): void;
  settings(): SandboxSettings;
}
