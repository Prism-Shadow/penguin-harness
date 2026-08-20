/**
 * Memory management (`agent_state/memory/`): the Web App's read/delete access to what the Agent
 * remembers between Sessions.
 *
 * The layout is core's (see core's state/memory.ts): one directory per scope holding Markdown
 * topic files and that scope's own `MEMORY.md` index — `memory/user/` for the User scope and
 * `memory/<workspace_key>/` for each Workspace. The User scope is addressed through the same
 * `scopeKey` parameter as any Workspace (`USER_SCOPE_KEY`), so it needs no routes of its own;
 * the one difference is that it may be created on demand, since it belongs to the Agent rather
 * than to a Session that has run.
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
 * `scopeKey` and a file name inside that scope, each validated against a character rule and
 * then re-checked for containment after resolution, so neither `..` nor a symlink can reach
 * outside the Agent's Memory directory.
 *
 * Files are the source of truth and are read fresh on every request (they are small, requests
 * are rare, and the model edits the same files from its side).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_INDEX_FILENAME,
  USER_SCOPE_KEY,
  hasMemoryPlaceholder,
  insertMemoryPlaceholder,
  memoryDir,
  memoryScopeDir,
  parseMemoryFrontmatter,
  readWorkspaceMarker,
} from "@prismshadow/penguin-core";
import type {
  MemoryFileInfo,
  MemoryFilesResponse,
  MemoryFileResponse,
  MemoryImportMode,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MemoryScopeInfo,
  MemoryTransferFile,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { AgentConfigService } from "./agent-config-service.js";

/** Scope directory names: what core's key generator produces (a safe base may start with `_`), plus the leeway of a hand-made directory. Excludes `.`/`..` and any separator, so the name can never climb out of `memory/`. */
const SCOPE_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** The transfer document's format marker, checked before anything in it is believed. Typed against the DTO so the two literals cannot drift apart. */
const SCOPE_FORMAT: MemoryScopeExport["format"] = "penguin-memory-scope";

/** The document version this reader accepts. A later format bumps it and states its own compatibility. */
const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 1;

/**
 * What one import may carry.
 *
 * These are Memory's own numbers, not the attachment budget's: an attachment is an opaque blob
 * handed to the model's file tools, while a memory is Markdown the model wrote for itself to
 * re-read, and 100MB of it would be a scope no index could describe. The request as a whole is
 * already bounded by the API body cap before any of this runs — what follows bounds what one
 * scope directory can be made to hold.
 */
/** Topic files one document may carry. A scope the model keeps by hand runs to tens of files, so this is far past ordinary use and still a directory that lists. */
const MAX_IMPORT_FILES = 500;

/** Bytes of one file's text (UTF-8), the index included. A memory that does not fit in 512KB of Markdown is not a memory. */
const MAX_IMPORT_FILE_BYTES = 512 * 1024;

/** Bytes across the whole document: one scope directory's total. */
const MAX_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * Bytes of one file name. The name rule says nothing about length, and a name longer than the
 * filesystem's own limit for a path component fails at the write with ENAMETOOLONG — a 500 for
 * what is plainly a bad request. 255 is that limit on ext4, APFS and NTFS alike.
 */
const MAX_IMPORT_NAME_BYTES = 255;

/**
 * Matches an index line's Markdown link to one file — `](file)`, `](./file)`, `](<file>)`,
 * `](file "title")`. A prose mention of the name is not a link and never matches, which is what
 * keeps both index edits (prune on delete, extend on import) mechanical rather than clever.
 */
function indexLinkPattern(fileName: string): RegExp {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\]\\(\\s*<?(?:\\./)?${escaped}>?\\s*(?:"[^"]*"\\s*)?\\)`);
}

/**
 * Whether a name is a topic file: any Markdown file that is not a dotfile (`.workspace` is the
 * Harness's), carries no path separator, and is not the index under any casing — macOS and
 * Windows resolve `memory.md` to `MEMORY.md`. The model writes these files with the ordinary
 * file tools, so non-ASCII names are as legitimate as kebab-case ones; the same rule guards
 * client-supplied names, with containment re-checked after resolution. Exported so the Agent
 * list's memory count (agent-service) shares this one definition of "a memory".
 */
export function isTopicFileName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith(".") &&
    !/[/\\]/.test(name) &&
    name.toLowerCase().endsWith(".md") &&
    name.toLowerCase() !== MEMORY_INDEX_FILENAME.toLowerCase()
  );
}

/**
 * Validates a transfer document on its way to the server's disk.
 *
 * Everything here is untrusted: the document may have been hand-written, produced by another
 * tool, or crafted. So the shape is checked field by field before any of it is believed, and the
 * result carries only what was verified — the entry names are handed to the same `resolveFile`
 * check that guards every other write, which is what keeps one definition of "a legal memory
 * file name" in the service.
 *
 * Refuses, with the reason: a foreign or future format, entries that are not text, a name that
 * carries a NUL or is longer than a path component may be (both of which the filesystem layer
 * would throw on rather than reject), the same name twice, and any of the size bounds.
 */
