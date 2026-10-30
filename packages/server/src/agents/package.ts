/**
 * An Agent package: a plugin package whose definition part is an Agent's
 * definition. Downloading one copies that part into a Project's agents/
 * directory — a copy of data, not an install — and everything else about it
 * (naming, channels, the npm prefix) is plugin semantics.
 *
 * A package without a package.json can still be an Agent package: a zip that
 * carries `agent_state/skills/<name>/SKILL.md` or `agent_state/system_config.yaml`
 * (with or without one top-level directory) names its Agent after the package
 * directory. With a package.json, the keyword `penguin-agent` is what marks it
 * (and npm then supplies name and version); an optional `agent.json` beside the
 * manifest adds the Agent's id and description. An `agent.json` that lists files
 * must be truthful: every path it names has to exist in the package.
 *
 * What is copied is exactly the definition the package carries: `agent_state/`
 * without the runtime directories below, plus `system_config.yaml` and
 * `AGENTS.md` when the package has none (defaults, written as data). The runtime
 * directories — `traces/`, `snapshots/`, `workspaces/`, `scratchpad/`,
 * `agent_state/memory/` and the vault — never leave the package: an Agent package
 * carries what someone polished, never what the Agent lived through, and the
 * vault's secrets stay with the original.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  PLUGIN_NAME_PATTERN,
  agentDir,
  agentStateDir,
  defaultAgentsMd,
  defaultSystemConfig,
} from "@prismshadow/penguin-core";
import { stringify as stringifyYaml } from "yaml";

/** The npm keyword that marks a plugin package as an Agent package. */
export const AGENT_PACKAGE_KEYWORD = "penguin-agent";

/** Directories inside `agent_state/` that are the Agent's lived history, never its definition. */
export const RUNTIME_STATE_DIRS = ["memory", "traces", "snapshots", "workspaces", "scratchpad"];

/** Definition files at the Agent-directory level that belong to the package. */
const DEFINITION_TOP_FILES = ["system_config.yaml", "AGENTS.md"];

/** The optional manifest beside package.json: the Agent's id and description. */
const AGENT_MANIFEST = "agent.json";

export class AgentPackageError extends Error {}

/** A relative path (POSIX) that stays inside the package; null when it leaves or escapes. */
function packageRelative(entry: string, prefix: string): string | null {
  const rel = entry.slice(prefix.length);
  const parts = rel.split("/");
  if (parts.length < 2) return null;
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return rel;
}

/**
 * Reads one definition entry from the package's files, relative to the package
 * directory (already stripped of a top-level zip directory by the caller):
 * `agent_state/...` — minus the runtime directories — or one of the definition
 * top files. Anything else is not part of an Agent definition and is ignored.
 */
export function definitionEntry(
  rel: string,
): { state: "state"; rel: string } | { state: "top"; file: string } | null {
  if (DEFINITION_TOP_FILES.includes(rel)) return { state: "top", file: rel };
  if (rel === "agent_state" || rel.startsWith("agent_state/")) {
    const parts = rel.split("/");
    // Dot-prefixed entries are the Agent's runtime state or install staging — the vault
    // above all: a secret never travels in a package.
    if (
      parts.length === 2 &&
      (RUNTIME_STATE_DIRS.includes(parts[1]!) || parts[1]!.startsWith("."))
    ) {
      return null;
    }
    return { state: "state", rel };
  }
  return null;
}

/**
 * The package's Agent manifest, when it carries one: `{ id?, description?, files? }`.
 * Returns null without one; throws (400-grade `AgentPackageError`) when the file is
 * there but unreadable or malformed.
 */
