/**
 * The Agent archive's import half: an uploaded zip (or an old `.tar.gz` Agent State package)
 * becomes a new Agent, or replaces an existing Agent's State.
 *
 * The upload is streamed to `<agentsDir>/.import-<12 hex>/upload.bin` while its bytes are
 * counted, sniffed (`PK` for a zip, `1f 8b` for gzip), checked and written out in staging
 * (staging.ts, tar-compat.ts), and checked again as a State (state-checks.ts) — all before any
 * Agent is touched. The staging folder goes in `finally`; one a crash left behind is swept at the
 * next import, unless it is marked as holding an Agent's State (state-swap.ts).
 *
 * Create: the Agent is made from the template (AgentService.createAgent), then its State is
 * replaced by the archive's in one swap. Overwrite (the caller has checked the owner): the Agent
 * keeps its identity, Traces, API keys, vault and employment; only its State is replaced, after a
 * backup snapshot. A part the archive leaves out keeps the Agent's own (so do its expired
 * schedules, its workbenches' data when the archive carries none, and anything in its State the
 * archive format does not know), and a credential the export blanked keeps the Agent's own value
 * at the same place. A hand-written archive (a `definition`, no `system_config.yaml`) has its
 * definition applied to a copy of the Agent's own config, validated as the config route validates
 * it; the live config is never written before the swap.
 *
 * Until the swap, any failure leaves the Agent as it was (a created one is removed again, so the
 * id is free). Once the State is swapped the import is committed and answers with its report:
 * the cached runtimes of an overwritten Agent are invalidated, and the archive's Sessions move in
 * one by one (TraceService.importTraceFiles) — one that cannot is skipped and reported.
 */
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  agentDir,
  agentStateDir,
  agentsDir,
  defaultSystemConfig,
  ensureUserMemoryDir,
  loadAgentVault,
} from "@prismshadow/penguin-core";
import type { ToolDefinitionConfig } from "@prismshadow/penguin-core";
import type {
  AgentArchiveImportResponse,
  AgentArchiveManifest,
  AgentArchiveNote,
} from "../api/types.js";
import { HttpError, badRequest } from "../http/errors.js";
import type { AgentConfig, AgentLifecycle, Snapshots } from "../mechanisms/agents.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { TraceIndex, Traces } from "../mechanisms/traces.js";
import type { Workbenches } from "../mechanisms/workbenches.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { updatedConfigText } from "../services/agent-config-service.js";
import type { AgentHolds } from "./agent-hold.js";
import { packageStateVersion, VAULT_BASENAME } from "../services/agent-state-layout.js";
import { SEMANTIC_ID_PATTERN, SEMANTIC_ID_RULE } from "../services/ids.js";
import { countMemoryTopics } from "../services/memory-service.js";
import { removeLeftovers } from "../workbenches/leftovers.js";
import { migrateWorkbenches } from "../workbenches/migrate.js";
import { ensureWorkbenchLinkTarget } from "../workbenches/migrate-state.js";
import { isTempName } from "../workbenches/store.js";
import { MAX_UPLOAD_BYTES, archiveTooLarge } from "./limits.js";
import { DIR_PARTS, PART_DIRS } from "./manifest.js";
import { configParses, credentialsToFill, restoreCredentials } from "./mcp-credentials.js";
import { stageZip } from "./staging.js";
import type { StagedArchive } from "./staging.js";
import { checkIncomingState, stateCounts } from "./state-checks.js";
import { stageTarGz } from "./tar-compat.js";

export interface ImportDeps {
  root: string;
  now: () => Date;
  agentConfigService: AgentConfig;
  agentService: AgentLifecycle;
  snapshots: Snapshots;
  workbenches: Pick<Workbenches, "whileReleased">;
  traces: Pick<Traces, "importTraceFiles">;
  sessionsRepo: Pick<SessionIndex, "deleteByAgent">;
  traceIndex: Pick<TraceIndex, "removeAgent">;
  /** The cached runtimes of an Agent whose State an overwrite replaced. */
  runtimes: Pick<SessionManager, "invalidateAgentRuntimes">;
  /** One import at a time per Agent (agent-hold.ts). */
  holds: AgentHolds;
  log: (line: string) => void;
}

