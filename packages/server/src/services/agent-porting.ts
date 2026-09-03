/**
 * Agent porting: the portable definition (`penguin-agent.json`) and the integration bundle
 * built around it. Export packs an Agent's definition, its installed skills and hook
 * packages, and a guide for calling it over the server API; import creates a new Agent from
 * such a bundle, or from a bare definition written by hand from another tool's settings.
 *
 * Distinct from Agent State snapshots (snapshot-service.ts): a snapshot backs up and restores
 * the whole state directory of an existing Agent, a bundle moves an Agent's identity and
 * capabilities into another install or another tool's hands — and never carries secrets:
 * vault values stay behind (only the key names travel), and MCP `env` / `headers` values
 * whose names look like credentials are blanked on the way out.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  PLUGIN_NAME_PATTERN,
  hooksDir,
  installHook,
  listInstalledHooks,
  listInstalledSkills,
  loadAgentVault,
  parseSkillFrontmatter,
  replaceSkillDirectory,
  skillsDir,
} from "@prismshadow/penguin-core";
import type { HookCommand, HookManifest, MCPServerConfig } from "@prismshadow/penguin-core";
import type {
  AgentBundleImportResponse,
  PortableAgentDefinition,
  PortableHookRef,
  PortableSkillRef,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import {
  badRequest,
  optionalString,
  optionalStringArray,
  requireString,
} from "../http/validate.js";
import type { AgentConfigService } from "./agent-config-service.js";
import type { AgentListItem, AgentService } from "./agent-service.js";
import { renderBundleDocs } from "./agent-porting-templates.js";
import { MAX_ARCHIVE_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "./skill-import-limits.js";

export const PORTABLE_AGENT_FORMAT = "penguin-agent/1";
/** The definition's file name at the bundle root. */
export const DEFINITION_FILE = "penguin-agent.json";
/** Upper bound on zip entries in one bundle — a bound on the parse loop, above the per-directory caps. */
const MAX_BUNDLE_ENTRIES = 2000;

/** Env / header names whose values are credentials as far as export is concerned; their values are blanked. */
const SECRET_NAME_PATTERN = /key|token|secret|password|passwd|auth|credential|cookie|bearer/i;

export interface PortingDeps {
  root: string;
  agentConfig: AgentConfigService;
  agents: AgentService;
}

export interface ExportedBundle {
  fileName: string;
  bytes: Uint8Array;
  definition: PortableAgentDefinition;
}

