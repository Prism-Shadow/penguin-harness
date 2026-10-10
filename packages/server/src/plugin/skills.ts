/**
 * Contributed skills: a plugin that carries code (a package with a generated `ifaces.json`)
 * DECLARES the skill directories it ships as a contribution — pure manifest data, the
 * `PluginConfigProvider.groups` discipline, listed and checked without running the package —
 * and once the plugin is enabled (its package is in the closure: any Project's `[plugins]`
 * lists it), those skills are installable onto an Agent through the very install the plugin
 * library uses: the same route, the same `installSkill` writer, the same runtime
 * invalidation after it. A plugin no Project lists contributes nothing: its skill
 * directories are neither listed nor installable, so an Agent is never left reaching for a
 * source a re-assembly could silently revive.
 *
 * The declaration names a directory INSIDE the plugin's own package:
 *
 *   @Component({
 *     contributes: {
 *       "PluginSkillsProvider.skills": [
 *         { id: "example-music.send-music", path: "skills/send-music" },
 *       ],
 *     },
 *   })
 *
 * The path is relative to the package root and checked to stay inside it. The skill's name is
 * the directory's own last segment — the library's rule: the directory is the identity, its
 * spelling `PLUGIN_NAME_PATTERN` — and its metadata comes from that directory's SKILL.md
 * frontmatter alone: a code plugin has no plugin.json to stamp a version or an icon from.
 * The files are read from the package on disk, fresh on every call like the library's are, so
 * a re-activation is followed by the next read with nothing to expire.
 *
 * Failure is per entry and non-fatal, the loader's discipline: a contribution whose module
 * has no plugin package behind it, a path that escapes the package, a directory that is
 * missing or whose SKILL.md does not parse — each is reported and skipped, leaving the rest
 * installable rather than failing anything. (A declaration the slot's own type refuses — a
 * `path` that is not a string — never reaches here: the tree check drops it at boot, the
 * `bad-contribution` discipline of plugin/unsatisfied.ts.)
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  PLUGIN_NAME_PATTERN,
  parseSkillFrontmatter,
  type SkillMetadata,
} from "@prismshadow/penguin-core";
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import type { Config, Hmr } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { LoadedPlugin } from "./host.js";
import { pluginHostFrom } from "./host.js";
import { pluginBases, resolvePluginPackage } from "./loader.js";

/** What one contribution to the skills slot declares: a directory inside the plugin's package. */
export interface PluginSkillDecl {
  /** The skill directory, relative to the package root (POSIX separators, within the package). */
  path: string;
}

export interface PluginSkillsSlots {
  /**
   * A skill directory the plugin ships, as data: the contribution's id names it, its `path`
   * locates it inside the package.
   */
  skills: Slot<PluginSkillDecl>;
}

/** One skill an enabled code plugin declares, with its installable payload — `installSkill` takes it unchanged. */
export interface ContributedSkill extends SkillMetadata {
  /** SKILL.md verbatim, written as-is on install. */
  content: string;
  /** The skill directory's own icon.svg, when it ships one; a code plugin has no plugin icon to stamp instead. */
  icon?: string;
  /** Auxiliary files keyed POSIX-relative to the skill directory, installed alongside SKILL.md. */
  files?: Record<string, string>;
}

/** An enabled code plugin and the skills it declared on the slot. */
export interface ContributedPlugin {
  /** The package specifier — the name the install route takes. */
  specifier: string;
  skills: ContributedSkill[];
}

/** A skill as the installable list carries it: its metadata, no body and no auxiliary payload. */
export type ContributedSkillMeta = SkillMetadata & { icon?: string };

