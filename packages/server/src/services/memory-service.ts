/**
 * Memory management (`agent_state/memory/`): the Web App's read/delete access to what the Agent
 * remembers between Sessions.
 *
 * The layout is core's (see core's state/memory.ts): one directory per scope holding Markdown
 * topic files and that scope's own `MEMORY.md` index — `memory/user/` for the User scope and
 * `memory/<workspace_key>/` for each Workspace. A topic may keep files — reusable scripts, any
 * number, at any depth — in a folder named after it without the `.md` (`csv-tools/` beside
 * `csv-tools.md`); the topic and its folder are one memory, listed, deleted and moved together,
 * and the index lists the topic only. A folder with no topic of its name beside it belongs to no
 * memory: it is listed apart so nothing in the scope is hidden. The User scope is addressed
 * through the same `scopeKey` parameter as any Workspace (`USER_SCOPE_KEY`), so it needs no
 * routes of its own; the one difference is that it may be created on demand, since it belongs to
 * the Agent rather than to a Session that has run.
 *
 * Per-file content changes go through a chat Session where the model edits the same files,
 * keeping frontmatter and index in step; this service's own writes are the mechanical ones a
 * model cannot be asked for. Deleting a topic file drops its `](<file>)` index lines, so the
 * index never lists a file that is gone. Whole-scope import writes the files a transfer
 * document carries and adds their index lines, the same invariant read the other way: the
 * index never omits a file that arrived. Only the indexes enter the model's context (core's
 * state/memory.ts), so an unindexed topic file would be a file the Agent never reads.
 *
 * This service never invents paths from client input — a request names an `agentId`, a
 * `scopeKey` and a file inside that scope, each validated against a character rule and then
 * re-checked for containment after resolution, so neither `..` nor a symlink can reach outside
 * the Agent's Memory directory. A kept file's path is walked segment by segment with lstat, so
 * a folder or file planted as a symlink is never followed; its text is read only up to the
 * transfer document's per-file bound, and only as UTF-8.
 *
 * Files are the source of truth and are read fresh on every request (they are small, requests
 * are rare, and the model edits the same files from its side).
 */
import { isUtf8 } from "node:buffer";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_INDEX_FILENAME,
  USER_SCOPE_KEY,
  atomicWriteFile,
  hasMemoryPlaceholder,
  insertMemoryPlaceholder,
  memoryDir,
  memoryScopeDir,
  parseMemoryFrontmatter,
  readWorkspaceMarker,
} from "@prismshadow/penguin-core";
import type {
  MemoryFileInfo,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryFolderFile,
  MemoryFolderFileResponse,
  MemoryImportMode,
  MemoryImportResponse,
  MemoryOmittedFile,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MemoryScopeInfo,
  MemoryTransferFile,
  MemoryTransferFolderFile,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Config, Paths } from "../hmr/capabilities.js";
import type { AgentConfig, Memory } from "../mechanisms/agents.js";
import {
  MEMORY_FILE_MAX_BYTES,
  SCOPE_FORMAT,
  SCOPE_FORMAT_VERSION,
  parseTransferDocument,
} from "./memory-transfer-document.js";

/** Scope directory names: what core's key generator produces (a safe base may start with `_`), plus the leeway of a hand-made directory. Excludes `.`/`..` and any separator, so the name can never climb out of `memory/`. */
const SCOPE_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Matches an index line's Markdown link to one file — `](file)`, `](./file)`, `](<file>)`,
 * `](file "title")`. A prose mention of the name is not a link and never matches, which is what
 * keeps both index edits (prune on delete, extend on import) mechanical rather than clever.
 */
function indexLinkPattern(fileName: string): RegExp {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\]\\(\\s*<?(?:\\./)?${escaped}>?\\s*(?:"[^"]*"\\s*)?\\)`);
}

/** Whether a name could be one path component inside a scope: not empty, not a dotfile (the Harness's own and every temporary write are), and no path separator. */
function isPlainName(name: string): boolean {
  return name.length > 0 && !name.startsWith(".") && !/[/\\]/.test(name);
}

/**
 * Whether a name is a topic file: any Markdown file that is not a dotfile (`.workspace` is the
 * Harness's), carries no path separator, and is not the index under any casing — macOS and
 * Windows resolve `memory.md` to `MEMORY.md`. The model writes these files with the ordinary
 * file tools, so non-ASCII names are as legitimate as kebab-case ones; the same rule guards
 * client-supplied names, with containment re-checked after resolution.
 */
