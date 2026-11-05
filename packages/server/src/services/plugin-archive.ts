/**
 * A plugin package as a zip, both ways: what an admin uploads to install a plugin on the server,
 * and what Export downloads. The zip holds the package directory as npm has it — `package.json`
 * at its root, or inside exactly one top-level directory — without `node_modules/`, which an
 * install resolves.
 *
 * On the way in nothing is trusted that has not been checked: the caps are read from the
 * central directory before a byte inflates (as the Skill archive's are), every path is
 * zip-slip-checked, and the package must be a built plugin: its `ifaces.json` (penguin-gen-ifaces
 * writes it) contributes Skills, a hook package, MCP servers or workbenches that the library would
 * read as they are (checked with the library's own reader), or lists server modules with a code
 * entry (core plugin/kinds.ts). Installing it is then npm's (plugin/install.ts).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync, zipSync } from "fflate";
import {
  PLUGIN_NAME_PATTERN,
  libraryParts,
  readLibraryPackage,
  readPluginTable,
} from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { PACKAGE_NAME } from "../plugin/loader.js";
import { assertSafeEntryPath } from "./skill-import-limits.js";

/** Decoded zip cap: the Skill archive's, which stays within the 20MB body limit after base64. */
export const MAX_PLUGIN_ARCHIVE_BYTES = 14 * 1024 * 1024;
/** A built package (dist/, type declarations, source maps) holds far more files than a Skill. */
export const MAX_PLUGIN_ARCHIVE_FILES = 2000;
export const MAX_PLUGIN_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PLUGIN_TOTAL_BYTES = 50 * 1024 * 1024;

/** A release version: `1.2.3`, with an optional pre-release and build tag. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function pluginTooLarge(): HttpError {
  return new HttpError(
    413,
    "plugin_too_large",
    `The plugin package exceeds the archive limits (${MAX_PLUGIN_ARCHIVE_FILES} files, 5MB per file, 50MB in all, a 14MB zip).`,
  );
}

const invalid = (message: string) => new HttpError(400, "plugin_archive_invalid", message);

/** A package name without its scope: the plugin name the library lists it under. */
export function unscopedName(packageName: string): string {
  return packageName.slice(packageName.lastIndexOf("/") + 1);
}

/** An uploaded package, checked: what it is, and its files relative to the package directory. */
export interface PluginArchive {
  name: string;
  version: string;
  files: Map<string, Uint8Array>;
  /** It contributes Skills, a hook package, MCP servers or workbenches (the library lists it). */
  library: boolean;
  /** It carries server modules (a Project's plugin list loads it). */
  modules: boolean;
}

/**
 * `unzipSync` bounded by the plugin caps, read from each entry's declared size before it inflates.
 * A directory entry is turned away before them: it carries no content, yet fflate inflates whatever
 * bytes an accepted entry holds, so it is never inflated, never returned and counts towards nothing.
 */
function unzipBounded(archive: Uint8Array): Record<string, Uint8Array> {
  let files = 0;
  let declared = 0;
  return unzipSync(archive, {
    filter: ({ name, originalSize }) => {
      if (name.endsWith("/")) return false;
      files += 1;
      declared += originalSize;
      if (
        files > MAX_PLUGIN_ARCHIVE_FILES ||
        originalSize > MAX_PLUGIN_FILE_BYTES ||
        declared > MAX_PLUGIN_TOTAL_BYTES
      ) {
        throw pluginTooLarge();
      }
      return true;
    },
  });
}

/**
 * Decodes and checks an uploaded plugin zip. Refuses (400 `plugin_archive_invalid`, saying why)
 * a corrupt or empty zip, a path leaving the package, `node_modules/`, a `.npmrc`, a layout without
 * package.json at the top, a package.json without a valid npm name — whose unscoped part is a
 * plugin name — or release version, and a package that is not a plugin or that the library
 * would not read; 413 `plugin_too_large` over the caps.
 */
