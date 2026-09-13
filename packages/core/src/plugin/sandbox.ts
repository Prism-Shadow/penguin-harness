/**
 * The sandbox vocabulary a plugin compiles against — types only.
 *
 * It lives in core, alongside the rest of the plugin contract, because a backend is
 * written against these names and nothing else: a package implementing {@link
 * SandboxProvider} needs the policy it is handed and the argv it must return, not the
 * harness that routes them. The routing itself (which policy goes to which backend, and
 * the settings behind it) is the embedder's, and stays there.
 *
 * Confinement is argv rewriting and nothing else: a provider returns the argv the caller
 * should spawn instead of its own, and never executes anything itself.
 *
 * Nothing here emits runtime code. The helpers that read these shapes
 * (`SANDBOX_DIMENSIONS`, `providerDimensions`, `requestedDimensions`) are the embedder's
 * and live in the server package, so a plugin carries no runtime dependency on core.
 * A backend reaches the harness by contributing to the `sandbox.providers` slot (see
 * the sandbox module's iface.ts in the server package).
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