export function isTopicFileName(name: string): boolean {
  return (
    isPlainName(name) &&
    name.toLowerCase().endsWith(".md") &&
    name.toLowerCase() !== MEMORY_INDEX_FILENAME.toLowerCase()
  );
}

/** The folder a topic keeps its files in: its file name without the `.md`. */
function topicFolderName(topicName: string): string {
  return topicName.slice(0, -".md".length);
}

/**
 * Orders file names identically on every host. `localeCompare` is deliberately not used here:
 * with no locale argument it follows the server's own locale, so the same scope listed its files
 * one way under `en_US.UTF-8` and another under `zh_CN.UTF-8` — and that order is what an export
 * document carries. Case-folded first, so `Alpha.md` still sorts between `a.md` and `beta.md`
 * rather than jumping ahead of both as raw code units would; ties then fall back to code units so
 * the order is total. `toLowerCase`, never `toLocaleLowerCase` — the locale-aware one would put
 * the dependency straight back.
 */
function compareFileNames(a: string, b: string): number {
  const foldedA = a.toLowerCase();
  const foldedB = b.toLowerCase();
  if (foldedA !== foldedB) return foldedA < foldedB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A directory's entries with plain names, in the host-independent order; none when it cannot be read. Dirents never follow a symlink. */
async function plainEntries(dir: string): Promise<Dirent[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => isPlainName(e.name))
      .sort((a, b) => compareFileNames(a.name, b.name));
  } catch {
    return [];
  }
}

/**
 * Every regular file under one folder of a scope, depth first, each directory's entries in name
 * order. A symlink — to a file or to a folder — is neither: it is skipped, never followed, so a
 * listing cannot be led outside the scope. Dotfiles and dot-folders stay out like everywhere else.
 */
async function folderFiles(scopeDir: string, folder: string): Promise<MemoryFolderFile[]> {
  const files: MemoryFolderFile[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await plainEntries(path.join(scopeDir, rel))) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.lstat(path.join(scopeDir, child));
          if (stat.isFile()) {
            files.push({ path: child, size: stat.size, modifiedAt: stat.mtime.toISOString() });
          }
        } catch {
          // Raced with a delete: leave it out of the listing.
        }
      }
    }
  };
  await walk(folder);
  return files;
}

/** What one scope directory holds: its topic files, and every real folder beside them with the files under it. */
interface ScopeScan {
  topics: string[];
  folders: Map<string, MemoryFolderFile[]>;
}

async function scanScope(dir: string): Promise<ScopeScan> {
  const entries = await plainEntries(dir);
  const topics = entries.filter((e) => e.isFile() && isTopicFileName(e.name)).map((e) => e.name);
  const folders = new Map<string, MemoryFolderFile[]>();
  for (const entry of entries) {
    if (entry.isDirectory()) folders.set(entry.name, await folderFiles(dir, entry.name));
  }
  return { topics, folders };
}

/**
 * The scan's folders that belong to no topic: no `<folder>.md` beside them, and at least one file
 * to list. A folder holding nothing listable (empty, or only dotfiles and links) shows nothing and
 * holds nothing an import could lose, so it counts as no folder at all.
 */
function orphanFolders(scan: ScopeScan): string[] {
  const kept = new Set(scan.topics.map(topicFolderName));
  return [...scan.folders.entries()]
    .filter(([folder, files]) => !kept.has(folder) && files.length > 0)
    .map(([folder]) => folder);
}

/**
 * Whether every folder on the way to a file to be written is a real directory or not there yet,
 * and the file's own place is not a directory — lstat throughout, so a link planted anywhere on
 * the way (a topic's folder, or a folder inside it) is never written through.
 */
async function writablePath(dir: string, target: string): Promise<boolean> {
  const segments = path.relative(dir, target).split(path.sep);
  let at = dir;
  for (const segment of segments.slice(0, -1)) {
    at = path.join(at, segment);
    const state = await directoryState(at);
    if (state === "invalid") return false;
    if (state === "absent") return true;
  }
  return (await directoryState(target)) !== "directory";
}

/** Topic files of one scope: regular Markdown files only — the index, the `.workspace` marker, folders and symlinks (dirents that are not regular files) all stay out. */
async function topicFileNames(dir: string): Promise<string[]> {
  return (await plainEntries(dir))
    .filter((e) => e.isFile() && isTopicFileName(e.name))
    .map((e) => e.name);
}