function parseTransferDocument(payload: unknown): {
  index: string | null;
  files: MemoryTransferFile[];
} {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw badRequest("payload must be a Memory scope export object.");
  }
  const doc = payload as Record<string, unknown>;
  if (doc.format !== SCOPE_FORMAT) {
    throw badRequest(`payload.format must be "${SCOPE_FORMAT}".`);
  }
  if (doc.version !== SCOPE_FORMAT_VERSION) {
    throw badRequest(`payload.version must be ${SCOPE_FORMAT_VERSION}.`);
  }
  if (!Array.isArray(doc.files)) throw badRequest("payload.files must be an array.");
  if (doc.files.length > MAX_IMPORT_FILES) {
    throw badRequest(`payload.files must hold at most ${MAX_IMPORT_FILES} entries.`);
  }
  let total = 0;
  const measure = (text: string, label: string): void => {
    if (text.includes("\u0000")) throw badRequest(`${label} must be text.`);
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_IMPORT_FILE_BYTES) {
      throw badRequest(`${label} exceeds the ${MAX_IMPORT_FILE_BYTES / 1024}KB limit.`);
    }
    total += bytes;
    if (total > MAX_IMPORT_TOTAL_BYTES) {
      throw badRequest(
        `payload exceeds the ${MAX_IMPORT_TOTAL_BYTES / (1024 * 1024)}MB total limit.`,
      );
    }
  };

  let index: string | null = null;
  if (doc.index !== null && doc.index !== undefined) {
    if (typeof doc.index !== "string") throw badRequest("payload.index must be a string or null.");
    measure(doc.index, "payload.index");
    index = doc.index;
  }

  const files: MemoryTransferFile[] = [];
  const seen = new Set<string>();
  for (const entry of doc.files) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest("Each payload.files entry must be an object.");
    }
    const { name, content } = entry as Record<string, unknown>;
    if (typeof name !== "string") throw badRequest("Each payload.files entry needs a name.");
    if (typeof content !== "string") {
      throw badRequest(`Content of ${name} must be a string.`);
    }
    if (name.includes("\u0000")) throw badRequest("A file name must be text.");
    if (Buffer.byteLength(name, "utf8") > MAX_IMPORT_NAME_BYTES) {
      throw badRequest(`A file name must be at most ${MAX_IMPORT_NAME_BYTES} bytes.`);
    }
    if (seen.has(name)) throw badRequest(`payload.files names ${name} twice.`);
    seen.add(name);
    measure(content, `Content of ${name}`);
    files.push({ name, content });
  }
  return { index, files };
}

export class MemoryService {
  constructor(
    private readonly root: string,
    private readonly agentConfigService: AgentConfigService,
  ) {}

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
   * then the Workspaces, newest activity first (one with no topic file yet sorts last, by key).
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
    const files = await this.topicFileNames(dir);
    let latest = 0;
    for (const name of files) {
      try {
        const stat = await fs.stat(path.join(dir, name));
        latest = Math.max(latest, stat.mtimeMs);
      } catch {
        // Raced with a delete: leave it out of the timestamp.
      }
    }
    const workspacePath = kind === "workspace" ? await readWorkspaceMarker(dir) : undefined;
    return {
      scopeKey: key,
      kind,
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      fileCount: files.length,
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

  /** Topic files of one scope: regular Markdown files only — the index, the `.workspace` marker, stray directories and symlinks (dirents that are not regular files) all stay out. */
  private async topicFileNames(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile() && isTopicFileName(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  async listFiles(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryFilesResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const names = await this.topicFileNames(dir);
    const files: MemoryFileInfo[] = [];
    for (const name of names) {
      const info = await this.fileInfo(dir, name);
      if (info) files.push(info);
    }
    return { scopeKey, files };
  }

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
      return {
        scopeKey,
        file: this.describe(fileName, content, stat.size, stat.mtime),
        content,
      };
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
  }

  /**
   * The whole scope as one transfer document: every topic file plus the scope's own `MEMORY.md`.
   *
   * JSON rather than an archive, because the payload is entirely UTF-8 Markdown and the import
   * side of it is an untrusted write into the Agent's Memory directory: a JSON document carries
   * no paths, no permissions and no compression, so its entries can go through the same per-file
   * name check every other write here uses, with nothing to unpack first.
   *
   * Unreadable entries are left out rather than failing the export, as elsewhere in this service.
   * The size bounds below apply to import only — an export reports what the directory actually
   * holds, and a scope grown past them is exactly the thing its owner needs to see.
   */
  async exportScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryScopeExport> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const files: MemoryTransferFile[] = [];
    for (const name of await this.topicFileNames(dir)) {
      const content = await this.readTextFile(path.join(dir, name));
      if (content !== null) files.push({ name, content });
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
    };
  }

  /**
   * Writes a transfer document into one scope.
   *
   * The default mode keeps every file already on disk and writes only names the scope does not
   * have, so an import can never cost the user a memory they did not agree to lose. `overwrite`
   * replaces a same-named file's content and `replace` additionally deletes what the document
   * does not carry; both are refused with 409 unless `confirm` is set — but only when they would
   * actually destroy something, since a confirmation that names nothing is just a click.
   *
   * The index follows the files. A scope with no index takes the document's; `replace` takes it
   * too (the whole scope is being replaced); a merge keeps the index that is there and appends
   * the document's lines for the files this import added, because only the indexes enter the
   * model's context and an unindexed memory is one the Agent never reads.
   */
  async importScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
    request: { mode: MemoryImportMode; confirm: boolean; payload: unknown },
  ): Promise<MemoryImportResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const { index, files } = parseTransferDocument(request.payload);
    // Names are resolved before anything is written, so a document with one bad entry writes
    // nothing at all rather than half of itself.
    const targets = new Map(files.map((f) => [f.name, this.resolveFile(dir, f.name)]));

