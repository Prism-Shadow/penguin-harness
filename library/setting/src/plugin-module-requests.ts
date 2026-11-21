/**
 * The record of who asked this server to run a library plugin's server module, and what an
 * administrator decided (PRFC-0031): one row per package. It is the record of asks and decisions,
 * not of what runs — the Project plugin tables are that — so a row can go stale (an administrator
 * unlisted the package by hand) and is then overwritten by the next ask.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** How a module came to be enabled: by being built in, by the administrator's own act, or by approving a member's request. */
export type PluginModuleVia = "builtin" | "admin" | "approval";

/** One row of `plugin_module_requests`. */
export interface PluginModuleRequestRow {
  /** The npm package name, as a plugin table lists it. */
  package: string;
  /** The library plugin's name, for display. */
  plugin: string;
  /** The Project whose table lists it, or will; null once that Project is gone. */
  projectId: string | null;
  /** The Agent whose install asked first; display only. */
  agentId: string | null;
  /** The user who asked; "" when no person was behind it (company mode's reconcile). */
  requestedBy: string;
  requestedAt: string;
  /** null = pending. */
  decision: "enabled" | "declined" | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** How it was enabled; null while pending or declined. */
  via: PluginModuleVia | null;
}

/** PluginModuleRequests: the mechanism PluginModuleRequestsRepo implements. */
@Interface()
export abstract class PluginModuleRequests {
  /** The row for one package; null when nobody ever asked. */
  abstract get(pkg: string): PluginModuleRequestRow | null;
  /** Every row, pending ones first, then the most recently asked or decided. */
  abstract list(): PluginModuleRequestRow[];
  /** Writes the whole row, replacing any row for the same package. */
  abstract upsert(row: PluginModuleRequestRow): void;
  /** Records an administrator's decision on an existing row; false when there is none. */
  abstract decide(
    pkg: string,
    decision: "enabled" | "declined",
    by: string,
    at: string,
    via: PluginModuleVia | null,
  ): boolean;
  /** How many rows wait for a decision. */
  abstract pendingCount(): number;
}
