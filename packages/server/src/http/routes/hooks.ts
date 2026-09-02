/**
 * An Agent's installed hook packages:
 *   GET    /api/projects/:p/agents/:a/hooks               # installed packages (any member)
 *   PATCH  /api/projects/:p/agents/:a/hooks/:name         # switch one on or off (owner only)
 *   POST   /api/projects/:p/agents/:a/hooks/archive       # install one package from an uploaded zip (any member)
 *   GET    /api/projects/:p/agents/:a/hooks/:name/archive # export one installed package as a zip (any member)
 *   DELETE /api/projects/:p/agents/:a/hooks/:name         # uninstall (any member)
 * Installing from the library goes through the plugin routes (plugins.ts), which write a
 * plugin's hook package to agent_state/hooks/<plugin>/ (hooks.json + scripts). The archive
 * routes are the skills routes' pair: POST writes every zip file under hooks/<name>/ (replace
 * semantics with `overwrite`), GET packs the whole directory back under a single top-level
 * <name>/ so the download round-trips through the POST unchanged. Every mutation here — the
 * switch, an import, an uninstall — invalidates the Agent's cached runtimes: hook packages are
 * bound when a core Session is built (skills are read from disk on demand, hooks are not), so a
 * runtime that outlived the change would keep running the old set until it was evicted.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8, zipSync } from "fflate";
import { Hono } from "hono";
import {
  PLUGIN_NAME_PATTERN,
  PLUGIN_VERSION_PATTERN,
  hookPackageEnabled,
  hooksDir,
  listInstalledHooks,
  removeHook,
  replaceSkillDirectory,
  setHookEnabled,
} from "@prismshadow/penguin-core";
import type { HookCommand, HookManifest } from "@prismshadow/penguin-core";
import type { AgentHooksResponse, HookItem } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalBoolean,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import { toHookItem } from "../../services/plugin-library.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from "../../services/skill-import-limits.js";
import { MAX_ARCHIVE_BYTES, assertSafeEntryPath } from "./skills.js";

/** The hook points a manifest lists commands for. */
const HOOK_POINTS = ["stop", "pre_tool_use", "user_prompt"] as const;

/** A hook package decoded from an uploaded zip: its name and every file keyed by path relative to the package directory. */
interface ArchiveHook {
  name: string;
  files: Map<string, Uint8Array>;
}

/** A command path as hooks.json may list it: relative, "/"-separated, no empty or ".." segment — so it resolves inside the package directory. */
function isSafeCommandPath(command: string): boolean {
  return (
    command.length > 0 &&
    !command.startsWith("/") &&
    !/^[A-Za-z]:/.test(command) &&
    !command.includes("\\") &&
    !command.split("/").some((segment) => segment === "" || segment === "..")
  );
}

/**
 * Validates an uploaded manifest against the files beside it and returns the one that is
 * written: the upload with its unknown fields kept (an export re-imports as it was), `name`
 * set to the package's name, the hook-point lists defaulted so the loader and the Session
 * always find arrays, and `enabled` kept only as the `false` the switch writes. What is
 * checked is what those readers rely on: a name in the directory-name character set, string
 * display fields, a boolean `enabled`, and every command a relative path to a file inside the
 * archive — a package whose scripts are missing or point outside its directory is refused.
 */
