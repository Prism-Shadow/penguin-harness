/**
 * `@prismshadow/penguin-server/plugin` — the surface a PLUGIN PACKAGE compiles against.
 *
 * Types only, deliberately: a plugin package depends on this for its shape and carries
 * NO runtime dependency on the harness, so a plugin is a self-contained library that
 * happens to satisfy an interface. Plugins are configuration (see plugins/loader.ts) —
 * they are not part of the platform bundle and are not delivered by a hot push;
 * installing or upgrading one is an install-side action.
 *
 * A plugin package's DEFAULT EXPORT is its {@link RawPlugin}.
 */
export type {
  PenguinContext,
  PenguinInterface,
  RawPlugin,
  ToolFactory,
  WorkflowFactory,
  WorkflowInstance,
  WorkflowInstances,
} from "./hmr/plugin.js";