export interface ImportRequest {
  projectId: string;
  /** The `agentId` query; the manifest's, then the zip's top-level directory, when absent. */
  agentId?: string;
  /** `overwrite=1`: replace the Agent's State when the id is taken. */
  overwrite: boolean;
  body: ReadableStream<Uint8Array> | null;
}

/** The response, but for the Agent's card, which the route reads once the import is done. */
export interface ImportOutcome extends Omit<AgentArchiveImportResponse, "agent"> {
  agentId: string;
}

/** Where an import stages its upload, beside the Agents; a dot name, which no Agent id is. */
const STAGING_PREFIX = ".import-";

/** The names a State holds that the archive format knows; anything else is the Agent's own. */
const KNOWN_STATE_NAMES = new Set<string>([
  "system_config.yaml",
  "AGENTS.md",
  "tools",
  VAULT_BASENAME,
  ...Object.values(PART_DIRS),
]);

const exists = (file: string): Promise<boolean> =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

function requireAgentId(agentId: string): string {
  if (!SEMANTIC_ID_PATTERN.test(agentId)) {
    throw new HttpError(
      400,
      "invalid_agent_id",
      `Agent id must be 2–64 characters: ${SEMANTIC_ID_RULE}.`,
    );
  }
  return agentId;
}

function agentExists(agentId: string): HttpError {
  return new HttpError(
    409,
    "agent_exists",
    `Agent id is already taken: ${agentId}. Choose another id, or overwrite that Agent.`,
    undefined,
    { agentId },
  );
}

/** Streams the request body to `file`, refusing it past the upload cap; answers its size. */
async function receive(body: ReadableStream<Uint8Array> | null, file: string): Promise<number> {
  if (body === null) throw badRequest("The request carries no archive.");
  let bytes = 0;
  const counted = async function* (source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      bytes += chunk.byteLength;
      if (bytes > MAX_UPLOAD_BYTES) {
        throw archiveTooLarge("The archive exceeds the 100MiB upload limit.");
      }
      yield chunk;
    }
  };
  await pipeline(
    Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
    counted,
    createWriteStream(file),
  );
  if (bytes === 0) throw badRequest("The request carries no archive.");
  return bytes;
}

async function sniff(file: string): Promise<"zip" | "tar.gz"> {
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    if (head[0] === 0x50 && head[1] === 0x4b) return "zip";
    if (head[0] === 0x1f && head[1] === 0x8b) return "tar.gz";
  } finally {
    await handle.close();
  }
  throw badRequest("The file is neither a zip nor a .tar.gz Agent State package.");
}

/** What the archive brings, per part, counted in staging (before the State moves in). */
async function importedCounts(
  staged: StagedArchive,
): Promise<AgentArchiveImportResponse["imported"]> {
  const { parts } = staged.manifest;
  const state = staged.stateDir;
  const counts = await stateCounts(state);
  const schedules = await fs.readdir(path.join(state, "schedule")).catch(() => []);
  return {
    skills: parts.skills ? counts.skills : 0,
    hooks: parts.hooks ? counts.hooks : 0,
    // Memories as the Agent card counts them: topic files, not indexes or markers.
    memoryFiles: parts.memory ? await countMemoryTopics(path.join(state, "memory")) : 0,
    workbenches: parts.workbenches ? counts.workbenches : 0,
    schedules: parts.schedules ? schedules.filter((name) => name.endsWith(".toml")).length : 0,
    traces: { sessions: 0, files: 0 },
  };
}

/**
 * The entries of the Agent's current State that the new one keeps, relative to `agent_state/`:
 * the directory of every part the manifest marks false, the expired schedules when the archive
 * brings schedules, each workbench's data when the archive brings the workbench without it, the
 * instructions and tools when the archive has none (a hand-written one), and whatever the State
 * holds that the archive format does not know.
 */