function normalizeHookManifest(
  raw: unknown,
  name: string | undefined,
  files: ReadonlySet<string>,
): HookManifest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("hooks.json must be a JSON object.");
  }
  const manifest = raw as Record<string, unknown>;
  const resolved = name ?? manifest.name;
  if (typeof resolved !== "string" || !PLUGIN_NAME_PATTERN.test(resolved)) {
    throw badRequest(
      `Invalid hook package name ${JSON.stringify(resolved)}: only letters, digits, "_" and "-" are allowed.`,
    );
  }
  for (const key of ["description", "description_zh", "version"] as const) {
    if (manifest[key] !== undefined && typeof manifest[key] !== "string") {
      throw badRequest(`hooks.json ${key} must be a string.`);
    }
  }
  if (manifest.enabled !== undefined && typeof manifest.enabled !== "boolean") {
    throw badRequest("hooks.json enabled must be a boolean.");
  }
  const lists: Record<(typeof HOOK_POINTS)[number], HookCommand[]> = {
    stop: [],
    pre_tool_use: [],
    user_prompt: [],
  };
  let commands = 0;
  for (const point of HOOK_POINTS) {
    const list = manifest[point];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw badRequest(`hooks.json ${point} must be an array.`);
    for (const entry of list as unknown[]) {
      const cmd = entry as Partial<HookCommand> | null;
      if (cmd === null || typeof cmd !== "object" || typeof cmd.command !== "string") {
        throw badRequest(`hooks.json ${point} entries must be { command, timeout? } objects.`);
      }
      if (!isSafeCommandPath(cmd.command) || !files.has(cmd.command)) {
        throw badRequest(
          `hooks.json ${point} command ${JSON.stringify(cmd.command)} must name a file inside the package.`,
        );
      }
      if (cmd.timeout !== undefined && !(typeof cmd.timeout === "number" && cmd.timeout > 0)) {
        throw badRequest(`hooks.json ${point} timeout must be a positive number of seconds.`);
      }
      commands += 1;
    }
    lists[point] = list as HookCommand[];
  }
  if (commands === 0) throw badRequest("hooks.json lists no hook-point commands.");
  const { enabled, ...rest } = manifest;
  return {
    ...rest,
    name: resolved,
    description: typeof manifest.description === "string" ? manifest.description : "",
    version: typeof manifest.version === "string" ? manifest.version : "",
    ...lists,
    ...(enabled === false ? { enabled: false } : {}),
  } as HookManifest;
}

/**
 * Decodes and validates an uploaded hook package zip. Accepted layouts: hooks.json at the zip
 * root (the name comes from the manifest), or exactly one top-level directory containing
 * hooks.json (the directory name is the package name, consistent with listInstalledHooks
 * where the directory name always wins). Directory entries are ignored (paths recreate
 * them); every file path is zip-slip-checked and the count/size limits enforced before
 * anything is returned. The manifest comes back normalized (see normalizeHookManifest) in
 * place of the uploaded bytes.
 */
function parseHookArchive(archive: Buffer): ArchiveHook {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(archive));
  } catch {
    throw badRequest("dataBase64 is not a valid zip archive.");
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw badRequest("The zip archive contains no files.");
  if (files.length > MAX_ARCHIVE_FILES) {
    throw badRequest(`The zip archive exceeds the ${MAX_ARCHIVE_FILES}-file limit.`);
  }
  let total = 0;
  for (const [name, data] of files) {
    assertSafeEntryPath(name);
    if (data.byteLength > MAX_FILE_BYTES) {
      throw badRequest(`Zip entry exceeds the 5MB uncompressed limit: ${name}`);
    }
    total += data.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw badRequest("The zip archive exceeds the 20MB uncompressed limit.");
    }
  }
  const names = files.map(([name]) => name);
  let prefix = "";
  let dirName: string | undefined;
  if (!names.includes("hooks.json")) {
    const topLevels = new Set(names.map((name) => name.split("/", 1)[0]!));
    dirName = topLevels.size === 1 ? [...topLevels][0] : undefined;
    if (dirName === undefined || !names.includes(`${dirName}/hooks.json`)) {
      throw badRequest(
        "The zip must contain hooks.json at its root, or exactly one top-level directory containing hooks.json.",
      );
    }
    prefix = `${dirName}/`;
  }
  const relative = new Map(files.map(([n, data]) => [n.slice(prefix.length), data]));
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(relative.get("hooks.json")!));
  } catch {
    throw badRequest("hooks.json is not valid JSON.");
  }
  const manifest = normalizeHookManifest(raw, dirName, new Set(relative.keys()));
  relative.set("hooks.json", new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
  return { name: manifest.name, files: relative };
}

/**
 * Collects an installed package directory as zip entries under a single top-level `<name>/`
 * (subpaths preserved, "/" separators), so the export round-trips through the POST archive
 * route unchanged. Symlinks and other non-regular entries are skipped (nothing outside the
 * directory can leak). The import caps apply on the way out too — a directory exceeding them
 * could not be re-imported anyway.
 */
async function collectHookArchive(dir: string, name: string): Promise<Record<string, Uint8Array>> {
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
      count += 1;
      const data = new Uint8Array(await fs.readFile(absChild));
      total += data.byteLength;
      if (
        count > MAX_ARCHIVE_FILES ||
        data.byteLength > MAX_FILE_BYTES ||
        total > MAX_TOTAL_BYTES
      ) {
        throw new HttpError(
          413,
          "hook_too_large",
          `Hook package exceeds the archive limits (${MAX_ARCHIVE_FILES} files, 5MB per file, 20MB total).`,
        );
      }
      out[relChild] = data;
    }
  };
  await walk(dir, name);
  return out;
}

