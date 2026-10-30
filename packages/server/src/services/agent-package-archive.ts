/**
 * An Agent package as a zip, on the way in: the same bounded decode and path checks
 * the plugin archive gets (services/plugin-archive.ts — the caps, the zip-slip check,
 * no node_modules, no .npmrc), plus what sets an Agent package apart — package.json is
 * OPTIONAL. A zip without one is still an Agent package when it carries a definition
 * (skills/, hooks/ or a system_config.yaml under agent_state/, with or without one
 * top-level directory); the package name and the Agent id then come from the package
 * directory. With a package.json, the keyword `penguin-agent` marks it (the plugin
 * rules then read the manifest); an optional agent.json adds the Agent's id and
 * description, and every file it lists must exist.
 *
 * The parts are NOT checked with the library's plugin reader here: an Agent package
 * has no library kind — its skills and hooks are data the copy writes into the Agent's
 * directory, and the kind question (library? modules?) is answered by the package
 * itself, not by this reader.
 */
import { strFromU8, unzipSync } from "fflate";
import { PLUGIN_NAME_PATTERN } from "@prismshadow/penguin-core";
import {
  MAX_PLUGIN_ARCHIVE_BYTES,
  MAX_PLUGIN_FILE_BYTES,
  MAX_PLUGIN_TOTAL_BYTES,
  MAX_PLUGIN_ARCHIVE_FILES,
  pluginTooLarge,
} from "./plugin-archive.js";
import { definitionEntry, readAgentManifest, AgentPackageError } from "../agents/package.js";
import { assertSafeEntryPath } from "./skill-import-limits.js";
import { PACKAGE_NAME } from "../plugin/loader.js";

const invalid = (message: string) => new AgentPackageError(message);

/** A decoded Agent package: its files relative to the package directory, and its names. */
export interface AgentPackageArchive {
  /** The package name: package.json's npm name, else the top-level directory's. */
  name: string;
  /** The Agent id the copy uses: agent.json's `id`, else the package name's unscoped part. */
  agentId: string;
  /** The manifest's description, when the package carries one. */
  description?: string;
  /** It carried a package.json (so npm semantics apply to its name and its dependencies). */
  manifest: boolean;
  files: Map<string, Uint8Array>;
}

function unzipBounded(archive: Uint8Array): Record<string, Uint8Array> {
  let files = 0;
  let declared = 0;
  return unzipSync(archive, {
    filter: ({ name, originalSize }) => {
      if (name.endsWith("/")) return true;
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
 * Decodes and checks an uploaded Agent package zip. Refuses a corrupt or empty zip, a
 * path leaving the package, `node_modules/`, a `.npmrc`, a package.json that will not
 * parse or names no valid npm name, a `penguin-agent` package.json without a release
 * version, and an agent.json whose listed files the package does not carry; 413
 * `plugin_too_large` over the caps.
 */
export async function parseAgentPackageArchive(archive: Uint8Array): Promise<AgentPackageArchive> {
  if (archive.byteLength === 0) throw invalid("The zip archive is empty.");
  if (archive.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) throw pluginTooLarge();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(archive);
  } catch (err) {
    if (err instanceof AgentPackageError) throw err;
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
      throw invalid(`node_modules is not part of a package — installing it resolves the dependencies: ${name}`);
    }
    if (name.split("/").at(-1) === ".npmrc") {
      throw invalid(`.npmrc is not part of a package — it would configure npm on the server: ${name}`);
    }
  }
  const names = files.map(([name]) => name);
  let prefix = "";
  if (!names.includes("package.json")) {
    const tops = new Set(names.map((name) => name.split("/", 1)[0]!));
    const dir = tops.size === 1 ? [...tops][0]! : undefined;
    if (dir === undefined || !names.includes(`${dir}/package.json`)) {
      // No package.json anywhere: fine for an Agent package, as long as one top-level
      // directory (or none) holds a definition.
      if (dir === undefined) {
        prefix = "";
      } else {
        prefix = `${dir}/`;
      }
    } else {
      prefix = `${dir}/`;
    }
  }
  const rel = new Map<string, Uint8Array>();
  for (const [name, data] of files) {
    const at = name.slice(prefix.length);
    if (at === "") throw invalid(`Invalid zip entry path (names a directory): ${name}`);
    rel.set(at, data);
  }
  // package.json is optional; when it is there, the plugin rules read the name (and a
  // penguin-agent keyword marks the package; a version is required then, as for plugins).
  let name: string | undefined;
  let manifest = false;
  const rawManifest = rel.get("package.json");
  if (rawManifest !== undefined) {
    let parsed: { name?: unknown; version?: unknown; keywords?: unknown };
    try {
      parsed = JSON.parse(strFromU8(rawManifest)) as typeof parsed;
    } catch {
      throw invalid("package.json is not valid JSON.");
    }
    if (typeof parsed.name !== "string" || !PACKAGE_NAME.test(parsed.name)) {
      throw invalid("package.json must name the package with a valid npm name (`name` or `@scope/name`).");
    }
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === "string")
      : [];
    if (keywords.includes("penguin-agent")) {
      if (typeof parsed.version !== "string" || !/^\d+\.\d+\.\d+/.test(parsed.version)) {
        throw invalid("package.json must carry a release version such as 1.2.0.");
      }
    }
    name = parsed.name;
    manifest = true;
  }
  const agentManifest = await readAgentManifest(rel).catch((err: unknown) => {
    if (err instanceof AgentPackageError) throw invalid(err.message);
    throw err;
  });
  // An Agent package carries a definition: at least one part of one.
  const carriesDefinition = [...rel.keys()].some((n) => definitionEntry(n) !== null);
  if (!carriesDefinition) {
    throw invalid(
      "Not an Agent package: it carries no skills, hooks or system configuration under agent_state/ (and no system_config.yaml).",
    );
  }
  // Without a package.json the name comes from the one top-level directory (the caller
  // keeps `prefix` when there is one), else from the manifest's id, else "agent".
  const dirName = prefix === "" ? undefined : prefix.replace(/\/$/, "");
  const agentId = agentManifest?.id ?? name?.split("/").pop() ?? dirName ?? "agent";
  if (!PLUGIN_NAME_PATTERN.test(agentId)) {
    throw invalid(`the Agent id '${agentId}' is not a usable name: letters, digits, "_" and "-" only.`);
  }
  const out: AgentPackageArchive = {
    name: name ?? agentId,
    agentId,
    files: rel,
    manifest,
  };
  if (agentManifest?.description !== undefined) out.description = agentManifest.description;
  return out;
}
