/**
 * Library lookups shared by every surface that installs from the built-in plugin library —
 * the plugins route's install and Agent creation's seed list — plus the projections from
 * library and installed shapes onto the wire types. Names are resolved as a whole batch
 * before a single file is written, so an unknown name leaves nothing half-installed.
 *
 * The projections are allowlists rather than strip-these spreads, so a field added to the
 * library types is withheld from the API until someone adds it here on purpose; skill bodies
 * and hook scripts never travel in a listing.
 */
import { libraryPlugin } from "@prismshadow/penguin-core";
import type { HookManifest, LibraryPlugin, SkillMetadata } from "@prismshadow/penguin-core";
import type { HookItem, PluginItem, SkillMetadataItem } from "../api/types.js";
import { HttpError } from "../http/errors.js";

/**
 * Resolves library plugin names to their entries, in the order given. Throws 404
 * `unknown_plugin` on the first name the library does not carry — the caller is expected to
 * run this before it creates or writes anything.
 */
export function resolveLibraryPlugins(names: readonly string[]): LibraryPlugin[] {
  return names.map((name) => {
    const plugin = libraryPlugin(name);
    if (!plugin) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${name}`);
    }
    return plugin;
  });
}

/** A skill as the API describes it — the library side, the installed side and the directory side all carry these fields. */
export function toSkillItem(skill: SkillMetadata & { icon?: string }): SkillMetadataItem {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
    ...(skill.shortDescriptionZh !== undefined
      ? { shortDescriptionZh: skill.shortDescriptionZh }
      : {}),
    ...(skill.icon !== undefined ? { icon: skill.icon } : {}),
    version: skill.version,
  };
}

/** The hook points a manifest answers at, in a fixed order. */
export function hookEvents(manifest: HookManifest): string[] {
  return [
    ...((manifest.user_prompt?.length ?? 0) > 0 ? ["user_prompt"] : []),
    ...((manifest.pre_tool_use?.length ?? 0) > 0 ? ["pre_tool_use"] : []),
    ...(manifest.stop.length > 0 ? ["stop"] : []),
  ];
}

/** An installed hook package as the API describes it: the manifest without its scripts. */
export function toHookItem(hook: HookManifest): HookItem {
  return {
    name: hook.name,
    description: hook.description,
    ...(hook.descriptionZh !== undefined ? { descriptionZh: hook.descriptionZh } : {}),
    version: hook.version,
    events: hookEvents(hook),
  };
}

/** A library plugin as the listing describes it. */
export function toPluginItem(plugin: LibraryPlugin): PluginItem {
  const icon = plugin.icon ?? plugin.skills.find((s) => s.icon !== undefined)?.icon;
  return {
    name: plugin.name,
    description: plugin.description,
    ...(plugin.descriptionZh !== undefined ? { descriptionZh: plugin.descriptionZh } : {}),
    ...(plugin.shortDescription !== undefined ? { shortDescription: plugin.shortDescription } : {}),
    ...(plugin.shortDescriptionZh !== undefined
      ? { shortDescriptionZh: plugin.shortDescriptionZh }
      : {}),
    version: plugin.version,
    preinstall: plugin.preinstall,
    skills: plugin.skills.map(toSkillItem),
    hooks: plugin.hooks ? hookEvents(plugin.hooks.manifest) : [],
    ...(icon !== undefined ? { icon } : {}),
  };
}
