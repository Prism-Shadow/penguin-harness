/**
 * The Agent package format: which files of an Agent directory are its definition, how a
 * path becomes a gist file name, and how a set of gist files is read back as a package.
 *
 * Pure functions over paths and strings — the file system and the network live in
 * service.ts, so the rules that decide what is shared can be tested on their own.
 */
import { createHash } from "node:crypto";
import type { PackageFile, PackageManifest } from "../mechanisms/packages.js";

export const PACKAGE_FORMAT = 1;
export const MANIFEST_FILE = "penguin-agent.json";
/**
 * Path separator inside a gist file name. A gist has no directories, and its API refuses a
 * file name containing `/` outright (422) — but a backslash it accepts and stores verbatim,
 * so paths read as paths on the gist page and any other character, `-` included, stays part
 * of a name.
 */
export const PATH_SEP = "\\";
/** The separator packages published before the backslash used; still read, never written. */
export const LEGACY_PATH_SEP = "--";
/** Cap on one package (gist files are text; GitHub itself starts truncating around 1MB each). */
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;

/**
 * What a package carries, as prefixes inside the Agent directory. `agent_state` is the
 * Agent itself (system config, prompt, skills, tools); `workflows` is the code and pages
 * it wrote for itself. Everything else in the directory is state or scratch.
 */
const INCLUDED_PREFIXES = ["agent_state/", "workflows/"] as const;

/**
 * What never leaves, even under an included prefix:
 * - `.vault.toml` — the Agent's secrets (already excluded from snapshots).
 * - `agent_state/memory/` — what the Agent has learned; a package is a definition.
 * - `workflows/*` `state.json` — a workflow's data, not its code.
 * - dotfiles and `node_modules` — machine-local, and never part of the definition.
 */
export function isPackagedPath(rel: string): boolean {
  const p = rel.replaceAll("\\", "/");
  if (!INCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix))) return false;
  const segments = p.split("/");
  if (segments.some((s) => s.startsWith(".") || s === "node_modules")) return false;
  if (p.startsWith("agent_state/memory/")) return false;
  if (p.startsWith("workflows/") && segments.at(-1) === "state.json") return false;
  return true;
}

/** `agent_state/skills/a/SKILL.md` → `agent_state\skills\a\SKILL.md`. */
export function flattenPath(rel: string): string {
  return rel.replaceAll("\\", "/").split("/").join(PATH_SEP);
}

/** The same path as an older package would have named it (`--` between segments). */
export function legacyFlattenPath(rel: string): string {
  return rel.replaceAll("\\", "/").split("/").join(LEGACY_PATH_SEP);
}

/**
 * Whether a path can round-trip through a flattened gist file name. A backslash is the
 * separator, and every path this server produces uses `/`, so a name that carries a literal
 * backslash cannot be told from a nested path and is refused.
 */