async function carriedPaths(
  current: string,
  incoming: string,
  manifest: AgentArchiveManifest,
  handWritten: boolean,
): Promise<string[]> {
  const carry: string[] = [];
  const keep = async (rel: string): Promise<void> => {
    if (await exists(path.join(current, ...rel.split("/")))) carry.push(rel);
  };
  for (const part of DIR_PARTS) {
    if (!manifest.parts[part]) await keep(PART_DIRS[part]);
  }
  if (manifest.parts.schedules && !(await exists(path.join(incoming, "schedule", "expired")))) {
    await keep("schedule/expired");
  }
  if (manifest.parts.workbenches && !manifest.parts.workbenchData) {
    for (const id of await fs.readdir(path.join(incoming, "workbenches")).catch(() => [])) {
      await keep(`workbenches/${id}/state.json`);
    }
  }
  if (!(await exists(path.join(incoming, "AGENTS.md")))) await keep("AGENTS.md");
  if (handWritten && !(await exists(path.join(incoming, "tools")))) await keep("tools");
  for (const name of await fs.readdir(current).catch(() => [])) {
    if (KNOWN_STATE_NAMES.has(name) || isTempName(name)) continue;
    if (!(await exists(path.join(incoming, name)))) carry.push(name);
  }
  return carry;
}

/**
 * A hand-written archive's definition applied to `config` (the Agent's own config, copied — the
 * live file is never written before the swap), validated as `PUT …/config` validates it: name and
 * description, model preferences, MCP servers, and the built-in tools it names, selected from
 * the toolset that config carries. A name this install does not ship cannot be conjured and goes
 * to `notes`; a selection that keeps nothing keeps the toolset as it is.
 */
function definitionConfig(
  config: string,
  manifest: AgentArchiveManifest,
  notes: AgentArchiveNote[],
): string {
  const definition = manifest.definition ?? {};
  let toolsBuiltin;
  if (definition.tools !== undefined && definition.tools.builtin.length > 0) {
    const builtin = (
      parseYaml(config) as { tools?: { builtin?: Array<{ name?: unknown }> } } | null
    )?.tools?.builtin;
    const known = new Map(
      (Array.isArray(builtin) ? builtin : []).flatMap((tool) =>
        typeof tool?.name === "string" ? [[tool.name, tool] as const] : [],
      ),
    );
    toolsBuiltin = definition.tools.builtin.flatMap((name) => {
      const tool = known.get(name);
      if (tool === undefined) {
        notes.push({
          code: "unknown_tool",
          subject: name,
          message: `Built-in tool "${name}" does not exist in this install; it was not enabled.`,
        });
        return [];
      }
      return [tool as unknown as ToolDefinitionConfig];
    });
    if (toolsBuiltin.length === 0) {
      notes.push({
        code: "no_known_tools",
        message: "None of the named built-in tools exist in this install; the toolset was kept.",
      });
      toolsBuiltin = undefined;
    }
  }
  return updatedConfigText(config, {
    ...(manifest.name !== undefined ? { name: manifest.name } : {}),
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    ...(definition.model !== undefined ? { model: definition.model } : {}),
    ...(definition.mcpServers !== undefined ? { mcpServers: definition.mcpServers } : {}),
    ...(toolsBuiltin !== undefined ? { toolsBuiltin } : {}),
  });
}

/** Removes an Agent this import created and could not finish, so its id is free again. */
async function removeHalfBuilt(
  deps: ImportDeps,
  projectId: string,
  agentId: string,
): Promise<void> {
  await deps.agentService.deleteAgent(projectId, agentId).catch(() => undefined);
  deps.sessionsRepo.deleteByAgent(projectId, agentId);
  deps.traceIndex.removeAgent(projectId, agentId);
}