/** /api/projects/:p/agents/:a/hooks: read, import/export and uninstall are Project-member operations; the switch is the owner's. */
export function agentHooksRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const installedItems = async (projectId: string, agentId: string): Promise<HookItem[]> =>
    (await listInstalledHooks(deps.config.root, projectId, agentId)).map(toHookItem);

  /** The install criterion every per-package route shares, the one listInstalledHooks uses: hooks/<name>/hooks.json exists. Returns the package directory. */
  const requireInstalled = async (
    projectId: string,
    agentId: string,
    name: string,
  ): Promise<string> => {
    const dir = path.join(hooksDir(deps.config.root, projectId, agentId), name);
    try {
      await fs.access(path.join(dir, "hooks.json"));
    } catch {
      throw new HttpError(404, "not_found", `Hook package is not installed: ${name}`);
    }
    return dir;
  };

  app.get("/", async (c) => {
    // Defensive id validation happens before any path construction: prevents path traversal for cross-Project privilege escalation.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json({ hooks: await installedItems(projectId, agentId) } satisfies AgentHooksResponse);
  });

  // Install one package from an uploaded zip (member-level, like the skills archive route).
  app.post("/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const overwrite = body.overwrite === true;
    let archive: Buffer;
    try {
      archive = Buffer.from(dataBase64, "base64");
    } catch {
      throw badRequest("dataBase64 is not valid base64.");
    }
    if (archive.byteLength === 0) throw badRequest("The zip archive is empty.");
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw badRequest("The zip archive exceeds the 14MB limit.");
    }
    const hook = parseHookArchive(archive);
    const dir = path.join(hooksDir(deps.config.root, projectId, agentId), hook.name);
    if (!overwrite) {
      const installed = await fs.access(path.join(dir, "hooks.json")).then(
        () => true,
        () => false,
      );
      if (installed) {
        // The name sits at the end of the message: the web tab reads it from there for the
        // overwrite confirmation copy.
        throw new HttpError(409, "hook_exists", `Hook package is already installed: ${hook.name}`);
      }
    }
    // Replace semantics (the same as reinstalling from the library): the archive's files are
    // staged and swapped in, so no stale file survives and an interrupted import leaves no
    // half-written package behind.
    await replaceSkillDirectory(dir, hook.files);
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    return c.json(
      { hooks: await installedItems(projectId, agentId) } satisfies AgentHooksResponse,
      201,
    );
  });

  // Export one installed package as a zip: a direct binary attachment (the shape of the skill
  // export), re-importable byte-compatibly through the POST archive route.
  app.get("/:name/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    const dir = await requireInstalled(projectId, agentId, name);
    const archiveFiles = await collectHookArchive(dir, name);
    // A -v<version> suffix only when the manifest carries a real version (the header is the
    // authority on the filename — the web tab reads it from Content-Disposition).
    let version = "";
    try {
      const manifest = JSON.parse(strFromU8(archiveFiles[`${name}/hooks.json`]!)) as {
        version?: unknown;
      };
      if (typeof manifest.version === "string") version = manifest.version;
    } catch {
      // An unparseable manifest still exports (the files are what the user asked for); it just gets the bare filename.
    }
    const fileName = PLUGIN_VERSION_PATTERN.test(version)
      ? `${name}-v${version}.zip`
      : `${name}.zip`;
    const zip = zipSync(archiveFiles);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        // The name is id-validated ([A-Za-z0-9_-]+), so the encoded filename is itself.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // Switch one package on or off. Owner only: the switch decides what runs on every member's
  // Sessions, the way the Project's policy settings do; members read the state.
  app.patch("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    const enabled = optionalBoolean(await readJson(c), "enabled");
    if (enabled === undefined) throw badRequest("enabled must be a boolean.");
    await requireInstalled(projectId, agentId, name);
    await setHookEnabled(deps.config.root, projectId, agentId, name, enabled);
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    const item = (await installedItems(projectId, agentId)).find((h) => h.name === name);
    if (item === undefined || hookPackageEnabled(item) !== enabled) {
      throw new HttpError(
        500,
        "hook_switch_failed",
        `Hook package ${name} did not take the switch.`,
      );
    }
    return c.json(item);
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    await requireInstalled(projectId, agentId, name);
    await removeHook(deps.config.root, projectId, agentId, name);
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    return c.body(null, 204);
  });

  return app;
}
