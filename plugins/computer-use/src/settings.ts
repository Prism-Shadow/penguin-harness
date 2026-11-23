/**
 * The settings this plugin reads, typed at its own boundary: its own group (`computer-use`, which
 * it declares in index.ts), and where agent-desktop is downloaded from — the npm registry of the
 * server's `plugin-sources` group, the registry the server installs plugins from, then the npm
 * registry mirror of its `plugin-mirrors` group when one is chosen.
 */
import type { PolicySettings } from "./policy.js";

/** The group this plugin declares: its contribution id. */
export const GROUP = "computer-use";

/** The server's group for where plugins install from (plugin/source-settings.ts). */
export const SOURCES_GROUP = "plugin-sources";

/** The server's group of mirrors tried after a source's own URL (plugin/mirror-settings.ts). */
export const MIRRORS_GROUP = "plugin-mirrors";

/**
 * The server's npm registry mirror rule (plugin/mirror-settings.ts MIRROR_RULES, `npm-registry`),
 * restated here — a plugin reads the server's choice, not its code: the official registry's
 * packages, served from npmmirror's domain. The GitHub mirrors serve no npm tarball.
 */
const NPM_MIRROR = {
  from: /^https:\/\/registry\.npmjs\.org(\/.*)?$/,
  to: "https://registry.npmmirror.com",
};

export const OFFICIAL_REGISTRY = "https://registry.npmjs.org";

/** Input this recent (seconds) means the person at this computer is using it. */
export const USER_ACTIVE_SECONDS = 3;

export interface ComputerUseSettings extends PolicySettings {
  enabled: boolean;
  /**
   * Whether members may use it. Off, only administrators — and Agents whose Session an
   * administrator drives — run `penguin computer`.
   */
  allowMembers: boolean;
  /** An agent-desktop program an administrator provides; empty downloads the pinned one. */
  binaryPath: string;
  /**
   * Input commands pause — refused with `user_active` — while the person at this computer is
   * using the keyboard or mouse (their last input under USER_ACTIVE_SECONDS ago). Off by default.
   */
  pauseWhileUserActive: boolean;
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
    pauseWhileUserActive: bool("pauseWhileUserActive", false),
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

/**
 * Every address to download from, in the order tried: the registry (registryOf), then — when the
 * `plugin-mirrors` group chooses the npm registry mirror — that registry rewritten onto the
 * mirror, as the server's own fetches try it. Duplicates are dropped.
 */
export function registriesOf(
  sources: Record<string, unknown>,
  mirrors: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out = [registryOf(sources, env)];
  const chosen = Array.isArray(mirrors.mirrors) ? mirrors.mirrors : [];
  if (chosen.includes("npm-registry")) {
    for (const registry of [...out]) {
      const m = NPM_MIRROR.from.exec(registry.replace(/\/+$/, ""));
      if (m !== null) out.push(`${NPM_MIRROR.to}${m[1] ?? ""}`);
    }
  }
  return [...new Set(out.map((r) => r.replace(/\/+$/, "")))];
}