    const present = new Set(await this.topicFileNames(dir));
    const carried = new Set(files.map((f) => f.name));
    const collides = files.filter((f) => present.has(f.name)).map((f) => f.name);
    const removed =
      request.mode === "replace" ? [...present].filter((name) => !carried.has(name)) : [];
    const overwritten = request.mode === "skip" ? [] : collides;
    const skipped = request.mode === "skip" ? collides : [];
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
    for (const file of files) {
      if (request.mode === "skip" && present.has(file.name)) continue;
      await this.writeScopeFile(dir, targets.get(file.name)!, file.content);
      if (!present.has(file.name)) added.push(file.name);
    }
    for (const name of removed) {
      await fs.unlink(path.join(dir, name)).catch(() => {
        // Raced with a delete from a Session: the file is gone either way.
      });
    }

    const written = [...added, ...overwritten];
    let indexWritten = false;
    if (index !== null) {
      if (replacesIndex || !(await this.hasIndexFile(dir))) {
        await this.writeScopeFile(dir, path.join(dir, MEMORY_INDEX_FILENAME), index);
        indexWritten = true;
      } else {
        indexWritten = await this.extendIndex(dir, index, written);
      }
    }
    // Whatever the index now says, it must not list a file this import deleted.
    for (const name of removed) await this.pruneIndexLines(dir, name);

    return { scopeKey, mode: request.mode, added, overwritten, skipped, removed, indexWritten };
  }

  /**
   * Appends the document's index lines for the files this import wrote: a line linking a written
   * file that the scope's index does not already link is added at the end, in the document's own
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
    await this.writeScopeFile(dir, indexPath, `${head}${additions.join("\n")}\n`);
    return true;
  }

  /**
   * The service's one content write, shared by the topic files and the index.
   *
   * The target has already been through `resolveFile` (or is the reserved index name, which is
   * never client-supplied), so it names a file directly inside this scope. The write goes to a
   * temporary dotfile — invisible to every topic listing — and is renamed over the target, so a
   * symlink standing at that name is replaced rather than followed out of the Memory directory,
   * and a reader never sees a half-written memory.
   */
  private async writeScopeFile(dir: string, target: string, content: string): Promise<void> {
    const tmp = path.join(dir, `.import-${randomBytes(6).toString("hex")}.tmp`);
    try {
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
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
   * Deletes a topic file and mechanically drops its lines from the scope's `MEMORY.md`: any
   * line whose Markdown link target is exactly this file (`](<file>)`) goes; a mention of the
   * name in ordinary prose, or a link to a different file, survives. This is the only write the
   * API performs on Memory content — everything else is the model's, through a chat Session.
   */
  async deleteFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    fileName: string,
  ): Promise<void> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const target = this.resolveFile(dir, fileName);
    try {
      await fs.unlink(target);
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
    await this.pruneIndexLines(dir, fileName);
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
    await fs.writeFile(indexPath, kept.join("\n"), "utf8");
  }

  private async fileInfo(dir: string, name: string): Promise<MemoryFileInfo | null> {
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(path.join(dir, name), "utf8"),
        fs.stat(path.join(dir, name)),
      ]);
      return this.describe(name, content, stat.size, stat.mtime);
    } catch {
      // Raced with a delete, or not readable: leave it out of the listing rather than failing the request.
      return null;
    }
  }

  /** One listing entry: frontmatter (falling back to the file name for an unparsed file) plus file stats. */
  private describe(name: string, content: string, size: number, mtime: Date): MemoryFileInfo {
    const meta = parseMemoryFrontmatter(content, name);
    return {
      name,
      title: meta?.name ?? name,
      description: meta?.description ?? "",
      ...(meta?.updatedAt !== undefined ? { updatedAt: meta.updatedAt } : {}),
      size,
      modifiedAt: mtime.toISOString(),
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
   * The absolute path of a topic file inside a scope directory. The name must pass the
   * character rule, must not be the reserved index name, and the joined path is checked
   * for containment — belt and braces, since the rule already excludes separators.
   */
  private resolveFile(dir: string, fileName: string): string {
    if (!isTopicFileName(fileName)) {
      throw badRequest(
        `File name must be a Markdown topic file — no path, no leading dot, and not the ${MEMORY_INDEX_FILENAME} index.`,
      );
    }
    const target = path.join(dir, fileName);
    const rel = path.relative(dir, target);
    if (rel !== fileName || rel.includes(path.sep)) {
      throw badRequest("File name must not contain a path.");
    }
    return target;
  }
}
