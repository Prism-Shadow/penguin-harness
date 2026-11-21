/**
 * The plugin mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  PluginModuleAction,
  PluginModuleRequestsResponse,
  PluginModuleStatus,
} from "../api/types.js";
import type { InstalledPackage } from "../plugin/install.js";

/**
 * PluginPackages: how plugin packages reach and leave the data root's npm prefix, as
 * NpmPluginPackages implements it with npm (plugin/install.ts).
 */
@Interface()
export abstract class PluginPackages {
  /** A registry name (`name`, `name@range`) or a link npm fetches; answers which package that was. */
  abstract install(root: string, source: string): Promise<InstalledPackage>;
  /** An uploaded package's files, relative path → bytes (checked by the caller). */
  abstract installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage>;
  abstract remove(root: string, name: string): Promise<void>;
}

/** Who acts on a plugin's server module: a signed-in user, and whether that user is the administrator. */
export interface ModuleActor {
  userId: string;
  isAdmin: boolean;
}

/**
 * PluginModules: a library plugin's server modules, brought along when the plugin is installed on
 * an Agent (PRFC-0031), as services/plugin-modules.ts implements it. Everything it touches
 * survives a re-assembly — the files, the database, the channel hub and the plugin host claimed
 * per call — so a caller may still use it after `ensure` swapped the App.
 */
@Interface()
export abstract class PluginModules {
  /** Every library plugin that carries server modules, as it stands here and for this Project. */
  abstract status(projectId: string, viewer: ModuleActor): Promise<PluginModuleStatus[]>;
  /**
   * Applies the rule (plugin/module-rule.ts) to the named library plugins; a plugin without
   * server modules is passed over. `actor` null is the system: built-in modules only, and it
   * never asks. It may re-assemble the App, so a caller calls it last: after it, only what
   * survives a swap is still this generation's. Never while the App boots. Never throws for one
   * plugin: what went wrong is that plugin's `failed` action.
   */
  abstract ensure(
    projectId: string,
    plugins: readonly string[],
    actor: ModuleActor | null,
    ask: "install" | "explicit",
    agentId?: string,
  ): Promise<PluginModuleAction[]>;
  /** The ledger, joined with each module's state. */
  abstract requests(): Promise<PluginModuleRequestsResponse>;
  /**
   * The administrator's enable or decline of one package; 404 `unknown_request` without a row,
   * 409 `project_gone` for an enable whose Project is gone. Declining an enabled module stops it:
   * it leaves this server's own table of every Project.
   */
  abstract decide(
    pkg: string,
    decision: "enable" | "decline",
    admin: ModuleActor,
  ): Promise<PluginModuleRequestsResponse>;
}
