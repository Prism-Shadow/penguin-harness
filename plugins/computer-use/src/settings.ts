/**
 * The settings this plugin reads, typed at its own boundary: its own group (`computer-use`, which
 * it declares in index.ts), and the npm registry of the server's `plugin-sources` group, which is
 * where agent-desktop is downloaded from — the registry the server installs plugins from.
 */
import type { PolicySettings } from "./policy.js";

/** The group this plugin declares: its contribution id. */
export const GROUP = "computer-use";

/** The server's group for where plugins install from (plugin/source-settings.ts). */
export const SOURCES_GROUP = "plugin-sources";

export const OFFICIAL_REGISTRY = "https://registry.npmjs.org";

export interface ComputerUseSettings extends PolicySettings {
  enabled: boolean;
  /**
   * Whether members may use it. Off, only administrators — and Agents whose Session an
   * administrator drives — run `penguin computer`.
   */
  allowMembers: boolean;
  /** An agent-desktop program an administrator provides; empty downloads the pinned one. */
  binaryPath: string;
}

export function settingsOf(doc: Record<string, unknown>): ComputerUseSettings {
  const bool = (key: string, fallback: boolean) =>
    typeof doc[key] === "boolean" ? (doc[key] as boolean) : fallback;
  return {
    enabled: bool("enabled", true),
    allowMembers: bool("allowMembers", false),
    physicalInput: bool("physicalInput", false),
    clipboardRead: bool("clipboardRead", false),
    notificationRead: bool("notificationRead", false),
    binaryPath: typeof doc.binaryPath === "string" ? doc.binaryPath.trim() : "",
  };
}

/**
 * The registry to download from: the `plugin-sources` group's choice, else npm's
 * `npm_config_registry` when it names an https registry, else the official one — the same
 * order npm itself follows when the server runs it.
 */
export function registryOf(
  sources: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const chosen = sources.npmRegistry;
  if (typeof chosen === "string" && /^https:\/\/[^\s/]+/.test(chosen)) return chosen;
  const configured = env.npm_config_registry;
  if (typeof configured === "string" && /^https:\/\/[^\s/]+/.test(configured)) return configured;
  return OFFICIAL_REGISTRY;
}