export interface ImportOutcome extends Omit<AgentBundleImportResponse, "agent"> {
  item: AgentListItem;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** A per-directory cap in the bundle, in the archive routes' numbers. */
function bundleTooLarge(what: string): HttpError {
  return new HttpError(
    413,
    "bundle_too_large",
    `${what} exceeds the bundle limits (${MAX_ARCHIVE_FILES} files, 5MB per file, 20MB total).`,
  );
}

/**
 * Zip-slip guard for one entry path: no absolute path, no drive letter, no backslash and no
 * `..` segment — a crafted bundle must never write outside the target directories.
 */
function assertSafeEntryPath(name: string): void {
  if (name.includes("\\")) throw badRequest(`Invalid bundle entry path (backslash): ${name}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw badRequest(`Invalid bundle entry path (absolute): ${name}`);
  }
  if (name.split("/").some((segment) => segment === "..")) {
    throw badRequest(`Invalid bundle entry path (traversal): ${name}`);
  }
}

/** MCP Server entries with credential-looking `env` / `headers` values blanked (keys kept, so the importer sees what to fill in). */
export function redactMcpSecrets(servers: readonly MCPServerConfig[]): MCPServerConfig[] {
  return servers.map((server) => {
    const config: Record<string, unknown> = { ...server.config };
    for (const field of ["env", "headers"]) {
      const values = asRecord(config[field]);
      if (values === null) continue;
      config[field] = Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          SECRET_NAME_PATTERN.test(name) ? "" : value,
        ]),
      );
    }
    return { name: server.name, config };
  });
}

/** The Agent's portable definition, read from its config, AGENTS.md, installed skills and hooks, and vault key names. */
export async function portableDefinition(
  deps: PortingDeps,
  projectId: string,
  agentId: string,
): Promise<PortableAgentDefinition> {
  const view = await deps.agentConfig.getConfig(projectId, agentId);
  const [skills, hooks, vault] = await Promise.all([
    listInstalledSkills(deps.root, projectId, agentId),
    listInstalledHooks(deps.root, projectId, agentId),
    loadAgentVault(deps.root, projectId, agentId),
  ]);
  const cfg = view.config;
  const model = {
    ...(cfg.model?.thinkingLevel !== undefined ? { thinkingLevel: cfg.model.thinkingLevel } : {}),
    ...(cfg.model?.maxTokens !== undefined ? { maxTokens: cfg.model.maxTokens } : {}),
    ...(cfg.model?.timeoutMs !== undefined ? { timeoutMs: cfg.model.timeoutMs } : {}),
  };
  const vaultKeys = Object.keys(vault).sort();
  return {
    format: PORTABLE_AGENT_FORMAT,
    id: agentId,
    name: cfg.name ?? agentId,
    ...(cfg.description ? { description: cfg.description } : {}),
    prompt: view.agentsMd,
    systemPrompt: cfg.systemPrompt,
    skills: skills.map((s) => ({
      name: s.name,
      ...(s.version ? { version: s.version } : {}),
      ...(s.description ? { description: s.description } : {}),
    })),
    hooks: hooks.map((h) => ({
      name: h.name,
      ...(h.version ? { version: h.version } : {}),
      ...(h.description ? { description: h.description } : {}),
    })),
    tools: { builtin: cfg.toolsBuiltin.map((t) => t.name) },
    ...(cfg.mcpServers.length > 0 ? { mcpServers: redactMcpSecrets(cfg.mcpServers) } : {}),
    ...(Object.keys(model).length > 0 ? { model } : {}),
    ...(vaultKeys.length > 0 ? { vaultKeys } : {}),
    exportedAt: new Date().toISOString(),
    source: { projectId, agentId, version: cfg.version },
  };
}

/**
 * One installed directory as zip entries under `prefix/`, subpaths preserved; symlinks and
 * other non-regular entries are skipped so nothing outside the directory can leak. The import
 * caps apply on the way out — a directory over them could not be imported again anyway.
 */
async function collectDirectory(dir: string, prefix: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const absChild = path.join(abs, entry.name);
      const relChild = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absChild, relChild);
        continue;
      }
      if (!entry.isFile()) continue;
      const data = new Uint8Array(await fs.readFile(absChild));
      count += 1;
      total += data.byteLength;
      if (
        count > MAX_ARCHIVE_FILES ||
        data.byteLength > MAX_FILE_BYTES ||
        total > MAX_TOTAL_BYTES
      ) {
        throw bundleTooLarge(prefix);
      }
      out[relChild] = data;
    }
  };
  await walk(dir, prefix);
  return out;
}

/** The bundle zip: the definition, its documents and examples, and every installed skill and hook package directory. */
export async function exportAgentBundle(
  deps: PortingDeps,
  projectId: string,
  agentId: string,
): Promise<ExportedBundle> {
  const definition = await portableDefinition(deps, projectId, agentId);
  const files: Record<string, Uint8Array> = {
    [DEFINITION_FILE]: strToU8(`${JSON.stringify(definition, null, 2)}\n`),
  };
  for (const [rel, text] of Object.entries(renderBundleDocs(definition))) {
    files[rel] = strToU8(text);
  }
  for (const skill of definition.skills) {
    Object.assign(
      files,
      await collectDirectory(
        path.join(skillsDir(deps.root, projectId, agentId), skill.name),
        `skills/${skill.name}`,
      ),
    );
  }
  for (const hook of definition.hooks) {
    Object.assign(
      files,
      await collectDirectory(
        path.join(hooksDir(deps.root, projectId, agentId), hook.name),
        `hooks/${hook.name}`,
      ),
    );
  }
  return { fileName: `${agentId}-export.zip`, bytes: zipSync(files), definition };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** A hook package decoded from the bundle: its manifest (named after the directory) and the files to install beside it. */
interface BundleHook {
  manifest: HookManifest;
  files: Record<string, string>;
  icon?: string;
}

export interface ParsedBundle {
  definition: PortableAgentDefinition;
  /** Whether the definition carried a `prompt` at all (an absent one keeps the default AGENTS.md). */
  hasPrompt: boolean;
  /** Skill directories by name: file bytes keyed by path relative to the skill directory. */
  skills: Map<string, Array<[string, Uint8Array]>>;
  hooks: Map<string, BundleHook>;
}

function refList(raw: unknown, field: string): PortableSkillRef[] | PortableHookRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw badRequest(`${field} must be an array.`);
  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (record === null) throw badRequest(`${field}[${i}] must be an object.`);
    const name = requireString(record, "name", { minLen: 1, label: `${field}[${i}].name` });
    if (!PLUGIN_NAME_PATTERN.test(name)) {
      throw badRequest(`${field}[${i}].name has an invalid format: ${JSON.stringify(name)}.`);
    }
    const version = optionalString(record, "version", { label: `${field}[${i}].version` });
    const description = optionalString(record, "description", {
      label: `${field}[${i}].description`,
    });
    return {
      name,
      ...(version !== undefined ? { version } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  });
}

/**
 * Checks a `penguin-agent.json` document and returns it in the wire shape. The fields the
 * import writes through the config service (`mcpServers`, `model`) are only shape-checked
 * here and validated by that service on apply, so the two entry points cannot disagree.
 */
export function validateDefinition(raw: unknown): {
  definition: PortableAgentDefinition;
  hasPrompt: boolean;
} {
  const r = asRecord(raw);
  if (r === null) throw badRequest(`${DEFINITION_FILE} must be a JSON object.`);
  if (r.format !== PORTABLE_AGENT_FORMAT) {
    throw badRequest(
      `Unsupported definition format ${JSON.stringify(r.format)}: expected ${JSON.stringify(PORTABLE_AGENT_FORMAT)}.`,
    );
  }
  const id = requireString(r, "id", { minLen: 1, maxLen: 64, label: "id" });
  const name = optionalString(r, "name", { minLen: 1, maxLen: 100, label: "name" }) ?? id;
  const description = optionalString(r, "description", { maxLen: 2000, label: "description" });
  const prompt = optionalString(r, "prompt", { label: "prompt" });
  const systemPrompt = optionalString(r, "systemPrompt", { minLen: 1, label: "systemPrompt" });
  const skills = refList(r.skills, "skills");
  const hooks = refList(r.hooks, "hooks");
  let tools: { builtin: string[] } | undefined;
  if (r.tools !== undefined) {
    const t = asRecord(r.tools);
    if (t === null) throw badRequest("tools must be an object.");
    tools = { builtin: optionalStringArray(t, "builtin", "tools.builtin") ?? [] };
  }
  if (r.mcpServers !== undefined && !Array.isArray(r.mcpServers)) {
    throw badRequest("mcpServers must be an array.");
  }
  if (r.model !== undefined && asRecord(r.model) === null)
    throw badRequest("model must be an object.");
  const vaultKeys = optionalStringArray(r, "vaultKeys");
  const exportedAt = optionalString(r, "exportedAt", { label: "exportedAt" });
  const source = asRecord(r.source);
  return {
    hasPrompt: prompt !== undefined,
    definition: {
      format: PORTABLE_AGENT_FORMAT,
      id,
      name,
      ...(description !== undefined ? { description } : {}),
      prompt: prompt ?? "",
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      skills,
      hooks,
      ...(tools !== undefined ? { tools } : {}),
      ...(r.mcpServers !== undefined ? { mcpServers: r.mcpServers as MCPServerConfig[] } : {}),
      ...(r.model !== undefined ? { model: r.model as PortableAgentDefinition["model"] } : {}),
      ...(vaultKeys !== undefined ? { vaultKeys } : {}),
      exportedAt: exportedAt ?? new Date().toISOString(),
      ...(source !== null &&
      typeof source.projectId === "string" &&
      typeof source.agentId === "string" &&
      typeof source.version === "number"
        ? {
            source: {
              projectId: source.projectId,
              agentId: source.agentId,
              version: source.version,
            },
          }
        : {}),
    },
  };
}

function parseJsonText(text: string, what: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw badRequest(`${what} is not valid JSON.`);
  }
}

function commandList(raw: unknown, field: string): HookCommand[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw badRequest(`${field} must be an array.`);
  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (record === null) throw badRequest(`${field}[${i}] must be an object.`);
    const command = requireString(record, "command", {
      minLen: 1,
      label: `${field}[${i}].command`,
    });
    assertSafeEntryPath(command);
    const timeout = record.timeout;
    if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
      throw badRequest(`${field}[${i}].timeout must be a positive number.`);
    }
    return { command, ...(timeout !== undefined ? { timeout } : {}) };
  });
}

/** The manifest of one bundled hook package: named after its directory, script lists checked. */
function hookManifest(name: string, raw: unknown): HookManifest {
  const r = asRecord(raw);
  if (r === null) throw badRequest(`hooks/${name}/hooks.json must be a JSON object.`);
  const label = `hooks/${name}/hooks.json`;
  return {
    name,
    description: optionalString(r, "description", { label: `${label} description` }) ?? "",
    ...(typeof r.description_zh === "string" ? { description_zh: r.description_zh } : {}),
    version: optionalString(r, "version", { label: `${label} version` }) ?? "",
    stop: commandList(r.stop, `${label} stop`),
    pre_tool_use: commandList(r.pre_tool_use, `${label} pre_tool_use`),
    user_prompt: commandList(r.user_prompt, `${label} user_prompt`),
  };
}

function looksLikeZip(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Decodes an uploaded bundle: the zip `exportAgentBundle` produces (with `penguin-agent.json`
 * at the root or inside exactly one top-level directory), or a bare definition document.
 * Every entry path is zip-slip-checked; each `skills/<name>/` and `hooks/<name>/` directory is
 * held to the archive routes' caps; a skill needs a SKILL.md with frontmatter and a hook
 * package a hooks.json. Members outside those directories (the guide, the examples) are ignored.
 */
export function parseAgentBundle(archive: Buffer): ParsedBundle {
  if (!looksLikeZip(archive)) {
    const { definition, hasPrompt } = validateDefinition(
      parseJsonText(archive.toString("utf8"), DEFINITION_FILE),
    );
    return { definition, hasPrompt, skills: new Map(), hooks: new Map() };
  }
  let entries: Record<string, Uint8Array>;
  // The caps are enforced from the central directory, before a byte is inflated: unzipSync
  // allocates each entry's declared uncompressed size, so 14MB of compressed zeros would
  // otherwise become gigabytes of heap (the per-directory caps below only see what already
  // materialized). A lying header cannot get past this — the allocation is that same declared
  // size, and fflate refuses to grow it.
  let declared = 0;
  try {
    entries = unzipSync(new Uint8Array(archive), {
      filter: ({ name, originalSize }) => {
        if (originalSize > MAX_FILE_BYTES) throw bundleTooLarge(name);
        declared += originalSize;
        if (declared > MAX_TOTAL_BYTES) throw bundleTooLarge("The archive");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest("dataBase64 is not a valid zip archive.");
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw badRequest("The bundle contains no files.");
  if (files.length > MAX_BUNDLE_ENTRIES) {
    throw badRequest(`The bundle exceeds the ${MAX_BUNDLE_ENTRIES}-entry limit.`);
  }
  for (const [name] of files) assertSafeEntryPath(name);
  const names = files.map(([name]) => name);
  let prefix = "";
  if (!names.includes(DEFINITION_FILE)) {
    const topLevels = new Set(names.map((name) => name.split("/", 1)[0]!));
    const dirName = topLevels.size === 1 ? [...topLevels][0] : undefined;
    if (dirName === undefined || !names.includes(`${dirName}/${DEFINITION_FILE}`)) {
      throw badRequest(
        `The bundle must contain ${DEFINITION_FILE} at its root, or exactly one top-level directory containing it.`,
      );
    }
    prefix = `${dirName}/`;
  }
  const { definition, hasPrompt } = validateDefinition(
    parseJsonText(strFromU8(entries[`${prefix}${DEFINITION_FILE}`]!), DEFINITION_FILE),
  );

  const skillFiles = new Map<string, Array<[string, Uint8Array]>>();
  const hookFiles = new Map<string, Array<[string, Uint8Array]>>();
  const budgets = new Map<string, { count: number; total: number }>();
  for (const [name, data] of files) {
    const match = /^(skills|hooks)\/([^/]+)\/(.+)$/.exec(name.slice(prefix.length));
    if (!match) continue;
    const kind = match[1] as "skills" | "hooks";
    const dirName = match[2]!;
    const rel = match[3]!;
    if (!PLUGIN_NAME_PATTERN.test(dirName)) {
      throw badRequest(
        `Invalid ${kind === "skills" ? "skill" : "hook package"} name in the bundle: ${dirName}`,
      );
    }
    const key = `${kind}/${dirName}`;
    const budget = budgets.get(key) ?? { count: 0, total: 0 };
    budget.count += 1;
    budget.total += data.byteLength;
    budgets.set(key, budget);
    if (
      budget.count > MAX_ARCHIVE_FILES ||
      data.byteLength > MAX_FILE_BYTES ||
      budget.total > MAX_TOTAL_BYTES
    ) {
      throw bundleTooLarge(key);
    }
    const target = kind === "skills" ? skillFiles : hookFiles;
    const list = target.get(dirName) ?? [];
    list.push([rel, data]);
    target.set(dirName, list);
  }

  for (const [name, list] of skillFiles) {
    const skillMd = list.find(([rel]) => rel === "SKILL.md");
    if (skillMd === undefined || parseSkillFrontmatter(strFromU8(skillMd[1])) === null) {
      throw badRequest(
        `skills/${name}/ must contain a SKILL.md that starts with a frontmatter block setting \`name\`.`,
      );
    }
  }
  const hooks = new Map<string, BundleHook>();
  for (const [name, list] of hookFiles) {
    const manifestEntry = list.find(([rel]) => rel === "hooks.json");
    if (manifestEntry === undefined) throw badRequest(`hooks/${name}/ must contain a hooks.json.`);
    const manifest = hookManifest(
      name,
      parseJsonText(strFromU8(manifestEntry[1]), `hooks/${name}/hooks.json`),
    );
    const iconEntry = list.find(([rel]) => rel === "icon.svg");
    const scripts = list.filter(([rel]) => rel !== "hooks.json" && rel !== "icon.svg");
    hooks.set(name, {
      manifest,
      files: Object.fromEntries(scripts.map(([rel, data]) => [rel, strFromU8(data)])),
      ...(iconEntry !== undefined ? { icon: strFromU8(iconEntry[1]) } : {}),
    });
  }
  return { definition, hasPrompt, skills: skillFiles, hooks };
}