export async function readAgentManifest(
  files: ReadonlyMap<string, Uint8Array>,
): Promise<{ id?: string; description?: string; files?: string[] } | null> {
  const raw = files.get(AGENT_MANIFEST);
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    throw new AgentPackageError(`${AGENT_MANIFEST} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AgentPackageError(`${AGENT_MANIFEST} must be an object.`);
  }
  const m = parsed as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const v = m[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || v.length === 0 || v.length > 200) {
      throw new AgentPackageError(
        `${AGENT_MANIFEST}: ${key} must be a string of 1–200 characters.`,
      );
    }
    return v;
  };
  let filesList: string[] | undefined;
  if (m.files !== undefined) {
    if (!Array.isArray(m.files) || !m.files.every((f) => typeof f === "string" && f.length > 0)) {
      throw new AgentPackageError(`${AGENT_MANIFEST}: files must be a list of paths.`);
    }
    filesList = m.files as string[];
  }
  const out: { id?: string; description?: string; files?: string[] } = {};
  const id = text("id");
  const description = text("description");
  if (id !== undefined) out.id = id;
  if (description !== undefined) out.description = description;
  if (filesList !== undefined) out.files = filesList;
  return out;
}

/** Whether an installed package's directory is an Agent package: the keyword, or a definition part on disk. */
export async function installedPackageIsAgent(dir: string): Promise<boolean> {
  let manifest: { keywords?: unknown };
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
      keywords?: unknown;
    };
  } catch {
    // No readable package.json: an Agent package can still be there by its parts.
    return await hasDefinitionParts(dir);
  }
  const keywords = manifest.keywords;
  if (Array.isArray(keywords) && keywords.includes(AGENT_PACKAGE_KEYWORD)) return true;
  return await hasDefinitionParts(dir);
}

/** Whether the directory carries an Agent definition part beside (or without) package.json. */
async function hasDefinitionParts(dir: string): Promise<boolean> {
  for (const file of DEFINITION_TOP_FILES) {
    try {
      await fs.access(path.join(dir, file));
      return true;
    } catch {
      // not there
    }
  }
  try {
    for (const entry of await fs.readdir(path.join(dir, "agent_state"), { withFileTypes: true })) {
      if (entry.isDirectory() && !RUNTIME_STATE_DIRS.includes(entry.name)) return true;
      if (entry.isFile() && entry.name === "system_config.yaml") return true;
    }
  } catch {
    // no agent_state/
  }
  return false;
}

/** An installed package directory as files (relative path → bytes), `node_modules/` and `.git/` left out. */
export async function agentPackageFiles(dir: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const walk = async (at: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(at, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const child = path.join(at, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child, childRel);
      else if (entry.isFile()) out.set(childRel, new Uint8Array(await fs.readFile(child)));
    }
  };
  await walk(dir, "");
  return out;
}

/** The Agent manifest of an installed package directory, or null without one. */
export async function readAgentManifestFromDir(
  dir: string,
): Promise<{ id?: string; description?: string; files?: string[] } | null> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(path.join(dir, AGENT_MANIFEST));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return readAgentManifest(new Map([[AGENT_MANIFEST, new Uint8Array(raw)]]));
}

/**
 * Re-copies an installed Agent package's definition into the Project — the verb an
 * install answer's re-copy takes, and the recovery when the Agent's directory was
 * deleted by hand. The package must be an Agent package (keyword or definition parts);
 * the Agent id is the manifest's `id`, else the package name's unscoped part.
 */
export async function reinstallAgentPackage(opts: {
  root: string;
  projectId: string;
  /** The npm package name as the prefix records it (`name` or `@scope/name`). */
  name: string;
  /** The installed package's directory. */
  dir: string;
}): Promise<{ agentId: string; copied: string[] }> {
  if (!(await installedPackageIsAgent(opts.dir))) {
    throw new AgentPackageError(
      `${opts.name} is not an Agent package: it carries neither the '${AGENT_PACKAGE_KEYWORD}' keyword nor an Agent definition.`,
    );
  }
  const manifest = await readAgentManifestFromDir(opts.dir);
  const agentId = manifest?.id ?? opts.name.split("/").pop() ?? opts.name;
  return copyAgentPackage({
    root: opts.root,
    projectId: opts.projectId,
    agentId,
    files: await agentPackageFiles(opts.dir),
  });
}

/**
 * Copies an Agent package's definition into `<project>/agents/<agentId>/` and
 * answers what was copied. `files` maps package-relative paths to bytes (the
 * caller validated them); `agentId` is the manifest's `id`, else the package
 * name's unscoped part; `description` fills the created system config when the
 * package carries no `system_config.yaml`.
 *
 * Copy only: nothing in the package is executed, nothing is registered anywhere,
 * no credentials are written. The Agent this creates is a directory with a
 * definition in it, ready to be assigned.
 */
export async function copyAgentPackage(opts: {
  root: string;
  projectId: string;
  agentId: string;
  files: ReadonlyMap<string, Uint8Array>;
}): Promise<{ agentId: string; copied: string[] }> {
  const manifest = await readAgentManifest(opts.files);
  const agentId = manifest?.id ?? opts.agentId;
  if (!PLUGIN_NAME_PATTERN.test(agentId)) {
    throw new AgentPackageError(
      `the Agent id '${agentId}' is not a usable directory name: letters, digits, "_" and "-" only`,
    );
  }
  // The manifest's file list must be truthful: every path it names has to exist.
  if (manifest?.files !== undefined) {
    for (const wanted of manifest.files) {
      if (!opts.files.has(wanted)) {
        throw new AgentPackageError(
          `${AGENT_MANIFEST} lists '${wanted}', which the package does not carry.`,
        );
      }
    }
  }
  const dir = agentDir(opts.root, opts.projectId, agentId);
  if (
    await fs.access(dir).then(
      () => true,
      () => false,
    )
  ) {
    throw new AgentPackageError(`an Agent named '${agentId}' already exists in this project.`);
  }
  const copied: string[] = [];
  let hasConfig = false;
  let hasAgentsMd = false;
  for (const [rel, bytes] of opts.files) {
    const entry = definitionEntry(rel);
    if (entry === null) continue;
    const file =
      entry.state === "top" ? path.join(dir, entry.file) : path.join(dir, ...entry.rel.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    copied.push(rel);
    // Either shape of the definition files counts: the package may carry them at the
    // Agent-directory level or under agent_state/ — what it carries is what is kept.
    if (rel === "system_config.yaml" || rel === "agent_state/system_config.yaml") hasConfig = true;
    if (rel === "AGENTS.md" || rel === "agent_state/AGENTS.md") hasAgentsMd = true;
  }
  // Defaults for what the package does not carry — written as data, never executed.
  if (!hasConfig) {
    const file = agentStateDir(opts.root, opts.projectId, agentId);
    await fs.mkdir(file, { recursive: true });
    await fs.writeFile(path.join(file, "system_config.yaml"), stringifyYaml(defaultSystemConfig()));
    copied.push("system_config.yaml");
  }
  if (!hasAgentsMd) {
    await fs.writeFile(path.join(dir, "AGENTS.md"), defaultAgentsMd());
    copied.push("AGENTS.md");
  }
  return { agentId, copied };
}