export function isRoundTrippable(rel: string): boolean {
  if (rel.includes(PATH_SEP)) return false;
  return rel.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** A packaged path is safe to write: relative, no traversal, under an included prefix. */
export function isSafePackagePath(rel: string): boolean {
  const p = rel.replaceAll("\\", "/");
  if (p.startsWith("/") || p.includes("\0")) return false;
  return isRoundTrippable(p) && isPackagedPath(p);
}

/** Text files are stored verbatim so the gist is readable; anything else is base64. */
export function encodingFor(content: Buffer): "utf8" | "base64" {
  if (content.includes(0)) return "base64";
  const text = content.toString("utf8");
  return Buffer.compare(Buffer.from(text, "utf8"), content) === 0 ? "utf8" : "base64";
}

export function manifestOf(
  agentId: string,
  name: string,
  description: string,
  packagedBy: string,
  packagedAt: string,
  files: readonly PackageFile[],
): PackageManifest {
  return {
    format: PACKAGE_FORMAT,
    agentId,
    name,
    description,
    packagedBy,
    packagedAt,
    files: files.map(({ path, file, encoding }) => ({ path, file, encoding })),
  };
}

/**
 * The gist's title. GitHub shows a gist's description wherever it is listed, so this is the
 * line a person scanning their gists reads: the Agent's name, what it says about itself, and
 * a constant tail that marks the gist as an Agent package (and makes them searchable).
 */
export function gistDescription(manifest: Pick<PackageManifest, "name" | "description">): string {
  const summary = manifest.description.replace(/\s+/g, " ").trim();
  const short = summary.length > 100 ? `${summary.slice(0, 99)}…` : summary;
  const name = manifest.name.trim() === "" ? "Agent" : manifest.name.trim();
  return short === ""
    ? `${name} · PenguinHarness Agent`
    : `${name} — ${short} · PenguinHarness Agent`;
}

/**
 * What a publish would put on GitHub, as one hash: the title and every file's name and
 * content. Recorded with the gist, so a republish that would change nothing can say so
 * without calling the API at all.
 */
export function packageDigest(description: string, files: readonly PackageFile[]): string {
  const h = createHash("sha256").update(description).update("\0");
  for (const f of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
    h.update(f.file).update("\0").update(f.content).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** The gist body: the manifest plus one file per packaged path. */
export function gistFilesOf(
  manifest: PackageManifest,
  files: readonly PackageFile[],
): Record<string, { content: string }> {
  const out: Record<string, { content: string }> = {
    [MANIFEST_FILE]: { content: `${JSON.stringify(manifest, null, 2)}\n` },
  };
  for (const f of files) out[f.file] = { content: f.content };
  return out;
}

export class PackageFormatError extends Error {}

/**
 * Reads gist files back into a package, refusing anything the manifest does not describe:
 * a wrong format version, a path that could escape the Agent directory or is not part of a
 * definition, a file the gist truncated, or a manifest entry with no file.
 */
export function parsePackage(
  gistFiles: Record<string, { content?: string; truncated?: boolean }>,
): {
  manifest: PackageManifest;
  files: PackageFile[];
  bytes: number;
} {
  const manifestRaw = gistFiles[MANIFEST_FILE]?.content;
  if (manifestRaw === undefined) {
    throw new PackageFormatError(`This gist is not an Agent package: no ${MANIFEST_FILE}.`);
  }
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(manifestRaw) as PackageManifest;
  } catch {
    throw new PackageFormatError(`${MANIFEST_FILE} is not valid JSON.`);
  }
  if (manifest.format !== PACKAGE_FORMAT) {
    throw new PackageFormatError(
      `Package format ${String(manifest.format)} is not supported (this harness reads format ${PACKAGE_FORMAT}).`,
    );
  }
  if (!Array.isArray(manifest.files))
    throw new PackageFormatError(`${MANIFEST_FILE} has no files.`);

  const files: PackageFile[] = [];
  let bytes = 0;
  for (const entry of manifest.files) {
    if (typeof entry?.path !== "string" || typeof entry.file !== "string") {
      throw new PackageFormatError(`${MANIFEST_FILE} has an entry without a path.`);
    }
    if (!isSafePackagePath(entry.path)) {
      throw new PackageFormatError(`Package refused: '${entry.path}' is not a packageable path.`);
    }
    // A package published before the backslash separator names its files with `--`; both
    // spellings are read, only the current one is written.
    if (entry.file !== flattenPath(entry.path) && entry.file !== legacyFlattenPath(entry.path)) {
      throw new PackageFormatError(
        `Package refused: '${entry.file}' does not match the path it claims ('${entry.path}').`,
      );
    }
    const found = gistFiles[entry.file];
    if (found?.content === undefined) {
      throw new PackageFormatError(`Package is incomplete: '${entry.file}' is missing.`);
    }
    if (found.truncated === true) {
      throw new PackageFormatError(
        `Package is incomplete: '${entry.file}' was truncated by GitHub.`,
      );
    }
    const encoding = entry.encoding === "base64" ? "base64" : "utf8";
    files.push({ path: entry.path, file: entry.file, encoding, content: found.content });
    bytes += Buffer.byteLength(found.content, encoding === "base64" ? "base64" : "utf8");
  }
  if (files.length === 0) throw new PackageFormatError("Package is empty.");
  if (bytes > MAX_PACKAGE_BYTES) {
    throw new PackageFormatError(`Package exceeds the ${MAX_PACKAGE_BYTES / 1024 / 1024}MB limit.`);
  }
  return { manifest, files, bytes };
}

/** `https://gist.github.com/user/<id>`, `gist.github.com/<id>` or a bare id → the id. */
export function gistIdOf(input: string): string {
  const trimmed = input.trim();
  if (/^[0-9a-f]{5,64}$/i.test(trimmed)) return trimmed;
  const match = /gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{5,64})/i.exec(trimmed);
  if (match) return match[1]!;
  throw new PackageFormatError(`"${input}" is not a gist URL or id.`);
}

/**
 * A directory-shaped source (a tarball, a clone) as a package. With a manifest, every
 * entry must be present — by its real path or its flattened name — and pass the same rules
 * as a gist. Without one, the tree IS the Agent directory: whatever is packageable in it is
 * the package, named after the source. That is what makes "a repository that is an Agent
 * directory" installable with nothing added to it.
 */
export function packageFromTree(
  files: ReadonlyMap<string, Buffer>,
  fallback: { agentId: string; name: string; packagedBy: string },
): { manifest: PackageManifest; files: PackageFile[]; bytes: number } {
  const manifestRaw = files.get(MANIFEST_FILE);
  if (manifestRaw !== undefined) {
    // Look every manifest entry up by path first, then by its flattened name; the gist
    // parser does the rest of the checking on the same shape.
    const byName: Record<string, { content?: string; truncated?: boolean }> = {
      [MANIFEST_FILE]: { content: manifestRaw.toString("utf8") },
    };
    let manifest: { files?: Array<{ path?: unknown; file?: unknown; encoding?: unknown }> };
    try {
      manifest = JSON.parse(manifestRaw.toString("utf8")) as typeof manifest;
    } catch {
      throw new PackageFormatError(`${MANIFEST_FILE} is not valid JSON.`);
    }
    for (const entry of manifest.files ?? []) {
      if (typeof entry?.path !== "string" || typeof entry.file !== "string") continue;
      const bytes = files.get(entry.path) ?? files.get(entry.file);
      if (bytes === undefined) continue;
      byName[entry.file] = {
        content: entry.encoding === "base64" ? bytes.toString("base64") : bytes.toString("utf8"),
      };
    }
    return parsePackage(byName);
  }

  const out: PackageFile[] = [];
  let bytes = 0;
  for (const [rel, content] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isPackagedPath(rel) || !isRoundTrippable(rel)) continue;
    const encoding = encodingFor(content);
    const text = encoding === "utf8" ? content.toString("utf8") : content.toString("base64");
    bytes += Buffer.byteLength(text, "utf8");
    out.push({ path: rel, file: flattenPath(rel), encoding, content: text });
  }
  if (out.length === 0) {
    throw new PackageFormatError(
      `The source is not an Agent: no ${MANIFEST_FILE}, and no agent_state/ or workflows/ folder.`,
    );
  }
  if (bytes > MAX_PACKAGE_BYTES) {
    throw new PackageFormatError(`Package exceeds the ${MAX_PACKAGE_BYTES / 1024 / 1024}MB limit.`);
  }
  const manifest = manifestOf(
    fallback.agentId,
    fallback.name,
    "",
    fallback.packagedBy,
    new Date(0).toISOString(),
    out,
  );
  return { manifest, files: out, bytes };
}