/**
 * Creates an Agent from a bundle: the definition's name and description at creation, then
 * its instructions and template, model preferences and MCP entries through the config
 * service, the named built-in tools kept out of the default toolset, and the bundled skill
 * and hook directories installed with the same writers the library routes use. 409
 * `agent_exists` when the id is taken; any later failure removes the half-built Agent, so a
 * retry with the same id is not blocked. What the definition named but the bundle could not
 * supply is reported in `skipped` rather than failing the import.
 */
export async function importAgentBundle(
  deps: PortingDeps,
  projectId: string,
  archive: Buffer,
  agentIdOverride?: string,
): Promise<ImportOutcome> {
  const bundle = parseAgentBundle(archive);
  const { definition } = bundle;
  const agentId = agentIdOverride ?? definition.id;
  const created = await deps.agents.createAgent(
    projectId,
    agentId,
    definition.name,
    definition.description,
  );
  const installed = { skills: [] as string[], hooks: [] as string[] };
  const skipped: string[] = [];
  try {
    await deps.agentConfig.updateConfig(projectId, agentId, {
      ...(bundle.hasPrompt ? { agentsMd: definition.prompt } : {}),
      config: {
        ...(definition.systemPrompt !== undefined ? { systemPrompt: definition.systemPrompt } : {}),
        ...(definition.model !== undefined ? { model: definition.model } : {}),
        ...(definition.mcpServers !== undefined ? { mcpServers: definition.mcpServers } : {}),
      },
    });
    if (definition.tools !== undefined && definition.tools.builtin.length > 0) {
      // The names select from the default toolset the new Agent already carries: a tool this
      // install does not ship cannot be conjured, and an empty selection would leave the model
      // with no tools at all, so the defaults stay in that case.
      const view = await deps.agentConfig.getConfig(projectId, agentId);
      const known = new Map(view.config.toolsBuiltin.map((tool) => [tool.name, tool]));
      const kept = definition.tools.builtin.flatMap((name) => {
        const tool = known.get(name);
        if (tool === undefined) {
          skipped.push(
            `Built-in tool "${name}" does not exist in this install; it was not enabled.`,
          );
          return [];
        }
        return [tool];
      });
      if (kept.length > 0) {
        await deps.agentConfig.updateConfig(projectId, agentId, { config: { toolsBuiltin: kept } });
      } else {
        skipped.push(
          "None of the named built-in tools exist in this install; the default toolset was kept.",
        );
      }
    }
    for (const [name, files] of bundle.skills) {
      await replaceSkillDirectory(path.join(skillsDir(deps.root, projectId, agentId), name), files);
      installed.skills.push(name);
    }
    for (const ref of definition.skills) {
      if (!bundle.skills.has(ref.name)) {
        skipped.push(
          `Skill "${ref.name}" is named by the definition but the bundle carries no skills/${ref.name}/ directory; install it separately.`,
        );
      }
    }
    for (const [name, hook] of bundle.hooks) {
      await installHook(deps.root, projectId, agentId, hook.manifest, hook.files, hook.icon);
      installed.hooks.push(name);
    }
    for (const ref of definition.hooks) {
      if (!bundle.hooks.has(ref.name)) {
        skipped.push(
          `Hook package "${ref.name}" is named by the definition but the bundle carries no hooks/${ref.name}/ directory; install it separately.`,
        );
      }
    }
  } catch (err) {
    await deps.agents.deleteAgent(projectId, agentId).catch(() => undefined);
    throw err;
  }
  // The listing recounts skills, hooks and tools after the installs; the creation-time item
  // stands in if the Agent is somehow missing from it.
  const item =
    (await deps.agents.listAgents(projectId)).find((entry) => entry.agentId === agentId) ?? created;
  return { item, installed, skipped, vaultKeys: definition.vaultKeys ?? [] };
}
