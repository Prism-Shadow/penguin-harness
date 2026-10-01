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
export function resolveLibraryPlugins(names: readonly string[], root: string): LibraryPlugin[] {
  return names.map((name) => {
    const plugin = libraryPlugin(name, root);
    if (!plugin) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${name}`);
    }
    return plugin;
  });
}

/** A skill as the API describes it — the library side, the installed side and the directory side all carry these fields. `icon` travels when the caller passes one: installed lists do, the library listing does not (see toPluginItem). */
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
    ...(manifest.user_prompt.length > 0 ? ["user_prompt"] : []),
    ...(manifest.pre_tool_use.length > 0 ? ["pre_tool_use"] : []),
    ...(manifest.stop.length > 0 ? ["stop"] : []),
  ];
}

/** An installed hook package as the API describes it: the manifest without its scripts, plus the icon installed beside it. */
export function toHookItem(hook: HookManifest & { icon?: string }): HookItem {
  return {
    name: hook.name,
    description: hook.description,
    ...(hook.description_zh !== undefined ? { descriptionZh: hook.description_zh } : {}),
    version: hook.version,
    events: hookEvents(hook),
    ...(hook.icon !== undefined ? { icon: hook.icon } : {}),
  };
}

/**
 * Everything a plugin ships as files the detail view can open, keyed by path relative to the
 * plugin directory: each skill's installable SKILL.md (frontmatter stamped, what an install
 * writes) and its auxiliary files under `skills/<name>/`, then the hook package's scripts
 * under `hooks/`.
 */
export function pluginFiles(plugin: LibraryPlugin): Record<string, string> {
  const files: Record<string, string> = {};
  for (const skill of plugin.skills) {
    files[`skills/${skill.name}/SKILL.md`] = skill.content;
    for (const [rel, text] of Object.entries(skill.files ?? {})) {
      files[`skills/${skill.name}/${rel}`] = text;
    }
  }
  for (const [rel, text] of Object.entries(plugin.hooks?.files ?? {})) {
    files[`hooks/${rel}`] = text;
  }
  return files;
}

/**
 * Everything a plugin ships as the files of an installable archive, keyed by path relative to
 * the plugin directory — the export side of the import routes, and the inverse of
 * readPluginDir: `plugin.json` regenerated from the loaded manifest (the library is what knows
 * the plugin's identity — description, version, category, preinstall, and the hook command
 * lists that plugin.json declares), the icon, then the same skill and hook files the file
 * browser shows. So an export round-trips through an import, whichever source the plugin came
 * from, and a file the library does not read (a README beside the manifest, the npm
 * `package.json` a built-in carries) is not part of the archive: it is not part of the plugin
 * as this installation holds it.
 */
export function pluginArchiveFiles(plugin: LibraryPlugin): Record<string, string> {
  const manifest: Record<string, unknown> = {
    description: plugin.description,
    ...(plugin.descriptionZh !== undefined ? { description_zh: plugin.descriptionZh } : {}),
    ...(plugin.shortDescription !== undefined
      ? { short_description: plugin.shortDescription }
      : {}),
    ...(plugin.shortDescriptionZh !== undefined
      ? { short_description_zh: plugin.shortDescriptionZh }
      : {}),
    version: plugin.version,
    ...(plugin.category !== undefined ? { category: plugin.category } : {}),
    preinstall: plugin.preinstall,
    ...(plugin.hooks !== undefined
      ? {
          hooks: {
            stop: plugin.hooks.manifest.stop,
            pre_tool_use: plugin.hooks.manifest.pre_tool_use,
            user_prompt: plugin.hooks.manifest.user_prompt,
          },
        }
      : {}),
  };
  return {
    "plugin.json": `${JSON.stringify(manifest, null, 2)}\n`,
    ...(plugin.icon !== undefined ? { "icon.svg": plugin.icon } : {}),
    ...pluginFiles(plugin),
  };
}

/** A library plugin as the listing describes it. Its skills go without their icon: it is the plugin's, sent once on the plugin itself. */
export function toPluginItem(plugin: LibraryPlugin): PluginItem {
  return {
    name: plugin.name,
    source: plugin.source,
    description: plugin.description,
    ...(plugin.descriptionZh !== undefined ? { descriptionZh: plugin.descriptionZh } : {}),
    ...(plugin.shortDescription !== undefined ? { shortDescription: plugin.shortDescription } : {}),
    ...(plugin.shortDescriptionZh !== undefined
      ? { shortDescriptionZh: plugin.shortDescriptionZh }
      : {}),
    version: plugin.version,
    skills: plugin.skills.map(({ icon: _icon, ...skill }) => toSkillItem(skill)),
    hooks: plugin.hooks ? hookEvents(plugin.hooks.manifest) : [],
    ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
  };
}
