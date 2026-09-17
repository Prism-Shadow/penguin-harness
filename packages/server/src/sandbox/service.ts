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
} from "@prismshadow/penguin-core/plugin";
import { providerDimensions, requestedDimensions } from "./dimensions.js";
import { Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { Slot, ClassCtx, Json } from "@prismshadow/penguin-core/kernel";

interface MountedProvider {
  name: string;
  provider: SandboxProvider;
}

export class SandboxService {
  private readonly mounted: MountedProvider[] = [];
  /**
   * name → why it FAILED: it could not load, or failed its check on a host it is meant for —
   * never silently absent. Surfaced in the fail-closed message.
   */
  private readonly loadErrors = new Map<string, string>();
  /**
   * The backends that declined: this host is not theirs (a Linux backend on Windows). Nothing
   * is wrong with a deployment that installs one backend per platform, so a decline is not a
   * failure — it is listed only when NO backend serves, where it is the explanation.
   */
  private readonly declinedNames: string[] = [];
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
    // Every source is settled at once (a backend's check runs while the others load, and a
    // rejection is handled the moment it happens); the results are recorded in registration
    // order, which is routing order.
    const settled = [...registrations].map(([name, source]) => ({
      name,
      result: Promise.resolve(source).then(
        (provider) => ({ provider }),
        (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
      ),
    }));
    this.ready = (async () => {
      for (const { name, result } of settled) {
        const outcome = await result;
        if ("error" in outcome) this.loadErrors.set(name, outcome.error);
        else if (outcome.provider === null || outcome.provider === undefined) {
          this.declinedNames.push(name);
        } else this.mounted.push({ name, provider: outcome.provider });
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
    const parts = [...this.loadErrors].map(([name, message]) => `${name} (${message})`);
    if (this.declinedNames.length > 0) {
      parts.push(`${this.declinedNames.join(", ")} (not for this host)`);
    }
    return parts.length === 0 ? "" : `; backends not in use: ${parts.join("; ")}`;
  }
}

function copySettings(settings: SandboxSettings): SandboxSettings {
  return {
    mode: settings.mode,
    ...(settings.network !== undefined ? { network: settings.network } : {}),
    ...(settings.maskPaths !== undefined ? { maskPaths: [...settings.maskPaths] } : {}),
  };
}

/** Confinement: settings, the active confiner, and which backends are mounted. */
export abstract class Sandbox extends Interface<
  Pick<
    SandboxService,
    "configure" | "currentSettings" | "parkedSettings" | "backends" | "confiner" | "whenReady"
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
        "network?": "'none'",
        "maskPaths?": "string[]",
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
