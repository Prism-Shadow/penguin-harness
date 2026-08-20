/**
 * The runtime→platform capability contract: what the runtime publishes through the
 * resource registry for the booting platform to claim.
 *
 * The registry is the only channel the kernel offers a booting platform (ctx carries
 * `resources`, nothing else), and everything here is published for one of two reasons:
 *
 * - it is runtime MECHANISM the platform must not re-implement (authentication, the SSE
 *   channel hub, the proxy dispatcher — a pushed bundle carries its own copy of every
 *   module, so a bundle-side `applyProxySettings` would configure the bundle's undici
 *   instance while `globalThis.fetch` still routes through the runtime's);
 * - or it is a live object that must be ONE per process (the SQLite handle — web.db is
 *   single-writer; the ServerConfig object — the listen callback writes the real port
 *   back into it and every reader must observe that write).
 *
 * A platform booted by a runtime that publishes none of this (an older runtime, or a
 * bare kernel in tests) simply builds no business surface — the capability being absent
 * IS the signal, and terminals keep working regardless.
 *
 * The reverse direction is ONE entry: the pointer to the current App ({@link
 * PlatformCurrent}) — deps, route table and graceful wrap-up published together in a
 * single registry write.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { ServerConfig } from "../config.js";
import type { AuthService } from "../auth/service.js";
import type { ChannelHub } from "../runtime/channel.js";
import type { ProxySettings } from "../net/proxy.js";
import type { HmrHost } from "../hmr/host.js";
import type { DesktopService } from "../services/desktop-service.js";
import type { AppDeps } from "../app.js";

export const RUNTIME_CONFIG_RESOURCE_ID = "runtime:config";
export const RUNTIME_DB_RESOURCE_ID = "runtime:db";
export const RUNTIME_AUTH_RESOURCE_ID = "runtime:auth-service";
export const RUNTIME_CHANNELS_RESOURCE_ID = "runtime:channels";
export const RUNTIME_PROXY_RESOURCE_ID = "runtime:proxy-control";
export const RUNTIME_HMR_RESOURCE_ID = "runtime:hmr-host";
/**
 * Desktop mode's one service (one-shot login + shutdown token holder). Registered even
 * when null: desktop-ness is the runtime's lifecycle fact, but the business surface
 * reads it too (`/api/me` reports desktopMode; single-user mode closes the multi-user
 * admin surfaces), so the claim must distinguish "not desktop" from "not published".
 */
export const RUNTIME_DESKTOP_RESOURCE_ID = "runtime:desktop";
/** Test-only: BuildDepsOverrides published by bootAppDeps for the platform boot to claim. */
export const RUNTIME_OVERRIDES_RESOURCE_ID = "runtime:overrides";
/** Reverse direction: THE pointer to the current App (see {@link PlatformCurrent}). */
export const PLATFORM_CURRENT_RESOURCE_ID = "platform:current";

/**
 * The one object a swap publishes — deps, route table and wrap-up together, so flipping
 * to a new App is a single registry write and no reader can ever see a half-swapped pair
 * (new deps with the old routes, or the reverse). Everything runtime-side that needs the
 * current App resolves this pointer at use time: the seam middleware dispatches into
 * `app`, auth late-binds provisioning through `deps`, index.ts's shutdown awaits
 * `shutdown`.
 */
export interface PlatformCurrent {
  /** The business deps this App built, or null when the runtime published no capabilities. */
  deps: AppDeps | null;
  /** The App's whole Hono route table (terminal + business), fetch-shaped for cross-bundle safety. */
  app: { fetch(request: Request): Response | Promise<Response> };
  /** Process-exit graceful drain (manager ≤5s wrap-up); absent when no business runs. */
  shutdown?: () => Promise<void>;
}

/** Applies proxy settings to the RUNTIME's global dispatcher (see net/proxy.ts). */
export type ProxyControl = (settings: ProxySettings) => void;

/** Everything buildAppDeps needs, claimed in one place. */
export interface RuntimeCapabilities {
  config: ServerConfig;
  db: DatabaseSync;
  authService: AuthService;
  channels: ChannelHub;
  proxyControl: ProxyControl;
  hmr: HmrHost;
  /** Null on a non-desktop server (a real value, not an absent capability). */
  desktop: DesktopService | null;
}

/**
 * Claims the full capability set, or null when any piece is missing — a partial claim
 * would build a business surface over half a runtime, which is worse than the honest
 * "this runtime publishes no business capabilities" degradation.
 */
export function claimRuntimeCapabilities(resources: Resources): RuntimeCapabilities | null {
  const config = resources.claim<ServerConfig>(RUNTIME_CONFIG_RESOURCE_ID);
  const db = resources.claim<DatabaseSync>(RUNTIME_DB_RESOURCE_ID);
  const authService = resources.claim<AuthService>(RUNTIME_AUTH_RESOURCE_ID);
  const channels = resources.claim<ChannelHub>(RUNTIME_CHANNELS_RESOURCE_ID);
  const proxyControl = resources.claim<ProxyControl>(RUNTIME_PROXY_RESOURCE_ID);
  const hmr = resources.claim<HmrHost>(RUNTIME_HMR_RESOURCE_ID);
  if (!config || !db || !authService || !channels || !proxyControl || !hmr) return null;
  // Desktop is nullable by meaning, so it sits outside the all-present check.
  const desktop = resources.claim<DesktopService | null>(RUNTIME_DESKTOP_RESOURCE_ID) ?? null;
  return { config, db, authService, channels, proxyControl, hmr, desktop };
}
