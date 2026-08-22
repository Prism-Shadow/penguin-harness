/**
 * The sandbox service: owns the registered backends, routes each spawn's policy to a
 * backend that implements the dimensions it requires, and produces the SpawnConfiner
 * closure the runtime transports into core's command-session seam.
 *
 * Routing is by CAPABILITY, not by registration order alone: a policy requiring only
 * `fs-write` goes to the first backend that covers it (the DSH adaptor, which works on
 * Linux/macOS/Windows alike), while a policy also requiring `network` or `mask-paths`
 * goes to the first backend implementing those (penguin-bwrap). Registration order
 * only breaks ties between backends that both cover the request. A request nothing
 * covers fails closed — never a silent unconfined run, and never a silently dropped
 * dimension.
 */
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import type {
  SandboxDimension,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
  SandboxSettings,
} from "./types.js";
import { providerDimensions, requestedDimensions } from "./types.js";

interface MountedProvider {
  name: string;
  provider: SandboxProvider;
}

export class SandboxService {
  private readonly mounted: MountedProvider[] = [];
  /** name → why it failed to load; surfaced in the fail-closed message. */
  private readonly loadErrors = new Map<string, string>();
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
    this.ready = (async () => {
      for (const [name, source] of registrations) {
        try {
          const provider = await source;
          if (provider !== null && provider !== undefined) this.mounted.push({ name, provider });
        } catch (err) {
          this.loadErrors.set(name, err instanceof Error ? err.message : String(err));
        }
      }
    })();
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
    if (s.mode === "danger-full-access" && s.network === undefined && s.maskPaths === undefined) {
      return undefined;
    }
    return copySettings(s);
  }

  /** The mounted backends and what each implements (diagnostics / the config surface). */
  backends(): Array<{ name: string; dimensions: readonly SandboxDimension[] }> {
    return this.mounted.map(({ name, provider }) => ({
      name,
      dimensions: providerDimensions(provider),
    }));
  }

  /**
   * The closure handed to the runtime: rewrites each spawn's argv under the active
   * settings. Pure and self-contained, so the previous platform's confiner keeps
   * serving during a hot-swap freeze window.
   */
  confiner(): SpawnConfiner {
    return (argv, opts) => {
      const settings = this.settings;
      if (settings.mode === "danger-full-access") return argv;
      const required = requestedDimensions(settings);
      const provider = this.pick(required, settings.mode);
      // workspaceRoot is the Session's Workspace, never the per-command cwd: a command
      // running in a workdir outside the Workspace must not widen the writable roots.
      const policy: SandboxPolicy = {
        mode: settings.mode,
        workspaceRoot: opts.workspaceDir,
        ...(settings.network !== undefined ? { network: settings.network } : {}),
        ...(settings.maskPaths !== undefined && settings.maskPaths.length > 0
          ? { maskPaths: settings.maskPaths }
          : {}),
      };
      // ConfinedArgv also carries enforcement / denialSignatures / runnerFailureRules;
      // the classification consumer (denial vs runner failure) lands with escalation.
      return provider.confine(argv, policy).argv;
    };
  }

  /** The first mounted backend implementing every required dimension, or a fail-closed throw. */
  private pick(required: readonly SandboxDimension[], mode: string): SandboxProvider {
    const match = this.mounted.find(({ provider }) => {
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
    if (this.loadErrors.size === 0) return "";
    const failures = [...this.loadErrors]
      .map(([name, message]) => `${name} (${message})`)
      .join("; ");
    return `; backends that failed to load: ${failures}`;
  }
}

function copySettings(settings: SandboxSettings): SandboxSettings {
  return {
    mode: settings.mode,
    ...(settings.network !== undefined ? { network: settings.network } : {}),
    ...(settings.maskPaths !== undefined ? { maskPaths: [...settings.maskPaths] } : {}),
  };
}
