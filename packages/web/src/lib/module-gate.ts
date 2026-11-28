/**
 * Which contributions are drawn right now. A web module that declares the server module it needs
 * (`WebAppModule.serverModules`) has everything it draws — its pages and page renderers, layers,
 * dock panels, Settings pages, Session tabs, file renderers, sidebar sections, modes and badges,
 * session-row entries and marks, link menu rows — shown only while that module runs on the
 * server: while it is in the running list (`GET /api/contributions`' `modules`, or until that
 * answer comes, the list this browser last saw — web-app/running-modules.ts). With no list at all
 * (signed out, safe mode) nothing gated is drawn; a module that declares nothing is never gated.
 * Two slots wrap everything below them, so turning them on and off would remount the app: a
 * gated module's `WebAppModule.sessionProviders` and sidebar section `Scope` are not mounted at
 * all (`isGated`), with a warning.
 *
 * WebAppModule records the declarations at boot (`setServerModuleGates`), the contributions
 * provider records the running list (`setRunningServerModules`), and each slot owner asks
 * `contributionShown(<contributing module>)` where it draws — or wraps the contributed component
 * in `gatedComponent` — following `subscribeModuleGates` (or `useContributionShown`) so a change
 * shows at once. The owners ask when they draw, not at boot: the declarations land when
 * WebAppModule sets up, which may come after them.
 */
import { createElement, useSyncExternalStore, type ComponentType } from "react";

let gates: ReadonlyMap<string, readonly string[]> = new Map();
let runtimeGates: ReadonlyMap<string, readonly string[]> = new Map();
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

/** External runtime web modules' declared server modules, merged alongside static gates. */
export function setRuntimeServerModuleGates(next: ReadonlyMap<string, readonly string[]>): void {
  runtimeGates = next;
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

/** Whether the web module named `from` declared a server module at all (fixed once booted). */
export function isGated(from: string): boolean {
  return ((gates.get(from) ?? runtimeGates.get(from))?.length ?? 0) > 0;
}

/** Every server module some web module declared: what a host standing in for the server runs. */
export function declaredServerModules(): string[] {
  return [...new Set([...gates.values(), ...runtimeGates.values()].flat())];
}

/** Whether the contributions of the web module named `from` are drawn now. */
export function contributionShown(from: string): boolean {
  const needs = gates.get(from) ?? runtimeGates.get(from);
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

/** `Component`, drawn only while `from` is shown (always, for a module that declares nothing). */
export function gatedComponent<P extends object>(
  from: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  return function Gated(props: P) {
    return useContributionShown(from) ? createElement(Component, props) : null;
  };
}

const warned = new Set<string>();

/** Says once, on the console, that a gated module's contribution to `slot` is not mounted. */
export function warnUngatable(from: string, slot: string): void {
  const key = `${from}\0${slot}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `${from} declares a server module, so its ${slot} contribution is not mounted: it would wrap everything below it, which turning it on and off would remount`,
  );
}
