/**
 * Sandbox settings, stored: the confinement an admin chose on the Settings dialog's Sandbox
 * page, kept in `server_settings` under `sandbox` so it survives a restart, and loaded into
 * the sandbox service when the App boots.
 *
 * The service itself stays on the capability-free floor (a bare kernel boots it with no
 * database), so the store is a node of its own above it. The service's parked context is
 * untouched: it still rides a hot swap and still reaches a platform older than this store.
 * On boot a stored document wins; with none stored, whatever the swap carried stays.
 */
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { SandboxMode, SandboxSettings } from "@prismshadow/penguin-core/plugin";
import { Settings } from "../mechanisms/settings.js";
import { Sandbox, SandboxModule } from "./service.js";

const SETTINGS_KEY = "sandbox";
const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
/** Cap on the mask list: a policy, not a filesystem index. */
const MAX_MASK_PATHS = 64;

/** What `parseSandboxSettings` refuses. */
export class SandboxSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxSettingsError";
  }
}

/** Parses a settings document, rejecting the whole of it rather than keeping half. */
export function parseSandboxSettings(body: Record<string, unknown>): SandboxSettings {
  const mode = body.mode;
  if (typeof mode !== "string" || !MODES.includes(mode as SandboxMode)) {
    throw new SandboxSettingsError(`mode must be one of ${MODES.join(", ")}.`);
  }
  const network = body.network;
  if (network !== undefined && network !== null && network !== "none") {
    throw new SandboxSettingsError('network must be "none" or null.');
  }
  const rawPaths = body.maskPaths;
  let maskPaths: string[] | undefined;
  if (rawPaths !== undefined && rawPaths !== null) {
    if (!Array.isArray(rawPaths) || rawPaths.some((p) => typeof p !== "string")) {
      throw new SandboxSettingsError("maskPaths must be an array of paths.");
    }
    const cleaned = [
      ...new Set((rawPaths as string[]).map((p) => p.trim()).filter((p) => p !== "")),
    ];
    if (cleaned.length > MAX_MASK_PATHS) {
      throw new SandboxSettingsError(`maskPaths may name at most ${MAX_MASK_PATHS} paths.`);
    }
    if (cleaned.length > 0) maskPaths = cleaned;
  }
  return {
    mode: mode as SandboxMode,
    ...(network === "none" ? { network: "none" as const } : {}),
    ...(maskPaths === undefined ? {} : { maskPaths }),
  };
}

/** What the Sandbox page writes through: the service's settings, persisted. */
export abstract class SandboxConfig extends Interface<{
  /** Stores the settings and applies them to the next command spawn. */
  save(settings: SandboxSettings): void;
}>() {}

@Module()
export class SandboxSettingsStore {
  @Use() private readonly settings!: Settings;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  @Provide() sandboxConfig!: SandboxConfig;
  setup() {
    const { settings, sandbox } = this;
    const raw = settings.get(SETTINGS_KEY);
    if (raw !== null) {
      try {
        sandbox.configure(parseSandboxSettings(JSON.parse(raw) as Record<string, unknown>));
      } catch (err) {
        // Only the validated route writes this key, so a document that does not parse was
        // edited by hand; the service keeps what it booted with rather than guessing.
        console.warn(
          `[sandbox] ignoring stored settings: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.sandboxConfig = {
      save(next) {
        settings.set(SETTINGS_KEY, JSON.stringify(next));
        sandbox.configure(next);
      },
    };
  }
}
