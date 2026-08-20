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
 * The reverse direction has two entries: the platform publishes its built business deps
 * (for the composition root and tests to reach) and a graceful-shutdown hook (process
 * exit wants the manager's ≤5s wrap-up, which a synchronous dispose effect cannot await).
 */
import type { DatabaseSync } from "node:sqlite";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { ServerConfig } from "../config.js";
import type { AuthService } from "../auth/service.js";
import type { ChannelHub } from "../runtime/channel.js";
import type { ProxySettings } from "../net/proxy.js";
import type { HmrHost } from "../hmr/host.js";
import type { DesktopService } from "../services/desktop-service.js";

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
/** Test-only: BuildDepsOverrides published by buildAppDeps for the packaged boot to claim. */
export const RUNTIME_OVERRIDES_RESOURCE_ID = "runtime:business-overrides";
/** Reverse direction: the current App's built business deps (see platform.ts). */
export const BUSINESS_DEPS_RESOURCE_ID = "platform:business-deps";
/** Reverse direction: the current App's async process-exit wrap-up (manager ≤5s drain). */
export const GRACEFUL_SHUTDOWN_RESOURCE_ID = "platform:graceful-shutdown";

/** Applies proxy settings to the RUNTIME's global dispatcher (see net/proxy.ts). */
export type ProxyControl = (settings: ProxySettings) => void;

/** Everything buildBusinessDeps needs, claimed in one place. */
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