/** What a module reads: the skills the enabled code plugins declared, installable like the library's. */
@Interface()
export abstract class PluginSkills {
  /**
   * Every enabled code plugin that declares skills, in load order, each with its skills'
   * metadata — the installable list. A plugin whose every declaration was skipped is not in
   * it: nothing it declared can be installed.
   */
  abstract list(): Promise<ReadonlyArray<{ specifier: string; skills: ContributedSkillMeta[] }>>;
  /**
   * Resolves package specifiers to the skills they declare, with the installable payload, in
   * the order given. Everything is read before the caller writes anything; a name no enabled
   * code plugin answers to throws 404 `unknown_plugin` — the install route's
   * "not installable here", the library resolution's own contract.
   */
  abstract resolve(names: readonly string[]): Promise<ContributedPlugin[]>;
}

/** Whether a declared path stays inside the package: no drive letters or roots, no backslashes, no empty or `..` segments. */
function staysInsidePackage(decl: string): boolean {
  return (
    decl.length > 0 &&
    !path.isAbsolute(decl) &&
    !decl.includes("\\") &&
    !decl.split("/").some((segment) => segment === "" || segment === "..")
  );
}

/**
 * The package directory behind a loaded entry: the nearest package.json above the entry file
 * — the very bytes the process imported — with the current generation's resolution of the
 * name as the fallback for an entry that carries no file.
 */
function packageDirOf(entry: LoadedPlugin, root: string): { dir: string | null; why: string } {
  let dir = entry.file != null ? path.dirname(entry.file) : null;
  while (dir !== null) {
    if (existsSync(path.join(dir, "package.json"))) return { dir, why: "" };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const resolved = resolvePluginPackage(entry.specifier, pluginBases(root));
  if (resolved !== null) return { dir: resolved.dir, why: "" };
  return {
    dir: null,
    why: entry.file != null
      ? `no package.json above ${entry.file}, and the current plugin generation does not hold '${entry.specifier}'`
      : `the current plugin generation does not hold '${entry.specifier}'`,
  };
}

/**
 * The skill's auxiliary files, keyed relative to its directory — regular files only, the
 * library walk's discipline (a symlink is how a file outside the skill directory would
 * otherwise travel), SKILL.md and icon.svg excluded: the caller reads those by name.
 */
async function readAuxiliaryFiles(dir: string): Promise<Record<string, string> | undefined> {
  const files: Record<string, string> = {};
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const relChild = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(abs, entry.name), relChild);
        continue;
      }
      if (!entry.isFile()) continue;
      if (rel === "" && (entry.name === "SKILL.md" || entry.name === "icon.svg")) continue;
      files[relChild] = await fs.readFile(path.join(abs, entry.name), "utf8");
    }
  };
  await walk(dir, "");
  return Object.keys(files).length > 0 ? files : undefined;
}

/**
 * One declared skill as it sits in its package, or the reason it is not installable. The
 * directory's last segment is the skill's name (frontmatter only supplies display fields, the
 * library's rule); SKILL.md must parse; the auxiliary payload is read only when it is asked
 * for — a listing costs metadata, never every file the skill ships.
 */
async function readDeclaredSkill(
  dir: string,
  name: string,
  decl: string,
  withPayload: boolean,
): Promise<ContributedSkill | { skip: string }> {
  const skillDir = path.join(dir, ...decl.split("/"));
  const file = path.join(skillDir, "SKILL.md");
  let content: string;
  try {
    content = await fs.readFile(file, "utf8");
  } catch {
    return { skip: `no readable SKILL.md at ${path.posix.join(decl, "SKILL.md")}` };
  }
  const metadata = parseSkillFrontmatter(content);
  if (metadata === null) {
    return { skip: `${path.posix.join(decl, "SKILL.md")} has no frontmatter with a name` };
  }
  let icon: string | undefined;
  try {
    icon = await fs.readFile(path.join(skillDir, "icon.svg"), "utf8");
  } catch {
    // The skill ships its own icon or none; the book glyph covers the rest.
  }
  const files = withPayload ? await readAuxiliaryFiles(skillDir).catch(() => undefined) : undefined;
  return {
    ...metadata,
    name,
    content,
    ...(icon !== undefined ? { icon } : {}),
    ...(files !== undefined ? { files } : {}),
  };
}