/** Turns the staged archive into the Agent: created, or its State replaced. */
async function apply(
  deps: ImportDeps,
  projectId: string,
  agentId: string,
  staged: StagedArchive,
  mode: "created" | "overwritten",
  imported: AgentArchiveImportResponse["imported"],
): Promise<ImportOutcome> {
  const { manifest } = staged;
  const dir = agentDir(deps.root, projectId, agentId);
  const current = agentStateDir(deps.root, projectId, agentId);
  const incoming = staged.stateDir;
  let previousVersion: number | undefined;
  let backup: string | undefined;
  if (mode === "created") {
    await deps.agentService.createAgent(projectId, agentId, manifest.name, manifest.description);
  } else {
    // Workbenches still in an older layout move in first, so the backup holds them.
    await migrateWorkbenches(dir);
    previousVersion = await deps.snapshots.currentVersion(projectId, agentId);
    backup = await deps.snapshots.backupBeforeImport(projectId, agentId);
  }
  const notes: AgentArchiveNote[] = [];
  try {
    await fs.mkdir(incoming, { recursive: true });
    const configFile = path.join(incoming, "system_config.yaml");
    const currentConfig = await fs
      .readFile(path.join(current, "system_config.yaml"), "utf8")
      .catch(() => "");
    // An Agent whose config does not parse can still be replaced from a file: that is how it
    // is repaired. Nothing is refilled from it, and a hand-written zip starts from the defaults.
    const currentParses = configParses(currentConfig) && currentConfig.trim() !== "";
    if (!staged.hasConfig) {
      const base = currentParses ? currentConfig : stringifyYaml(defaultSystemConfig());
      await fs.writeFile(configFile, definitionConfig(base, manifest, notes));
    }
    if (mode === "overwritten" && currentParses) {
      // A blank credential keeps the Agent's own value, for the same server and place only.
      const restored = restoreCredentials(await fs.readFile(configFile, "utf8"), currentConfig);
      if (restored !== null) await fs.writeFile(configFile, restored);
    } else if (mode === "overwritten") {
      notes.push({
        code: "current_config_invalid",
        message:
          "The Agent's own system_config.yaml did not parse, so no blanked credential was filled from it.",
      });
    }
    const carry = await carriedPaths(current, incoming, manifest, !staged.hasConfig);
    for (const layout of ["skills", "hooks", "tools"]) {
      if (!carry.includes(layout)) await fs.mkdir(path.join(incoming, layout), { recursive: true });
    }
    // What the server holds open in the State lets go until the swap is over (Windows cannot
    // rename a watched directory).
    await deps.workbenches.whileReleased(projectId, agentId, async () => {
      await deps.snapshots.swapAgentState(projectId, agentId, incoming, carry, backup ?? null);
      // A State without workbenches would leave the old place's link leading nowhere.
      await ensureWorkbenchLinkTarget(dir).catch((err: unknown) => {
        deps.log(`[agent-archive] workbench link of ${projectId}/${agentId}: ${String(err)}`);
      });
    });
  } catch (err) {
    if (mode === "created") await removeHalfBuilt(deps, projectId, agentId);
    throw err;
  }
  // The State is swapped: the import is committed, and nothing below turns it into an error.
  if (mode === "overwritten") deps.runtimes.invalidateAgentRuntimes(projectId, agentId);
  await ensureUserMemoryDir(deps.root, projectId, agentId).catch(() => undefined);
  let traces: Awaited<ReturnType<Traces["importTraceFiles"]>>;
  try {
    traces = await deps.traces.importTraceFiles(projectId, agentId, staged.sessions);
  } catch (err) {
    deps.log(`[agent-archive] Sessions of ${projectId}/${agentId} not imported: ${String(err)}`);
    traces = {
      imported: { sessions: 0, files: 0 },
      skipped: staged.sessions.map((s) => ({
        sessionId: s.facts.sessionId,
        reason: "invalid" as const,
        detail: "It could not be moved in.",
      })),
    };
  }
  return report(deps, projectId, agentId, staged, mode, {
    imported: { ...imported, traces: traces.imported },
    notes,
    traces,
    ...(previousVersion !== undefined ? { previousVersion } : {}),
    ...(backup !== undefined ? { backup } : {}),
  });
}