/** A kept file's text as the routes may hand it out, or why it may not be. */
type BoundedText =
  | { ok: true; content: string; size: number; mtime: Date }
  | { ok: false; reason: "too_large" | "not_text"; size: number; mtime: Date };

/**
 * Reads a kept file for a reader that needs its text: its text, or the reason it is withheld —
 * over the per-file bound (decided from the size, before reading), or not UTF-8 text. A NUL byte
 * counts as not text, since an import refuses one and the export would otherwise hand out a
 * document that cannot come back. Null when it is absent or not a regular file (lstat).
 */
async function readBoundedText(target: string): Promise<BoundedText | null> {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile()) return null;
    if (stat.size > MEMORY_FILE_MAX_BYTES) {
      return { ok: false, reason: "too_large", size: stat.size, mtime: stat.mtime };
    }
    const bytes = await fs.readFile(target);
    if (!isUtf8(bytes) || bytes.includes(0)) {
      return { ok: false, reason: "not_text", size: stat.size, mtime: stat.mtime };
    }
    return { ok: true, content: bytes.toString("utf8"), size: stat.size, mtime: stat.mtime };
  } catch {
    return null;
  }
}

/** What stands at a path: a real directory, nothing, or something else (a file, a symlink) that must not be written through. */
async function directoryState(target: string): Promise<"directory" | "absent" | "invalid"> {
  try {
    return (await fs.lstat(target)).isDirectory() ? "directory" : "invalid";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "invalid";
  }
}

/** Removes a topic's folder when it is a real directory; anything else at that name (a file, a symlink) is not the topic's folder and is left alone. */
async function removeFolder(target: string): Promise<void> {
  if ((await directoryState(target)) !== "directory") return;
  // fs.rm unlinks a symlink inside the tree rather than following it.
  await fs.rm(target, { recursive: true, force: true });
}

@Component()
export class MemoryService implements Memory {
  @Use() private readonly paths!: Paths;
  private get root(): string {
    return this.paths.root;
  }
  @Use() private readonly agentConfigService!: AgentConfig;

  /** The tab's landing payload: the Agent-level switch and one entry per scope directory. */
  async overview(projectId: string, agentId: string): Promise<MemoryOverviewResponse> {
    const view = await this.agentConfigService.getConfig(projectId, agentId);
    return {
      enabled: view.config.memory.enabled,
      templateHasMemory: hasMemoryPlaceholder(view.config.systemPrompt),
      memoryDir: memoryDir(this.root, projectId, agentId),
      scopes: await this.listScopes(projectId, agentId),
    };
  }

  /**
   * Inserts the `{{MEMORY}}` placeholder into the Agent's prompt template — the explicit
   * adoption path for an Agent created before Memory shipped; nothing inserts automatically.
   * Idempotent: a template that already carries it is left as it is (the refreshed overview
   * reports `templateHasMemory` either way).
   */
  async insertTemplatePlaceholder(
    projectId: string,
    agentId: string,
  ): Promise<MemoryOverviewResponse> {
    const view = await this.agentConfigService.getConfig(projectId, agentId);
    const next = insertMemoryPlaceholder(view.config.systemPrompt);
    if (next !== view.config.systemPrompt) {
      await this.agentConfigService.updateConfig(projectId, agentId, {
        config: { systemPrompt: next },
      });
    }
    return this.overview(projectId, agentId);
  }