/** One enabled plugin's declarations, in contribution order. */
interface DeclaredPackage {
  specifier: string;
  dir: string;
  declarations: Array<{ id: string; path: string; name: string }>;
}

/**
 * The store as a node: the declarations read off its slot at boot — the kernel has already
 * checked each entry against the slot's type — joined with the packages the process loaded,
 * and read from disk on every call.
 */
@Module()
export class PluginSkillsProvider {
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly config!: Config;
  @Provide() pluginSkills!: PluginSkills;

  setup({ contributions }: ClassCtx) {
    // The plugin packages behind the contributing modules: the host this process loaded,
    // claimed the way the installed-plugins route claims it — the same object across swaps.
    const host = pluginHostFrom(this.hmr.resources);
    const packageOf = new Map<string, { specifier: string; dir: string | null; why: string }>();
    for (const entry of host.entries().values()) {
      const found = packageDirOf(entry, this.config.root);
      for (const module of entry.modules) {
        packageOf.set(module.manifest.name, { specifier: entry.specifier, ...found });
      }
    }
    const packages: DeclaredPackage[] = [];
    const bySpecifier = new Map<string, DeclaredPackage>();
    for (const c of contributions.skills ?? []) {
      // The kernel checked the entry against the slot's type at boot: `path` is a string.
      const { path: decl } = c.data as unknown as PluginSkillDecl;
      const name = decl.split("/").at(-1) ?? "";
      const from = packageOf.get(c.from);
      const why =
        from === undefined
          ? `module '${c.from}' contributes skills but no loaded plugin package is behind it`
          : from.dir === null
            ? from.why
            : !staysInsidePackage(decl)
              ? `'${decl}' does not stay inside the package`
              : !PLUGIN_NAME_PATTERN.test(name)
                ? `'${decl}' does not end in a skill name (letters, digits, "_" and "-")`
                : null;
      if (why !== null) {
        // One malformed declaration drops that skill, not the plugin and not the boot.
        console.warn(`[plugin-skills] '${c.from}' contribution '${c.id}' skipped: ${why}`);
        continue;
      }
      const pkg =
        bySpecifier.get(from!.specifier!) ??
        (() => {
          const next: DeclaredPackage = { specifier: from!.specifier!, dir: from!.dir!, declarations: [] };
          bySpecifier.set(next.specifier, next);
          packages.push(next);
          return next;
        })();
      pkg.declarations.push({ id: c.id, path: decl, name });
    }
    /** The plugin's declared skills as they sit on disk, each unreadable one skipped with its reason. */
    const read = async (pkg: DeclaredPackage, withPayload: boolean): Promise<ContributedSkill[]> => {
      const skills: ContributedSkill[] = [];
      for (const declaration of pkg.declarations) {
        const read = await readDeclaredSkill(pkg.dir, declaration.name, declaration.path, withPayload);
        if ("skip" in read) {
          console.warn(
            `[plugin-skills] '${pkg.specifier}' skill '${declaration.id}' (${declaration.path}) skipped: ${read.skip}`,
          );
          continue;
        }
        skills.push(read);
      }
      return skills;
    };
    this.pluginSkills = {
      async list() {
        const out: Array<{ specifier: string; skills: ContributedSkillMeta[] }> = [];
        for (const pkg of packages) {
          const skills = (await read(pkg, false)).map(({ content: _c, files: _f, ...meta }) => meta);
          if (skills.length > 0) out.push({ specifier: pkg.specifier, skills });
        }
        return out;
      },
      async resolve(names) {
        const out: ContributedPlugin[] = [];
        for (const name of names) {
          const pkg = bySpecifier.get(name);
          if (pkg === undefined) {
            throw new HttpError(
              404,
              "unknown_plugin",
              `Plugin is not in the library and not an enabled code plugin: ${name}`,
            );
          }
          out.push({ specifier: name, skills: await read(pkg, true) });
        }
        return out;
      },
    };
  }
}