export async function parsePluginArchive(archive: Uint8Array): Promise<PluginArchive> {
  if (archive.byteLength === 0) throw invalid("The zip archive is empty.");
  if (archive.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) throw pluginTooLarge();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(archive);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw invalid("The upload is not a valid zip archive.");
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw invalid("The zip archive contains no files.");
  for (const [name] of files) {
    try {
      assertSafeEntryPath(name);
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : String(err));
    }
    if (name.split("/").includes("node_modules")) {
      throw invalid(
        `node_modules is not part of a plugin package — installing it resolves the dependencies: ${name}`,
      );
    }
    // npm reads a .npmrc in the directory it runs in, and the package is packed in its own:
    // one in the zip would configure npm on the server. npm never packs one into a package.
    if (name.split("/").at(-1) === ".npmrc") {
      throw invalid(
        `.npmrc is not part of a plugin package — it would configure npm on the server: ${name}`,
      );
    }
  }
  const names = files.map(([name]) => name);
  let prefix = "";
  if (!names.includes("package.json")) {
    const tops = new Set(names.map((name) => name.split("/", 1)[0]!));
    const dir = tops.size === 1 ? [...tops][0]! : undefined;
    if (dir === undefined || !names.includes(`${dir}/package.json`)) {
      throw invalid(
        "The zip must contain package.json at its root, or exactly one top-level directory containing it.",
      );
    }
    prefix = `${dir}/`;
  }
  const rel = new Map<string, Uint8Array>();
  for (const [name, data] of files) {
    const at = name.slice(prefix.length);
    // A file named like the top-level directory leaves nothing once the prefix is off.
    if (at === "") throw invalid(`Invalid zip entry path (names a directory): ${name}`);
    rel.set(at, data);
  }

  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(strFromU8(rel.get("package.json")!)) as typeof manifest;
  } catch {
    throw invalid("package.json is not valid JSON.");
  }
  const name = manifest.name;
  if (typeof name !== "string" || !PACKAGE_NAME.test(name)) {
    throw invalid(
      "package.json must name the package with a valid npm name (`name` or `@scope/name`).",
    );
  }
  if (!PLUGIN_NAME_PATTERN.test(unscopedName(name))) {
    throw invalid(
      `${JSON.stringify(name)} is not a plugin name: letters, digits, "_" and "-" only.`,
    );
  }
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
    throw invalid("package.json must carry a release version such as 1.2.0.");
  }

  const { library, modules } = await checkWithLibrary(rel);
  return { name, version: manifest.version, files: rel, library, modules };
}

/**
 * Reads a package the way the server will once it is installed (a temp copy, removed after): its
 * table must be there (the package was built), and what kind of plugin it is follows from it; a
 * library plugin is read with the library's own reader. What the reader refuses is refused here,
 * naming the file inside the package; what it reads with a warning, it lists with that field
 * missing.
 */
async function checkWithLibrary(
  files: ReadonlyMap<string, Uint8Array>,
): Promise<{ library: boolean; modules: boolean }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-check-"));
  const inPackage = (err: unknown) =>
    invalid(
      (err instanceof Error ? err.message : String(err))
        .split(dir + path.sep)
        .join("")
        .split(dir)
        .join("."),
    );
  try {
    for (const [rel, bytes] of files) {
      const file = path.join(dir, ...rel.split("/"));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    }
    let table: ReturnType<typeof readPluginTable>;
    try {
      table = readPluginTable(dir);
    } catch (err) {
      throw inPackage(err);
    }
    if (table === null) {
      throw invalid(
        "The package has no ifaces.json: build it first (its build runs penguin-gen-ifaces), then zip the built package.",
      );
    }
    const parts = libraryParts(dir);
    const library = parts.skills || parts.hooks || parts.mcp || parts.workbenches;
    if (!library && !parts.modules) {
      throw invalid(
        "Not a PenguinHarness plugin: its ifaces.json contributes no Skills, hook package, MCP servers or workbenches, and lists no server modules with a code entry.",
      );
    }
    if (library) {
      try {
        readLibraryPackage(dir);
      } catch (err) {
        throw inPackage(err);
      }
    }
    return { library, modules: parts.modules };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * A package directory as the zip Export downloads: every regular file under a single top-level
 * `<rootName>/` directory, `node_modules/` and `.git/` left out, symlinks skipped. The import
 * caps hold on the way out — a package past them could not be imported back (413).
 */
export async function zipPluginPackage(dir: string, rootName: string): Promise<Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;
  const walk = async (at: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(at, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const child = path.join(at, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, childRel);
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(child);
        count += 1;
        total += bytes.byteLength;
        if (
          count > MAX_PLUGIN_ARCHIVE_FILES ||
          bytes.byteLength > MAX_PLUGIN_FILE_BYTES ||
          total > MAX_PLUGIN_TOTAL_BYTES
        ) {
          throw pluginTooLarge();
        }
        out[`${rootName}/${childRel}`] = new Uint8Array(bytes);
      }
    }
  };
  await walk(dir, "");
  const zip = zipSync(out);
  if (zip.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) throw pluginTooLarge();
  return zip;
}

/** The download: the zip as an attachment named `<name>-v<version>.zip` (`<name>.zip` without a version). */
export function pluginArchiveResponse(
  zip: Uint8Array,
  packageName: string,
  version: string,
): Response {
  const name = unscopedName(packageName);
  const fileName = version === "" ? `${name}.zip` : `${name}-v${version}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
