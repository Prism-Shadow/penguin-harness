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
 * {@link PenguinContext} and {@link PenguinInterface} are OPEN: an embedder contributes
 * the members it owns by augmenting this module, which is why the harness's terminals
 * are not named here. Each layer declares what it actually provides, and no layer has
 * to be reachable from this one.
 */

import type { WorkflowFactory, WorkflowInstances } from "./workflow.js";

export type { WorkflowFactory, WorkflowInstance, WorkflowInstances } from "./workflow.js";

/** A tool factory — RESERVED. The shape lands with the first extension-provided tool. */
export type ToolFactory = unknown;

/** An INSTANCE of the harness. Members an embedder owns flatten on by augmentation. */
export interface PenguinContext {
  /** Instances built from `iface.workflow`. */
  workflows: WorkflowInstances;
}

/** The DEFINITION view of the harness: factories by name. */
export interface PenguinInterface {
  /** A Map whose `set` REFUSES a duplicate name (see the harness's WorkflowFactories). */
  workflow: Map<string, WorkflowFactory>;
  /** RESERVED (see {@link ToolFactory}). */
  tool: Map<string, ToolFactory>;
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
