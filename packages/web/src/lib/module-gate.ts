/**
 * Which contributions are drawn right now. A web module that declares the server module it needs
 * (`WebAppModule.serverModules`) has its layers, dock panels, Settings pages and link menu rows
 * drawn only while that module runs on the server: while it is in the `modules` of
 * `GET /api/contributions`. Until the server has answered — signed out, safe mode, a request in
 * flight or failed — no gated contribution is drawn; a module that declares nothing is never
 * gated.
 *
 * WebAppModule records the declarations at boot (`setServerModuleGates`), the contributions
 * provider records the running list whenever the server answers (`setRunningServerModules`), and
 * each slot owner asks `contributionShown(<contributing module>)` where it draws, following
 * `subscribeModuleGates` (or `useContributionShown`) so a change shows at once.
 */
import { useSyncExternalStore } from "react";

let gates: ReadonlyMap<string, readonly string[]> = new Map();
let running: ReadonlySet<string> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** WebAppModule's side: each contributing web module's declared server modules. */
export function setServerModuleGates(next: ReadonlyMap<string, readonly string[]>): void {
  gates = next;
  notify();
}

/** The server's word: the plugin modules this generation runs, or null while there is none. */
export function setRunningServerModules(modules: readonly string[] | null | undefined): void {
  const next = modules == null ? null : new Set(modules);
  const same =
    next === null
      ? running === null
      : running !== null && running.size === next.size && [...next].every((m) => running!.has(m));
  if (same) return;
  running = next;
  notify();
}

/** Whether the contributions of the web module named `from` are drawn now. */
export function contributionShown(from: string): boolean {
  const needs = gates.get(from);
  if (needs === undefined || needs.length === 0) return true;
  const now = running;
  return now !== null && needs.every((module) => now.has(module));
}

/** Fires whenever a declaration or the running list changes. */
export function subscribeModuleGates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A counter that moves with every change: the snapshot a list filtered by the gates re-reads on. */
export function moduleGatesVersion(): number {
  return version;
}

/** `contributionShown(from)` as a component reads it, following its changes. */
export function useContributionShown(from: string): boolean {
  return useSyncExternalStore(
    subscribeModuleGates,
    () => contributionShown(from),
    () => contributionShown(from),
  );
}

/** Re-renders on every gate change; for a component that filters a list by `contributionShown`. */
export function useModuleGates(): number {
  return useSyncExternalStore(subscribeModuleGates, moduleGatesVersion, moduleGatesVersion);
}