  /**
   * The scope directories under `memory/`: the User scope first — always listed, even before it
   * exists on disk, so a memory can be filed there without waiting for a Session to create it —
   * then the Workspaces, newest activity first (one with no memory yet sorts last, by key).
   */
  async listScopes(projectId: string, agentId: string): Promise<MemoryScopeInfo[]> {
    const base = memoryDir(this.root, projectId, agentId);
    let entries: string[] = [];
    try {
      entries = (await fs.readdir(base, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && e.name !== USER_SCOPE_KEY)
        .map((e) => e.name);
    } catch {
      // No memory/ directory yet (never initialized): the User scope entry below still stands.
    }
    const workspaces = await Promise.all(
      entries.map((key) => this.scopeInfo(path.join(base, key), key, "workspace")),
    );
    workspaces.sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      if (a.updatedAt) return -1;
      if (b.updatedAt) return 1;
      return a.scopeKey.localeCompare(b.scopeKey);
    });
    const userScope = await this.scopeInfo(path.join(base, USER_SCOPE_KEY), USER_SCOPE_KEY, "user");
    return [userScope, ...workspaces];
  }

  private async scopeInfo(
    dir: string,
    key: string,
    kind: MemoryScopeInfo["kind"],
  ): Promise<MemoryScopeInfo> {
    const scan = await scanScope(dir);
    let latest = 0;
    for (const name of scan.topics) {
      try {
        latest = Math.max(latest, (await fs.stat(path.join(dir, name))).mtimeMs);
      } catch {
        // Raced with a delete: leave it out of the timestamp.
      }
      for (const file of scan.folders.get(topicFolderName(name)) ?? []) {
        latest = Math.max(latest, Date.parse(file.modifiedAt));
      }
    }
    const workspacePath = kind === "workspace" ? await readWorkspaceMarker(dir) : undefined;
    return {
      scopeKey: key,
      kind,
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      fileCount: scan.topics.length,
      hasIndex: await this.hasIndexFile(dir),
      ...(latest > 0 ? { updatedAt: new Date(latest).toISOString() } : {}),
    };
  }

  /**
   * Whether the scope holds its own `MEMORY.md`. lstat, not stat: a symlink planted at that name
   * is not an index — treating it as one would carry a read or a write outside the Memory
   * directory, and the atomic write below replaces such a link instead of following it.
   */
  private async hasIndexFile(dir: string): Promise<boolean> {
    try {
      return (await fs.lstat(path.join(dir, MEMORY_INDEX_FILENAME))).isFile();
    } catch {
      return false;
    }
  }

  /** One scope's topic files with their frontmatter and the files each keeps, then the files that belong to no topic. */
  async listFiles(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryFilesResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const scan = await scanScope(dir);
    const files: MemoryFileInfo[] = [];
    for (const name of scan.topics) {
      const info = await this.fileInfo(dir, name, scan.folders.get(topicFolderName(name)) ?? []);
      if (info) files.push(info);
    }
    const orphanFiles = orphanFolders(scan).flatMap((folder) => scan.folders.get(folder) ?? []);
    return { scopeKey, files, orphanFiles };
  }

  /** One topic file's content, with the files it keeps. */
  async readFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    fileName: string,
  ): Promise<MemoryFileResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const target = this.resolveFile(dir, fileName);
    try {
      // lstat, not stat: a symlink planted among the topic files (the model can create one with
      // its file tools) must not lead the read outside the Memory directory. A non-regular file
      // — or one deleted between the calls — is a 404, never a 500.
      const stat = await fs.lstat(target);
      if (!stat.isFile()) throw new Error("not a regular file");
      const content = await fs.readFile(target, "utf8");
      const kept = await folderFiles(dir, topicFolderName(fileName));
      return {
        scopeKey,
        file: this.describe(fileName, content, stat.size, stat.mtime, kept),
        content,
      };
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
  }

  /**
   * One kept file's text, by its path in the scope (a topic's folder or a folder that belongs to
   * none). Handed out only as text and only up to the per-file bound: past it the answer is 413,
   * and a file that is not UTF-8 text is 415, each saying why — the listing still shows the file,
   * so its owner can see it is there.
   */
  async readFolderFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    filePath: string,
  ): Promise<MemoryFolderFileResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const target = await this.requireFolderFile(dir, filePath);
    const read = await readBoundedText(target);
    if (read === null) throw this.folderFileNotFound(filePath);
    if (!read.ok) {
      throw read.reason === "too_large"
        ? new HttpError(
            413,
            "memory_file_too_large",
            `${filePath} is ${Math.ceil(read.size / 1024)} KB; a kept file is shown up to ${MEMORY_FILE_MAX_BYTES / 1024} KB.`,
          )
        : new HttpError(415, "memory_file_not_text", `${filePath} is not UTF-8 text.`);
    }
    return {
      scopeKey,
      file: { path: filePath, size: read.size, modifiedAt: read.mtime.toISOString() },
      content: read.content,
    };
  }

  /**
   * The whole scope as one transfer document: every topic file with the files it keeps, and the
   * scope's own `MEMORY.md`.
   *
   * JSON rather than an archive, because the payload is entirely UTF-8 text and the import side
   * of it is an untrusted write into the Agent's Memory directory: a JSON document carries no
   * permissions and no compression, and its entries are names and relative paths that go through
   * the same checks every other write here uses, with nothing to unpack first.
   *
   * Unreadable entries are left out rather than failing the export, as elsewhere in this service.
   * A kept file over the per-file bound or not UTF-8 text is left out too, and so is every file
   * in a folder that belongs to no topic; each is named in `omitted`, so the reader can say what
   * did not travel. The import bounds otherwise apply to import only — an export reports what the
   * directory actually holds, and a scope grown past them is exactly the thing its owner needs to
   * see.
   */
  async exportScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryScopeExport> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const scan = await scanScope(dir);
    const files: MemoryTransferFile[] = [];
    const omitted: MemoryOmittedFile[] = [];
    for (const name of scan.topics) {
      const content = await this.readTextFile(path.join(dir, name));
      if (content === null) continue;
      const folder = topicFolderName(name);
      const kept: MemoryTransferFolderFile[] = [];
      for (const file of scan.folders.get(folder) ?? []) {
        const read = await readBoundedText(path.join(dir, file.path));
        if (read === null) continue;
        if (read.ok) kept.push({ path: file.path.slice(folder.length + 1), content: read.content });
        else omitted.push({ path: file.path, size: read.size, reason: read.reason });
      }
      files.push(kept.length > 0 ? { name, content, files: kept } : { name, content });
    }
    for (const folder of orphanFolders(scan)) {
      for (const file of scan.folders.get(folder) ?? []) {
        omitted.push({ path: file.path, size: file.size, reason: "orphan" });
      }
    }
    const kind = scopeKey === USER_SCOPE_KEY ? "user" : "workspace";
    const workspacePath = kind === "workspace" ? await readWorkspaceMarker(dir) : undefined;
    return {
      format: SCOPE_FORMAT,
      version: SCOPE_FORMAT_VERSION,
      scopeKey,
      kind,
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      exportedAt: new Date().toISOString(),
      index: (await this.hasIndexFile(dir))
        ? await this.readTextFile(path.join(dir, MEMORY_INDEX_FILENAME))
        : null,
      files,
      omitted,
    };
  }

  /**
   * Writes a transfer document into one scope.
   *
   * A topic moves with its folder, so every decision below is made per topic. The default mode
   * keeps every topic already on disk and writes only topics the scope does not have, so an
   * import can never cost the user a memory they did not agree to lose. `overwrite` replaces a
   * same-named topic — its folder replaced by the document's files, since the topic's text
   * describes those — and `replace` additionally deletes every topic the document does not carry,
   * its folder with it, and every folder that belongs to no topic. A folder with no topic of its
   * name counts as that topic being present, so `skip` keeps it and the two others replace it.
   * Both destructive modes are refused with 409 unless `confirm` is set — but only when they
   * would actually destroy something, since a confirmation that names nothing is just a click.
   *
   * The index follows the files. A scope with no index takes the document's; `replace` takes it
   * too (the whole scope is being replaced); a merge keeps the index that is there and appends
   * the document's lines for the topics this import added, because only the indexes enter the
   * model's context and an unindexed memory is one the Agent never reads.
   *
   * A topic's files are written into its folder, created as needed. A non-directory standing at
   * that folder's name — a planted symlink, a file — or on the way to one of its files refuses
   * the import with 409 before anything is written, rather than writing through it.
   */
  async importScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
    request: { mode: MemoryImportMode; confirm: boolean; payload: unknown },
  ): Promise<MemoryImportResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const { index, files } = parseTransferDocument(request.payload);
    // Names and paths are resolved before anything is written, so a document with one bad entry
    // writes nothing at all rather than half of itself.
    const planned = files.map((f) => {
      const folder = topicFolderName(f.name);
      return {
        name: f.name,
        content: f.content,
        target: this.resolveFile(dir, f.name),
        folder,
        files: (f.files ?? []).map((kept) => ({
          content: kept.content,
          target: this.resolveFolderPath(dir, `${folder}/${kept.path}`),
        })),
      };
    });

    const scan = await scanScope(dir);
    const presentTopics = new Set(scan.topics);
    const strayFolders = new Set(orphanFolders(scan));
    const carriedTopics = new Set(files.map((f) => f.name));
    const carriedFolders = new Set(planned.map((p) => p.folder));
    const present = (p: (typeof planned)[number]): boolean =>
      presentTopics.has(p.name) || strayFolders.has(p.folder);
    const collides = planned.filter(present).map((p) => p.name);
    const removedTopics =
      request.mode === "replace" ? scan.topics.filter((name) => !carriedTopics.has(name)) : [];
    const removedFolders =
      request.mode === "replace" ? [...strayFolders].filter((f) => !carriedFolders.has(f)) : [];
    const removed = [...removedTopics, ...removedFolders.map((f) => `${f}/`)];
    const overwritten = request.mode === "skip" ? [] : collides;
    const skipped = request.mode === "skip" ? collides : [];
    const writes = request.mode === "skip" ? planned.filter((p) => !present(p)) : planned;

    // A topic replaced here has its folder cleared first, so only the folder itself must be a
    // real directory; one written beside what is there must have a clear path to every file.
    const clears = (p: (typeof planned)[number]): boolean => request.mode !== "skip" && present(p);
    for (const p of writes) {
      if (p.files.length === 0) continue;
      const folder = path.join(dir, p.folder);
      const clear = clears(p)
        ? (await directoryState(folder)) !== "invalid"
        : (await Promise.all(p.files.map((kept) => writablePath(dir, kept.target)))).every(Boolean);
      if (!clear) {
        throw new HttpError(
          409,
          "memory_folder_not_a_directory",
          `${p.folder} in ${scopeKey} is not a directory all the way down, so the files of ${p.name} cannot be imported.`,
        );
      }
    }
    // `replace` takes the document's index over the scope's own, which is the user's text too.
    const replacesIndex =
      request.mode === "replace" && index !== null && (await this.hasIndexFile(dir));
    if (!request.confirm && (overwritten.length > 0 || removed.length > 0 || replacesIndex)) {
      throw new HttpError(
        409,
        "memory_import_confirm_required",
        `This import would overwrite ${overwritten.length} and delete ${removed.length} memories in ${scopeKey}` +
          `${replacesIndex ? `, and replace its ${MEMORY_INDEX_FILENAME}` : ""}. Repeat it with confirm set.`,
      );
    }

    const added: string[] = [];
    for (const p of writes) {
      await this.writeScopeFile(p.target, p.content);
      // A replaced topic's folder becomes the document's files, since its text now describes
      // those: what was there before goes.
      if (clears(p)) await removeFolder(path.join(dir, p.folder));
      for (const kept of p.files) {
        await fs.mkdir(path.dirname(kept.target), { recursive: true });
        await this.writeScopeFile(kept.target, kept.content);
      }
      if (!present(p)) added.push(p.name);
    }
    for (const name of removedTopics) {
      await fs.unlink(path.join(dir, name)).catch(() => {
        // Raced with a delete from a Session: the file is gone either way.
      });
      const folder = topicFolderName(name);
      if (!carriedFolders.has(folder)) await removeFolder(path.join(dir, folder));
    }
    for (const folder of removedFolders) await removeFolder(path.join(dir, folder));

    const written = writes.map((p) => p.name);
    let indexWritten = false;
    if (index !== null) {
      if (replacesIndex || !(await this.hasIndexFile(dir))) {
        await this.writeScopeFile(path.join(dir, MEMORY_INDEX_FILENAME), index);
        indexWritten = true;
      } else {
        indexWritten = await this.extendIndex(dir, index, written);
      }
    }
    // Whatever the index now says, it must not list a file this import deleted.
    for (const name of removedTopics) await this.pruneIndexLines(dir, name);

    return { scopeKey, mode: request.mode, added, overwritten, skipped, removed, indexWritten };
  }

  /**
   * Appends the document's index lines for the topics this import wrote: a line linking a written
   * topic that the scope's index does not already link is added at the end, in the document's own
   * order. Nothing else is touched — the mirror image of pruneIndexLines, so between them the
   * index lists neither a file that is gone nor omits one that arrived.
   */
  private async extendIndex(dir: string, docIndex: string, written: string[]): Promise<boolean> {
    const indexPath = path.join(dir, MEMORY_INDEX_FILENAME);
    const current = await this.readTextFile(indexPath);
    if (current === null) return false;
    const docLines = docIndex.split("\n");
    const additions: string[] = [];
    for (const name of written) {
      const link = indexLinkPattern(name);
      if (link.test(current)) continue;
      const line = docLines.find((l) => link.test(l));
      if (line !== undefined && !additions.includes(line)) additions.push(line);
    }
    if (additions.length === 0) return false;
    const head = current === "" || current.endsWith("\n") ? current : `${current}\n`;
    await this.writeScopeFile(indexPath, `${head}${additions.join("\n")}\n`);
    return true;
  }

  /**
   * The write path for every change this service makes to Memory content, shared by the imported
   * topic files, the files they keep and the index.
   *
   * The target has already been through `resolveFile` or `resolveFolderPath` (or is the reserved
   * index name, which is never client-supplied), so it names a file inside this scope. The write
   * goes to a temporary dotfile — invisible to every listing — and is renamed over the target, so
   * a reader never sees a half-written memory. Symlinks are deliberately not followed: the Memory
   * directory is model-writable, and a link planted at a memory's name would otherwise carry the
   * write out of it. Replacing the link keeps the write inside the scope.
   */
  private async writeScopeFile(target: string, content: string): Promise<void> {
    await atomicWriteFile(target, content);
  }

  /** Reads a regular file as text, null when it is absent, unreadable, or not a regular file (lstat, so a symlink is never followed). */
  private async readTextFile(target: string): Promise<string | null> {
    try {
      if (!(await fs.lstat(target)).isFile()) return null;
      return await fs.readFile(target, "utf8");
    } catch {
      return null;
    }
  }

  /**
   * Deletes a topic file with its folder, and mechanically drops its lines from the scope's
   * `MEMORY.md`: any line whose Markdown link target is exactly this file (`](<file>)`) goes; a
   * mention of the name in ordinary prose, or a link to a different file, survives. Besides a
   * single kept file's delete, this is the only write the API performs on Memory content outside
   * an import — everything else is the model's, through a chat Session.
   */
  async deleteFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    fileName: string,
  ): Promise<void> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const target = this.resolveFile(dir, fileName);
    const notFound = () =>
      new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    let isTopic: boolean;
    try {
      isTopic = (await fs.lstat(target)).isFile();
    } catch {
      throw notFound();
    }
    // The folder goes first: a failure there leaves the topic listed with what it still keeps,
    // never a folder that has lost its topic. A link standing at the topic's name is no topic,
    // so it is unlinked alone.
    if (isTopic) await removeFolder(path.join(dir, topicFolderName(fileName)));
    try {
      await fs.unlink(target);
    } catch {
      throw notFound();
    }
    await this.pruneIndexLines(dir, fileName);
  }

  /**
   * Deletes one kept file, then every folder above it that this left empty, up to the scope —
   * so deleting a topic's last file leaves no empty folder behind. The topic's text and the
   * index are the model's and stay as they are.
   */
  async deleteFolderFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    filePath: string,
  ): Promise<void> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const target = await this.requireFolderFile(dir, filePath);
    try {
      await fs.unlink(target);
    } catch {
      throw this.folderFileNotFound(filePath);
    }
    for (let parent = path.dirname(target); parent !== dir; parent = path.dirname(parent)) {
      try {
        await fs.rmdir(parent);
      } catch {
        break; // Not empty (or raced): everything above it is not empty either.
      }
    }
  }

  /** Removes index lines linking to a deleted file. Best-effort: a missing or unreadable index is left alone. */
  private async pruneIndexLines(dir: string, fileName: string): Promise<void> {
    const indexPath = path.join(dir, MEMORY_INDEX_FILENAME);
    let content: string;
    try {
      content = await fs.readFile(indexPath, "utf8");
    } catch {
      return;
    }
    const link = indexLinkPattern(fileName);
    const lines = content.split("\n");
    const kept = lines.filter((line) => !link.test(line));
    if (kept.length === lines.length) return;
    await this.writeScopeFile(indexPath, kept.join("\n"));
  }

  private async fileInfo(
    dir: string,
    name: string,
    kept: MemoryFolderFile[],
  ): Promise<MemoryFileInfo | null> {
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(path.join(dir, name), "utf8"),
        fs.stat(path.join(dir, name)),
      ]);
      return this.describe(name, content, stat.size, stat.mtime, kept);
    } catch {
      // Raced with a delete, or not readable: leave it out of the listing rather than failing the request.
      return null;
    }
  }

  /** One topic's listing entry: frontmatter (falling back to the file name for an unparsed file), file stats, and the files it keeps. */
  private describe(
    name: string,
    content: string,
    size: number,
    mtime: Date,
    kept: MemoryFolderFile[],
  ): MemoryFileInfo {
    const meta = parseMemoryFrontmatter(content, name);
    return {
      name,
      title: meta?.name ?? name,
      description: meta?.description ?? "",
      ...(meta?.updatedAt !== undefined ? { updatedAt: meta.updatedAt } : {}),
      size,
      modifiedAt: mtime.toISOString(),
      files: kept,
    };
  }

  /**
   * Validates a scope key and returns its directory, 404 if it does not exist. The key is only
   * ever a single directory name.
   *
   * A Workspace directory is created by a Session, so this API never creates one — a key with no
   * directory means no Session has run there and there is nothing to list. The User scope is the
   * exception: it belongs to the Agent rather than to any Session, so it is created on demand
   * (Agents that predate Memory have no `memory/user/` until their next Session).
   */
  private async requireScopeDir(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<string> {
    await this.agentConfigService.requireExists(projectId, agentId);
    if (!SCOPE_KEY_PATTERN.test(scopeKey)) {
      throw badRequest("scopeKey is invalid.");
    }
    const dir = memoryScopeDir(this.root, projectId, agentId, scopeKey);
    if (scopeKey === USER_SCOPE_KEY) {
      await fs.mkdir(dir, { recursive: true });
      return this.requireRealScopeDir(projectId, agentId, scopeKey, dir);
    }
    try {
      if ((await fs.stat(dir)).isDirectory()) {
        return this.requireRealScopeDir(projectId, agentId, scopeKey, dir);
      }
    } catch {
      // Fall through to the 404 below.
    }
    throw new HttpError(
      404,
      "memory_scope_not_found",
      `No Memory directory for scope: ${scopeKey}`,
    );
  }

  /**
   * Symlink hardening for the scope directory itself: a scope smuggled in as a symlink (the
   * model can create one with its file tools) would carry every read and delete outside
   * `memory/`, so the resolved real path must be exactly `<real memory/>/<scopeKey>` — not a
   * link's target, wherever it points.
   */
  private async requireRealScopeDir(
    projectId: string,
    agentId: string,
    scopeKey: string,
    dir: string,
  ): Promise<string> {
    try {
      const realBase = await fs.realpath(memoryDir(this.root, projectId, agentId));
      if ((await fs.realpath(dir)) === path.join(realBase, scopeKey)) return dir;
    } catch {
      // Unresolvable path: treat as absent.
    }
    throw new HttpError(
      404,
      "memory_scope_not_found",
      `No Memory directory for scope: ${scopeKey}`,
    );
  }

  /**
   * Resolves a client- or document-supplied topic name to its path inside a scope directory: the
   * name must pass the topic-file rule (which already excludes every separator and the reserved
   * index name), and the joined path is checked for containment — belt and braces.
   */
  private resolveFile(dir: string, fileName: string): string {
    if (!isTopicFileName(fileName)) {
      throw badRequest(
        `File must be a Markdown topic file name — no path, no leading dot, and not the ${MEMORY_INDEX_FILENAME} index.`,
      );
    }
    const target = path.join(dir, fileName);
    const rel = path.relative(dir, target);
    if (rel !== fileName || rel.includes(path.sep)) {
      throw badRequest("File name must not contain a path.");
    }
    return target;
  }

  /**
   * Resolves a kept file's scope-relative path (`<folder>/<path>`) to its place inside a scope
   * directory: at least a folder and a file, `/`-separated, every segment under the same rule as
   * a name (no leading dot — which also rules out `.` and `..` — and no other separator), and the
   * joined path checked for containment.
   */
  private resolveFolderPath(dir: string, filePath: string): string {
    const segments = filePath.split("/");
    if (segments.length < 2 || !segments.every(isPlainName)) {
      throw badRequest(
        "A kept file's path must be <folder>/<file>, every part without a leading dot or a backslash.",
      );
    }
    const target = path.join(dir, ...segments);
    if (path.relative(dir, target) !== segments.join(path.sep)) {
      throw badRequest("A kept file's path must stay inside its scope.");
    }
    return target;
  }

  /**
   * A kept file that exists, by its scope-relative path: every folder on the way must be a real
   * directory and the file a regular file, each checked with lstat — so neither a folder nor the
   * file planted as a symlink can carry a read or a delete outside the scope. 404 otherwise.
   */
  private async requireFolderFile(dir: string, filePath: string): Promise<string> {
    const target = this.resolveFolderPath(dir, filePath);
    const segments = filePath.split("/");
    let at = dir;
    try {
      for (const segment of segments.slice(0, -1)) {
        at = path.join(at, segment);
        if (!(await fs.lstat(at)).isDirectory()) throw new Error("not a folder");
      }
      if (!(await fs.lstat(target)).isFile()) throw new Error("not a file");
    } catch {
      throw this.folderFileNotFound(filePath);
    }
    return target;
  }

  private folderFileNotFound(filePath: string): HttpError {
    return new HttpError(404, "memory_file_not_found", `Memory file not found: ${filePath}`);
  }
}
