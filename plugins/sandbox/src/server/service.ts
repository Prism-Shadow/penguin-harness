/**
 * The sandbox service: owns the registered backends, routes each spawn's policy to a
 * backend that implements the dimensions it requires, and produces the SpawnConfiner
 * closure the runtime transports into core's command-session seam.
 *
 * Routing is by CAPABILITY, not by registration order: of the mounted backends covering
 * every dimension a policy requires, the one implementing the most dimensions wins, so a
 * native backend (penguin-bwrap) serves every policy it covers even when the portable DSH
 * adaptor is mounted beside it, and the adaptor serves only where it is the one left — a
 * Linux host refusing bubblewrap's user namespaces, where it confines files through
 * Landlock. Registration order only breaks ties. A request nothing covers fails closed —
 * never a silent unconfined run, and never a silently dropped dimension.
 */
import fs from "node:fs";
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import type {
  SandboxDimension,
  SandboxLimit,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
  SandboxSettings,
} from "@prismshadow/penguin-core/plugin";
import { providerDimensions, requestedDimensions } from "./dimensions.js";
import { Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { Slot, ClassCtx, Json } from "@prismshadow/penguin-core/kernel";

interface MountedProvider {
  name: string;
  provider: SandboxProvider;
}

/** How one registration's latest load settled. */
type LoadOutcome = { provider: SandboxProvider } | { declined: true } | { error: string };

interface Registration {
  name: string;
  source: SandboxProviderSource;
  outcome?: LoadOutcome;
  /** Counts the loads started; only the latest one's outcome is recorded. */
  attempts: number;
}

/** Settles one load: a provider, a decline (null), or the failure's message. */
function settle(source: SandboxProviderSource): Promise<LoadOutcome> {
  return Promise.resolve()
    .then(() => (typeof source === "function" ? source() : source))
    .then(
      (provider): LoadOutcome =>
        provider === null || provider === undefined ? { declined: true } : { provider },
      (err: unknown): LoadOutcome => ({ error: err instanceof Error ? err.message : String(err) }),
    );
}

export class SandboxService {
  private mounted: MountedProvider[] = [];
  /**
   * name → why it FAILED: it could not load, or failed its check on a host it is meant for —
   * never silently absent. Surfaced in the fail-closed message and on the settings card.
   */
  private loadErrors = new Map<string, string>();
  /**
   * The backends that declined: this host is not theirs (a Linux backend on Windows). Nothing
   * is wrong with a deployment that installs one backend per platform, so a decline is not a
   * failure — it is listed only when NO backend serves, where it is the explanation.
   */
  private declinedNames: string[] = [];
  /** Every registration in routing order, with how its latest load settled. */
  private readonly registrations: Registration[];
  /**
   * Ships with confinement OFF (`danger-full-access`): the default flips to
   * workspace-write together with the deployment-facing config surface, so a
   * deployment gains the switch before the enforcement — otherwise every host without
   * a usable backend would fail every command the moment this code arrives.
   */
  private settings: SandboxSettings = { mode: "danger-full-access" };
  private readonly ready: Promise<void>;

  /**
   * @param registrations - the backends plugins registered (see the sandbox registry on
   *   PenguinInterface). Loading is async, but create() and the confiner are sync: a
   *   confining policy resolved before loading settles fails closed rather than
   *   waiting. The default settings never consult a backend, so that window only
   *   exists for deployments flipping the mode in the first milliseconds after boot.
   */
  constructor(registrations: Iterable<[string, SandboxProviderSource]> = []) {
    const loads: Registration[] = [...registrations].map(([name, source]) => ({
      name,
      source,
      attempts: 1,
    }));
    this.registrations = loads;
    // Every source is settled at once (a backend's check runs while the others load, and a
    // rejection is handled the moment it happens); the results are recorded in registration
    // order, which is routing order.
    const settled = loads.map((r) => settle(r.source));
    this.ready = (async () => {
      for (const [i, result] of settled.entries()) {
        loads[i]!.outcome = await result;
        this.record();
      }
    })();
  }

  /** Rebuilds the mounted / failed / declined views from the registrations, in routing order. */
  private record(): void {
    const mounted: MountedProvider[] = [];
    const errors = new Map<string, string>();
    const declined: string[] = [];
    for (const { name, outcome } of this.registrations) {
      if (outcome === undefined) continue;
      if ("provider" in outcome) mounted.push({ name, provider: outcome.provider });
      else if ("error" in outcome) errors.set(name, outcome.error);
      else declined.push(name);
    }
    this.mounted = mounted;
    this.loadErrors = errors;
    this.declinedNames = declined;
  }

  /**
   * Loads again every backend whose load failed and that registered a loader (a bare promise
   * cannot be re-run). Called after the sandbox's settings are saved: a backend whose check
   * failed on its own setting mounts once that setting is fixed. Resolves when those settle.
   */
  retryFailed(): Promise<void> {
    return this.ready.then(async () => {
      await Promise.all(
        this.registrations
          .filter((r) => r.outcome !== undefined && "error" in r.outcome)
          .filter((r) => typeof r.source === "function")
          .map(async (r) => {
            // Saves in quick succession each probe their own setting; an older probe that
            // settles last must not overwrite the newer outcome.
            const attempt = ++r.attempts;
            const outcome = await settle(r.source);
            if (r.attempts !== attempt) return;
            r.outcome = outcome;
            this.record();
          }),
      );
    });
  }

  /** Resolves when every registered backend has loaded (or failed to). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Replaces the active settings (the config surface's write path). */
  configure(settings: SandboxSettings): void {
    this.settings = settings;
  }

  /** The active settings as a plain copy (the config surface's read side). */
  currentSettings(): SandboxSettings {
    return copySettings(this.settings);
  }

  /**
   * The active settings as parked state, or undefined for the pristine default. The
   * omission is load-bearing compatibility: a default deployment keeps parking
   * `{ motd }`, which any platform bundle's context schema accepts. Once confinement
   * is configured the field enters the document, and from then on pushing a
   * sandbox-ignorant bundle is BLOCKED by schema validation — the right failure:
   * refusing the swap beats a swap that silently un-confines the deployment.
   */
  parkedSettings(): SandboxSettings | undefined {
    const s = this.settings;
    if (
      s.mode === "danger-full-access" &&
      s.network === undefined &&
      s.maskPaths === undefined &&
      s.writableTemp === undefined
    ) {
      return undefined;
    }
    return copySettings(s);
  }

  /** The backends that failed to load, each with why (diagnostics / the config surface). */
  failures(): Array<{ name: string; reason: string }> {
    return [...this.loadErrors].map(([name, reason]) => ({ name, reason }));
  }

  /** The backends that declined because this host is not theirs (the config surface). */
  declined(): string[] {
    return [...this.declinedNames];
  }

  /**
   * The mounted backends and what each implements, in routing preference: the one a policy
   * goes to first (diagnostics / the config surface).
   */
  backends(): Array<{
    name: string;
    dimensions: readonly SandboxDimension[];
    mechanism?: string;
    limits?: readonly SandboxLimit[];
  }> {
    return byPreference(this.mounted).map(({ name, provider }) => ({
      name,
      dimensions: providerDimensions(provider),
      ...(provider.mechanism !== undefined ? { mechanism: provider.mechanism } : {}),
      ...(provider.limits !== undefined && provider.limits.length > 0
        ? { limits: provider.limits }
        : {}),
    }));
  }

  /**
   * The closure handed to the runtime: rewrites each spawn's argv under the active
   * settings. Pure and self-contained, so the previous platform's confiner keeps
   * serving during a hot-swap freeze window.
   */
  confiner(): SpawnConfiner {
    return this.confinerFor(() => this.settings);
  }

  /**
   * The same closure under a policy the caller keeps — a Session's own snapshot. The
   * backends are still this service's, so a backend change reaches every Session.
   */
  confinerFor(policyOf: () => SandboxSettings): SpawnConfiner {
    return (argv, opts) => {
      const settings = policyOf();
      const required = requestedDimensions(settings);
      // Full access with nothing else asked (no network cut, no masked paths) is genuinely
      // unconfined — spawn as-is. But full access that STILL cuts the network or masks a path
      // needs a backend: returning here would silently drop that half of the policy. So the
      // short-circuit is "no confinement dimension beyond fs-write", not "mode is full".
      if (settings.mode === "danger-full-access" && required.length === 1) return { argv };
      const provider = this.pick(required, settings.mode);
      // Only workspace-write binds further writable roots; under read-only (or full access
      // with a network cut) every backend ignores them, so neither the field nor the
      // directory is made there.
      const scratchpadDir = settings.mode === "workspace-write" ? opts.scratchpadDir : undefined;
      // The Session's scratchpad is created lazily (on the first thing written into it), and a
      // command, an agent or the user can remove it mid-Session, but a backend binding it needs
      // it on disk: bubblewrap refuses to start on a missing bind source. Ensured on every
      // spawn, here, where every confined spawn meets — see SandboxPolicy.writableRoots.
      if (scratchpadDir !== undefined) ensureScratchpad(scratchpadDir);
      // workspaceRoot is the Session's Workspace, never the per-command cwd: a command
      // running in a workdir outside the Workspace must not widen the writable roots.
      const policy: SandboxPolicy = {
        mode: settings.mode,
        workspaceRoot: opts.workspaceDir,
        // The Session's scratchpad is writable beside the Workspace: the plan file, a goal's
        // state file and the attachments live there, and hooks and commands both write it.
        ...(scratchpadDir !== undefined ? { writableRoots: [scratchpadDir] } : {}),
        ...(settings.network !== undefined ? { network: settings.network } : {}),
        ...(settings.maskPaths !== undefined && settings.maskPaths.length > 0
          ? { maskPaths: settings.maskPaths }
          : {}),
        // On unless turned off: without a writable temp directory a shell cannot start.
        ...(settings.writableTemp !== false ? { writableTemp: true } : {}),
      };
      // ConfinedArgv also carries enforcement / denialSignatures / runnerFailureRules;
      // the classification consumer (denial vs runner failure) lands with escalation. The
      // rules' informational lines are what the runner reports on every run (the Landlock
      // launcher on an older kernel): the spawn drops them from the command's stderr.
      const confined = provider.confine(argv, policy);
      const runnerLines = confined.runnerFailureRules.flatMap((r) => r.informationalLines ?? []);
      return {
        argv: confined.argv,
        ...(confined.env !== undefined ? { env: confined.env } : {}),
        ...(runnerLines.length > 0 ? { runnerLines } : {}),
      };
    };
  }

  /**
   * The preferred mounted backend implementing every required dimension (byPreference), or a
   * fail-closed throw.
   */
  private pick(required: readonly SandboxDimension[], mode: string): SandboxProvider {
    const match = byPreference(this.mounted).find(({ provider }) => {
      const implemented = providerDimensions(provider);
      return required.every((dimension) => implemented.includes(dimension));
    });
    if (match !== undefined) return match.provider;
    throw new Error(
      this.mounted.length === 0
        ? `sandbox mode "${mode}" is configured but no sandbox backend is mounted${this.failedSuffix()}; ` +
            "refusing to run the command unconfined."
        : `sandbox policy requires ${required.join(" + ")}, but no mounted sandbox backend ` +
            `implements all of it (${this.mounted
              .map(({ name, provider }) => `${name}: ${providerDimensions(provider).join(", ")}`)
              .join("; ")})${this.failedSuffix()}; refusing to run the command unconfined.`,
    );
  }

  private failedSuffix(): string {
    const parts = [...this.loadErrors].map(([name, message]) => `${name} (${message})`);
    if (this.declinedNames.length > 0) {
      parts.push(`${this.declinedNames.join(", ")} (not for this host)`);
    }
    return parts.length === 0 ? "" : `; backends not in use: ${parts.join("; ")}`;
  }
}

/**
 * Backends in routing preference: more implemented dimensions first, registration order among
 * equals (the sort is stable). Bubblewrap and the DSH adaptor both cover a files-only policy;
 * the one that could also have cut the network or masked a path is the one that serves it, on
 * whatever order the Projects' plugin lists name them in.
 */
function byPreference(mounted: readonly MountedProvider[]): MountedProvider[] {
  const size = (m: MountedProvider) => providerDimensions(m.provider).length;
  return [...mounted].sort((a, b) => size(b) - size(a));
}

/**
 * Creates the Session's scratchpad if it is missing (a no-op when it exists). A failure
 * throws, fail-closed: dropping the root and confining without it would start the command
 * but leave it unable to write the directory it was told it may write.
 *
 * Known race, left as is: deleting a Session removes its scratchpad, and a run that outlives
 * the delete (a command still being spawned for it) recreates the directory here. The cost is
 * an empty, orphaned directory under the Agent's scratchpad that nothing cleans up; it holds
 * only what that last run writes, and no access outlives the Session.
 */
function ensureScratchpad(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // A filesystem error's message leads with its errno (`EACCES: permission denied, …`).
    throw new Error(
      `cannot prepare the Session scratchpad ${dir} for the sandbox ` +
        `(${err instanceof Error ? err.message : String(err)}); refusing to run the command without it.`,
      { cause: err },
    );
  }
}

