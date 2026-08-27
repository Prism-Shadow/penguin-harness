/**
 * The extension contract: what an extension package compiles against.
 *
 * Types only — the host that drives them lives in whatever embeds this SDK (for the
 * harness, `@prismshadow/penguin-server/extension`). An extension reaches this module with
 * `import type`, so it carries no runtime dependency on either and stays a
 * self-contained library that happens to satisfy an interface.
 *
 * An extension is a module exporting one function:
 *
 *   export function activate(ctx: ExtensionContext): void
 *
 * It runs once per process at load time, before any App exists. Everything after that
 * is events ({@link ExtensionEvents}), both fired at EVERY App creation — the packaged
 * boot and each hot-swap boot alike:
 *
 *   - `"initialize"` — {@link PenguinInterface}, the harness's DEFINITION view, where
 *     factories are registered.
 *   - `"create"` — {@link PenguinContext}, an INSTANCE of the harness, assembled after
 *     registration closes.
 *
 * `on(...)` and `ctx.disposables` are sealed when `activate` returns: handlers run per
 * App, so subscribing from inside one would accumulate a copy per hot swap. Sealing
 * turns that slow leak into a loud error at the packaged boot.
 *
 * {@link PenguinContext} and {@link PenguinInterface} are CLOSED. They name every member
 * an extension may rely on, and are not reopened by declaration merging: an embedder that
 * augmented this module would put members into the contract that only its own build has,
 * so an extension type-checking against the contract would compile against a surface that
 * the next embedder does not provide — and nothing at this layer could tell.
 *
 * An embedder with more to offer declares its own interface EXTENDING these and hands that
 * in; reaching those extra members is then an explicit cast at the point of use, which is
 * the honest cost of depending on one embedder (see the harness's `HarnessContext`).
 */

import type { SandboxControl, SandboxProviderRegistry } from "./sandbox.js";
import type { WorkflowFactory, WorkflowInstances } from "./workflow.js";

export type { WorkflowFactory, WorkflowInstance, WorkflowInstances } from "./workflow.js";
export type * from "./sandbox.js";

/** A tool factory — RESERVED. The shape lands with the first extension-provided tool. */
export type ToolFactory = unknown;

/** An INSTANCE of the harness. Closed — see the module doc. */
export interface PenguinContext {
  /** Instances built from `iface.workflow`. */
  workflows: WorkflowInstances;
  /** Flips confinement for this instance (see {@link SandboxControl}). */
  sandbox: SandboxControl;
}

/** The DEFINITION view of the harness: factories by name. */
export interface PenguinInterface {
  /** A Map whose `set` REFUSES a duplicate name (see the harness's WorkflowFactories). */
  workflow: Map<string, WorkflowFactory>;
  /** RESERVED (see {@link ToolFactory}). */
  tool: Map<string, ToolFactory>;
  /** Sandbox backend registration (see {@link SandboxProviderRegistry}). */
  sandbox: SandboxProviderRegistry;
}

/**
 * Event name → payload, the one place the vocabulary lives: adding an entry types the
 * platform's emit and every extension's handler at once.
 */
export interface ExtensionEvents {
  initialize: PenguinInterface;
  create: PenguinContext;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

/**
 * What `activate` receives — process-level, NOT the harness instance (that is
 * {@link PenguinContext}, delivered by `"create"`).
 */
export interface ExtensionContext {
  /**
   * Callable only while `activate` runs. Handlers are delivered synchronously and
   * unwrapped — a throwing handler fails that App's boot. A handler must NOT be async:
   * an App is assembled synchronously around the emit, so a promise could not be awaited
   * and its rejection would escape as an unhandled one. Returning a thenable is refused
   * at delivery.
   */
  on<E extends keyof ExtensionEvents>(
    event: E,
    handler: (payload: ExtensionEvents[E]) => void,
  ): void;
  /** Cleanup, disposed concurrently — entries must be mutually independent. */
  disposables: Disposable[];
}

export interface Extension {
  /**
   * May be async: loading awaits it, so a rejection is an ordinary load failure and the
   * subscription window does not seal until it settles. Event handlers, by contrast, are
   * synchronous — see {@link ExtensionContext.on}.
   */
  activate(ctx: ExtensionContext): void | Promise<void>;
}
