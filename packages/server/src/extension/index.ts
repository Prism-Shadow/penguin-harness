/**
 * The harness's extension surface — the `@prismshadow/penguin-server/extension` subpath.
 *
 * The contract itself lives in `@prismshadow/penguin-core/extension`; what this module adds
 * is the harness's own members, contributed by AUGMENTING that contract rather than by
 * redeclaring it. Core names nothing it cannot reach, this layer names what it owns, and
 * an extension sees one `PenguinContext` either way.
 *
 * Re-exported here so an extension package has one import site for every half.
 */
import type { TerminalManager } from "../terminal/manager.js";
import type { SandboxControl, SandboxProviderRegistry } from "../sandbox/types.js";

declare module "@prismshadow/penguin-core/extension" {
  interface PenguinContext {
    terminals: TerminalManager;
    /** The sandbox config surface (see {@link SandboxControl}). */
    sandbox: SandboxControl;
  }
  interface PenguinInterface {
    /** Sandbox backend registration (see {@link SandboxProviderRegistry}). */
    sandbox: SandboxProviderRegistry;
  }
}

export type {
  Disposable,
  PenguinContext,
  PenguinInterface,
  Extension,
  ExtensionContext,
  ExtensionEvents,
  ToolFactory,
  WorkflowFactory,
  WorkflowInstance,
  WorkflowInstances,
} from "@prismshadow/penguin-core/extension";
export type {
  ConfinedArgv,
  ConfinedSandboxMode,
  RunnerFailureRule,
  SandboxControl,
  SandboxDimension,
  SandboxEnforcement,
  SandboxMode,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderRegistry,
  SandboxProviderSource,
  SandboxSettings,
} from "../sandbox/types.js";