function copySettings(settings: SandboxSettings): SandboxSettings {
  return {
    mode: settings.mode,
    ...(settings.network !== undefined ? { network: settings.network } : {}),
    ...(settings.maskPaths !== undefined ? { maskPaths: [...settings.maskPaths] } : {}),
    ...(settings.writableTemp !== undefined ? { writableTemp: settings.writableTemp } : {}),
  };
}

/** Confinement: settings, the active confiner, and which backends are mounted. */
export abstract class Sandbox extends Interface<
  Pick<
    SandboxService,
    | "configure"
    | "currentSettings"
    | "parkedSettings"
    | "backends"
    | "failures"
    | "declined"
    | "retryFailed"
    | "confiner"
    | "confinerFor"
    | "whenReady"
  >
>() {}

export interface SandboxSlots {
  /**
   * A backend: its static half here (name, the dimensions it implements), its code half
   * bound by the contributor — a provider, or a promise of one for backends that probe.
   */
  providers: Slot<{ name: string; dimensions: SandboxDimension[] }, SandboxProviderSource>;
}

@Module({
  context: {
    version: 1,
    schema: {
      "settings?": {
        mode: "'read-only'|'workspace-write'|'danger-full-access'",
        "network?": "'none'|'local'",
        "maskPaths?": "string[]",
        "writableTemp?": "boolean",
      },
    },
  },
})
export class SandboxModule {
  @Provide() sandbox!: Sandbox;
  setup({ contributions }: ClassCtx, context: Json) {
    const providers = (contributions.providers ?? []).map(
      (c) =>
        [c.data.name as string, c.code as SandboxProviderSource] as [string, SandboxProviderSource],
    );
    const sandbox = new SandboxService(providers);
    // Parked settings ride the swap: without this every push would construct a fresh
    // service on defaults and silently un-confine a confining deployment.
    const parked = (context as { settings?: SandboxSettings } | null)?.settings;
    if (parked !== undefined) sandbox.configure(parked);
    this.sandbox = sandbox;
  }

  park(): Json {
    const settings = this.sandbox.parkedSettings();
    return settings === undefined ? null : { settings };
  }
}
