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
import type { ModuleActor } from "@prismshadow/penguin-library-agent/types";
export type { ModuleActor } from "@prismshadow/penguin-library-agent/types";
import type { IndexChannel } from "../plugin/registry.js";

/**
 * PluginPackages: how plugin packages reach and leave the data root's npm prefix, as
 * NpmPluginPackages implements it (plugin/packages.ts) — with npm, or without it for a package
 * that needs nothing npm does on a machine that has none.
 */
@Interface()
export abstract class PluginPackages {
  /**
   * Asks the registry whether it has a name (`name`, `name@range`) before it is installed, within
   * a short window; throws npm's failure.
   */
  abstract check(root: string, spec: string): Promise<void>;
  /** A registry name (`name`, `name@range`) or a link npm fetches; answers which package that was. */
  abstract install(root: string, source: string): Promise<InstalledPackage>;
  /** An uploaded package's files, relative path → bytes (checked by the caller). */
  abstract installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage>;
  /** A package tarball already on this machine, verified by the caller (an offline archive). */
  abstract installTarball(root: string, file: string, name: string): Promise<InstalledPackage>;
  /** A version from the published index's release channel, its bytes verified against the entry's sha512. */
  abstract installChannel(
    root: string,
    channel: IndexChannel,
    opts?: { onProgress?: (received: number, total: number | null) => void },
  ): Promise<InstalledPackage>;
  abstract remove(root: string, name: string): Promise<void>;
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
  /**
   * Lists the preinstalled built-in modules (PRFC-0030, plugin/preinstall.ts) in this server's
   * own table of a Project just created, by the same rule with the system as the actor: one
   * write for all of them, and a re-assembly only when that changes the closure. A module the
   * administrator stopped is passed over. Called last by the creation, for the reason `ensure`
   * is. Never throws: what went wrong is a log line, and the Project stands.
   */
  abstract preinstall(projectId: string): Promise<void>;
  /**
   * A member's ask for a package that is not on this server yet (05 「插件库」 「安装模型」): a
   * request for the administrator, whose enable installs it on the server first. A standing
   * request is left as it is.
   */
  abstract askForPackage(
    projectId: string,
    pkg: string,
    actor: ModuleActor,
    agentId: string | null,
  ): Promise<PluginModuleAction[]>;
  /** The ledger, joined with each module's state. */
  abstract requests(): Promise<PluginModuleRequestsResponse>;
  /**
   * The administrator's enable or decline of one package; 404 `unknown_request` without a row,
   * 409 `project_gone` for an enable whose Project is gone. Declining an enabled module stops it:
   * it leaves this server's own table of every Project. Enabling a preinstalled module
   * (PRFC-0030) lists it in this server's own table of every Project again, whatever Project
   * its row names.
   */
  abstract decide(
    pkg: string,
    decision: "enable" | "decline",
    admin: ModuleActor,
  ): Promise<PluginModuleRequestsResponse>;
}
