/**
 * The record of the preinstalled built-in modules (PRFC-0030) this server has handled for each
 * Project: listed in that Project's own table once, or passed over for good — the administrator
 * had stopped the module, or the Project's config would not parse. A Project with no row for a
 * package gets the one-time listing at the next boot; one with a row never does again, so an
 * administrator's later removal of the listing stands.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** PluginModulePreinstalls: the mechanism PluginModulePreinstallsRepo implements. */
@Interface()
export abstract class PluginModulePreinstalls {
  /** The Projects already handled for `pkg`. */
  abstract projectsOf(pkg: string): string[];
  /** Records `projectIds` as handled for `pkg`; a pair already recorded keeps its time. */
  abstract record(pkg: string, projectIds: readonly string[], at: string): void;
}