/** The import's account of itself, read back from the Agent as it now is. */
async function report(
  deps: ImportDeps,
  projectId: string,
  agentId: string,
  staged: StagedArchive,
  mode: "created" | "overwritten",
  done: {
    imported: AgentArchiveImportResponse["imported"];
    notes: AgentArchiveNote[];
    traces: Awaited<ReturnType<Traces["importTraceFiles"]>>;
    previousVersion?: number;
    backup?: string;
  },
): Promise<ImportOutcome> {
  // Read back defensively: the State is committed, so a read that fails costs a detail of the
  // report, never the answer.
  const state = agentStateDir(deps.root, projectId, agentId);
  const vault = await loadAgentVault(deps.root, projectId, agentId).catch(() => ({}));
  const fill = await fs
    .readFile(path.join(state, "system_config.yaml"), "utf8")
    .then(credentialsToFill)
    .catch(() => ({ blank: [] as string[], vaultRefs: [] as string[] }));
  const missingKeys = [...new Set([...staged.manifest.vaultKeys, ...fill.vaultRefs])].filter(
    (key) => !Object.hasOwn(vault, key),
  );
  return {
    agentId,
    mode,
    version: await deps.snapshots
      .currentVersion(projectId, agentId)
      .catch(() => staged.manifest.source?.version ?? 1),
    ...(done.previousVersion !== undefined ? { previousVersion: done.previousVersion } : {}),
    ...(done.backup !== undefined ? { backup: done.backup } : {}),
    imported: done.imported,
    skippedTraces: done.traces.skipped,
    toFill: [...missingKeys, ...fill.blank],
    notes: done.notes,
  };
}

/** Imports one uploaded archive into `req.projectId` (access is the route's to check). */
export async function importAgentArchive(
  deps: ImportDeps,
  req: ImportRequest,
): Promise<ImportOutcome> {
  const { projectId } = req;
  if (req.agentId !== undefined) requireAgentId(req.agentId);
  const taken = async (agentId: string): Promise<boolean> =>
    (await deps.agentService.takenAgentIds(projectId)).includes(agentId);
  // A taken id is refused before the upload is even read, when the request names it.
  if (req.agentId !== undefined && !req.overwrite && (await taken(req.agentId))) {
    throw agentExists(req.agentId);
  }
  const base = agentsDir(deps.root, projectId);
  await fs.mkdir(base, { recursive: true });
  await removeLeftovers(base, STAGING_PREFIX);
  const staging = path.join(base, `${STAGING_PREFIX}${randomBytes(6).toString("hex")}`);
  await fs.mkdir(staging);
  try {
    const upload = path.join(staging, "upload.bin");
    await receive(req.body, upload);
    const kind = await sniff(upload);
    const extracted = path.join(staging, "extracted");
    await fs.mkdir(extracted);
    const staged =
      kind === "zip"
        ? await stageZip(upload, extracted)
        : await stageTarGz(upload, extracted, deps.now());
    await fs.rm(upload, { force: true });
    if (kind === "tar.gz" && req.agentId === undefined) {
      throw badRequest(
        "A .tar.gz Agent State package names no Agent: send the agentId to import it as.",
      );
    }
    const agentId = requireAgentId(req.agentId ?? (staged.manifest.agentId || staged.topDir || ""));
    if (staged.hasConfig) await packageStateVersion(staged.stateDir);
    else if (staged.manifest.definition === undefined) {
      throw badRequest(
        "The archive has neither agent_state/system_config.yaml nor a definition in manifest.json.",
      );
    }
    // A zip's State is checked as the Skills, hooks and workbench lists will read it; an old
    // package imports as it always did.
    if (kind === "zip") await checkIncomingState(staged.stateDir);
    const imported = await importedCounts(staged);
    // Everything from here on decides about the Agent and changes it: under its hold.
    return await deps.holds.hold(`${projectId}/${agentId}`, async () => {
      // An earlier import of this Agent that was interrupted gives back what it moved aside.
      await deps.snapshots.recoverStrandedSwaps({ projectId, agentId });
      const isAgent = await deps.agentConfigService.exists(projectId, agentId);
      if (!isAgent && (await taken(agentId))) throw agentExists(agentId);
      if (isAgent && !req.overwrite) throw agentExists(agentId);
      return apply(deps, projectId, agentId, staged, isAgent ? "overwritten" : "created", imported);
    });
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
