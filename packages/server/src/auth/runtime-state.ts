/**
 * The auth values that belong to the PROCESS, not to the App built on top of it.
 *
 * Auth policy — who may set a password, how long a session lasts, how logins are throttled —
 * is business behaviour and lives in the platform, so it ships by push. But a couple of values
 * must outlive a push while still dying at a restart: the first-login link a boot printed is
 * compared verbatim at redemption, so a swap that forgot it would strand whoever is holding
 * the link the console shows, and the local API token was written to `<root>/api-token` at
 * boot — a swap that forgot it would 401 every CLI and every command subprocess still
 * holding the file's value.
 *
 * That is the state layer of the four-layer model (hmr/README.md): a runtime resource the
 * platform claims, riding across swaps and never across restarts. The holder is deliberately
 * a plain mutable bag rather than a service — it carries no behaviour to go stale, so a
 * platform newer than its runtime can still use one an older runtime published.
 */

import { Interface } from "@prismshadow/penguin-core/kernel";
export interface AuthRuntimeState {
  /** The first-login link this boot printed, or null before one was minted. */
  firstLoginToken: string | null;
  /**
   * This boot's local API token (auth/api-token.ts), installed by the startup assembly.
   * Null in constructions that never minted one — they simply never authenticate a Bearer
   * header.
   */
  apiToken: string | null;
}

export function newAuthRuntimeState(): AuthRuntimeState {
  return { firstLoginToken: null, apiToken: null };
}

/** The process-scoped auth values, as the platform's modules see them. */
export abstract class AuthState extends Interface<AuthRuntimeState>() {}
