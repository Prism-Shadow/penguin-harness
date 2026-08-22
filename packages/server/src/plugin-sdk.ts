/**
 * `@prismshadow/penguin-server/plugin` — the surface a PLUGIN PACKAGE compiles against.
 *
 * Types only, deliberately: a plugin package depends on this for its shape and carries
 * NO runtime dependency on the harness, so a plugin is a self-contained library that
 * happens to satisfy an interface. Plugins are configuration (see plugin/loader.ts) —
 * they are not part of the platform bundle and are not delivered by a hot push;
 * installing or upgrading one is an install-side action.
 *
 * A plugin package exports one named function, its {@link Plugin}: `activate(ctx)`.
 */
export type {
  Disposable,
  PenguinContext,
  PenguinInterface,
  Plugin,
  PluginContext,
  PluginEvents,
  ToolFactory,
} from "./plugin/index.js";
export type { WorkflowFactory, WorkflowInstance, WorkflowInstances } from "./plugin/workflow.js";
