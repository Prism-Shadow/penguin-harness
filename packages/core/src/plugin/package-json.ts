/**
 * A plugin's `package.json` carries npm's own fields only: `name`, `version`, `description`,
 * `keywords`, `author`, `homepage`, `repository`, `license` (and `files`, `scripts`, the
 * dependencies, `publishConfig`, an entry for a package with code — none of them read here).
 * What the package carries for an Agent, and how its card looks, are contributions of its module
 * (./library.ts), read from its generated `ifaces.json` (./table.ts, ./contributions.ts).
 *
 * parsePackageJson is the one reader of those fields every surface goes through — the library,
 * the check an uploaded or a local package passes, the server's listing. It refuses only what
 * makes a package unusable: no valid npm name, a name whose unscoped part is not a plugin name, no
 * release version. Everything else that is malformed is dropped with a warning naming the key, so
 * a package written elsewhere lists with the field missing rather than not at all — and a missing
 * field stays missing: the UI says so; nothing is invented. Keys npm does not define are not read
 * (a retired `penguin` block among them).
 */
import fs from "node:fs";
import path from "node:path";

/** Character rule for plugin, skill and hook names (directory names): prevents path traversal (exported for the server's archive-install validation). */
export const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Dated version format: a dotted date and a sequence number, e.g. `2026.08.29.1`. What every library skill and hook package must carry. */
export const PLUGIN_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

/** An npm package name, `name` or `@scope/name`: lower case, URL-safe (npm's own rule for new packages). */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** npm refuses longer names. */
const MAX_NPM_NAME_LENGTH = 214;

/** A release version: `1.2.3`, with an optional pre-release and build tag. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A plugin's package.json, read and checked: npm's fields. */
export interface NpmPackage {
  /** The npm name: `@scope/name` or `name`. */
  name: string;
  /** The unscoped part of the name: what the library lists the plugin under. */
  pluginName: string;
  /** The release version (semver): the plugin's own version. */
  version: string;
  /** English one-liner; "" when the package carries none. */
  description: string;
  keywords: string[];
  /** The author's name: the string form without its `<email>` and `(url)`, or `author.name`. */
  author?: string;
  homepage?: string;
  /** The repository's URL: the string form, or `repository.url`. */
  repository?: string;
  /** `repository.directory`, kept apart from the URL: where in the repository the package sits. */
  repositoryDirectory?: string;
  license?: string;
}

/** A package.json that makes the package unusable as a plugin, naming the file. */
export class PluginManifestError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "PluginManifestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The plugin name a package is listed under: its npm name without the scope. */
export function unscopedPackageName(packageName: string): string {
  return packageName.slice(packageName.lastIndexOf("/") + 1);
}

/** npm's people field as a name: `"Ann <a@b.c> (https://…)"` → `Ann`; `{ name }` → the name. */
function personName(value: unknown): string | null {
  const raw = isRecord(value) ? value.name : value;
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  return name === "" ? null : name;
}

/**
 * Reads a package.json's npm fields. Throws PluginManifestError only for what makes the package
 * unusable: not a JSON object, no valid npm `name`, an unscoped part that is not a plugin name, no
 * semver `version`. Everything else degrades, with a warning naming the key: a field of the wrong
 * type is dropped. A blank text field reads as absent.
 */
export function parsePackageJson(
  raw: unknown,
  file: string,
): { manifest: NpmPackage; warnings: string[] } {
  if (!isRecord(raw)) throw new PluginManifestError(file, "package.json is not a JSON object");
  const { name, version } = raw;
  if (
    typeof name !== "string" ||
    name.length > MAX_NPM_NAME_LENGTH ||
    !NPM_PACKAGE_NAME.test(name)
  ) {
    throw new PluginManifestError(
      file,
      "the package carries no valid npm name (`name` or `@scope/name`, lower case)",
    );
  }
  const pluginName = unscopedPackageName(name);
  if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new PluginManifestError(
      file,
      `${JSON.stringify(pluginName)} is not a plugin name (letters, digits, "_" and "-")`,
    );
  }
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new PluginManifestError(
      file,
      "the package carries no release version (`version`, such as 1.2.0)",
    );
  }

  const warnings: string[] = [];
  /** A text field: a string, or nothing (blank is nothing; another type is a warning). */
  const text = (value: unknown, key: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      warnings.push(`${key} must be a string; ignored`);
      return undefined;
    }
    return value.trim() === "" ? undefined : value;
  };

  let keywords: string[] = [];
  if (raw.keywords !== undefined) {
    if (Array.isArray(raw.keywords) && raw.keywords.every((k) => typeof k === "string")) {
      keywords = raw.keywords as string[];
    } else {
      warnings.push("keywords must be a list of strings; ignored");
    }
  }
  let author: string | undefined;
  if (raw.author !== undefined) {
    author = personName(raw.author) ?? undefined;
    if (author === undefined) warnings.push("author must be a name or { name }; ignored");
  }
  let repository: string | undefined;
  let repositoryDirectory: string | undefined;
  if (raw.repository !== undefined) {
    if (isRecord(raw.repository)) {
      repository = text(raw.repository.url, "repository.url");
      repositoryDirectory = text(raw.repository.directory, "repository.directory");
    } else {
      repository = text(raw.repository, "repository");
    }
  }
  const description = text(raw.description, "description") ?? "";
  const homepage = text(raw.homepage, "homepage");
  const license = text(raw.license, "license");

  return {
    manifest: {
      name,
      pluginName,
      version,
      description,
      keywords,
      ...(author !== undefined ? { author } : {}),
      ...(homepage !== undefined ? { homepage } : {}),
      ...(repository !== undefined ? { repository } : {}),
      ...(repositoryDirectory !== undefined ? { repositoryDirectory } : {}),
      ...(license !== undefined ? { license } : {}),
    },
    warnings,
  };
}

/**
 * Reads a package directory's package.json and parses it (parsePackageJson). A missing or
 * unparseable file is a PluginManifestError like any other unusable manifest.
 */
export function readPackageJson(dir: string): { manifest: NpmPackage; warnings: string[] } {
  const file = path.join(dir, "package.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    throw new PluginManifestError(
      file,
      missing ? "the package has no package.json" : "package.json is not valid JSON",
    );
  }
  return parsePackageJson(raw, file);
}
