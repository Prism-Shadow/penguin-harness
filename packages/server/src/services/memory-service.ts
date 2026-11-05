/**
 * Memory management (`agent_state/memory/`): the Web App's read/delete access to what the Agent
 * remembers between Sessions.
 *
 * The layout is core's (see core's state/memory.ts): one directory per scope holding Markdown
 * topic files, an optional `scripts/` directory of programs the Agent reuses, and that scope's
 * own `MEMORY.md` index — `memory/user/` for the User scope and `memory/<workspace_key>/` for
 * each Workspace. The User scope is addressed through the same `scopeKey` parameter as any
 * Workspace (`USER_SCOPE_KEY`), so it needs no routes of its own; the one difference is that it
 * may be created on demand, since it belongs to the Agent rather than to a Session that has run.
 *
 * A file is addressed by its path inside the scope: a topic by its name (`prefers-pnpm.md`), a
 * script by `scripts/<name>` — the same text its index line links to, so the index edits below
 * work on both alike. A script is any regular file directly under `scripts/`; its contents are
 * read only up to the transfer document's per-file bound, and only as UTF-8 text.
 *
 * Per-file content changes go through a chat Session where the model edits the same files,
 * keeping frontmatter and index in step; this service's own writes are the mechanical ones a
 * model cannot be asked for. Deleting a file drops its `](<path>)` index lines, so the index
 * never lists a file that is gone. Whole-scope import writes the files a transfer document
 * carries and adds their index lines, the same invariant read the other way: the index never
 * omits a file that arrived. Only the indexes enter the model's context (core's state/memory.ts),
 * so an unindexed memory would be a file the Agent never reads.
 *
 * This service never invents paths from client input — a request names an `agentId`, a
 * `scopeKey` and a file path inside that scope, each validated against a character rule and
 * then re-checked for containment after resolution, so neither `..` nor a symlink can reach
 * outside the Agent's Memory directory.
 *
 * Files are the source of truth and are read fresh on every request (they are small, requests
 * are rare, and the model edits the same files from its side).
 */
import { isUtf8 } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_INDEX_FILENAME,
  MEMORY_SCRIPTS_DIR,
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
  MemoryFileKind,
  MemoryFilesResponse,
  MemoryFileResponse,
  MemoryImportMode,
  MemoryImportResponse,
  MemoryOmittedFile,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MemoryScopeInfo,
  MemoryTransferFile,
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
  SCRIPT_PATH_PREFIX,
  parseTransferDocument,
} from "./memory-transfer-document.js";

/** Scope directory names: what core's key generator produces (a safe base may start with `_`), plus the leeway of a hand-made directory. Excludes `.`/`..` and any separator, so the name can never climb out of `memory/`. */
const SCOPE_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Matches an index line's Markdown link to one file — `](file)`, `](./file)`, `](<file>)`,
 * `](file "title")`, and the same for `scripts/<name>`. A prose mention of the name is not a
 * link and never matches, which is what keeps both index edits (prune on delete, extend on
 * import) mechanical rather than clever.
 */
function indexLinkPattern(filePath: string): RegExp {
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\]\\(\\s*<?(?:\\./)?${escaped}>?\\s*(?:"[^"]*"\\s*)?\\)`);
}

/** Whether a name could be a file directly inside a directory: not empty, not a dotfile (the Harness's own and every temporary write are), and no path separator. */
function isPlainFileName(name: string): boolean {
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
    isPlainFileName(name) &&
    name.toLowerCase().endsWith(".md") &&
    name.toLowerCase() !== MEMORY_INDEX_FILENAME.toLowerCase()
  );
}

/**
 * Whether a name is a script inside a scope's `scripts/` directory: a file name under the topic
 * rule's character constraints — no leading dot, no separator — with any extension or none,
 * since a script may be in any language. Only the file's own name: `scripts/` holds no deeper
 * directories.
 */
export function isScriptFileName(name: string): boolean {
  return isPlainFileName(name);
}

/** One memory file, resolved from a client- or document-supplied path. */
interface MemoryEntry {
  kind: MemoryFileKind;
  /** The file's own name. */
  name: string;
  /** Its path inside the scope: the name, or `scripts/<name>`. */
  path: string;
}

/** Reads a scope-relative path as a memory file, or null when it is neither a topic nor a script. */
function parseEntryPath(filePath: string): MemoryEntry | null {
  if (filePath.startsWith(SCRIPT_PATH_PREFIX)) {
    const name = filePath.slice(SCRIPT_PATH_PREFIX.length);
    return isScriptFileName(name) ? { kind: "script", name, path: filePath } : null;
  }
  return isTopicFileName(filePath) ? { kind: "topic", name: filePath, path: filePath } : null;
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

/** The regular files directly inside a directory whose names pass `accept`, in the host-independent order; none when it cannot be read. */
async function fileNamesIn(dir: string, accept: (name: string) => boolean): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && accept(e.name))
      .map((e) => e.name)
      .sort(compareFileNames);
  } catch {
    return [];
  }
}

/** Topic files of one scope: regular Markdown files only — the index, the `.workspace` marker, stray directories and symlinks (dirents that are not regular files) all stay out. */
function topicFileNames(dir: string): Promise<string[]> {
  return fileNamesIn(dir, isTopicFileName);
}

/**
 * A scope's `scripts/` directory when it is a real directory. lstat, not stat: a `scripts`
 * symlink (the model can plant one with its file tools) would carry every listing, read, delete
 * and import write outside the Memory directory, so a scope whose `scripts` is a link — or a file
 * — has no scripts here at all.
 */
async function scriptsDirOf(scopeDir: string): Promise<string | null> {
  const dir = path.join(scopeDir, MEMORY_SCRIPTS_DIR);
  try {
    return (await fs.lstat(dir)).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** Script names of one scope: the regular files directly under its real `scripts/` directory. */
async function scriptFileNames(scopeDir: string): Promise<string[]> {
  const dir = await scriptsDirOf(scopeDir);
  return dir === null ? [] : fileNamesIn(dir, isScriptFileName);
}

/** Every memory file of one scope, by path: its topics, then its scripts. */
async function entryPaths(scopeDir: string): Promise<string[]> {
  const [topics, scripts] = await Promise.all([
    topicFileNames(scopeDir),
    scriptFileNames(scopeDir),
  ]);
  return [...topics, ...scripts.map((name) => `${SCRIPT_PATH_PREFIX}${name}`)];
}

/**
 * How many memories one scope directory holds — topic files plus scripts, the index excluded.
 * Exported so the Agent list's memory count (agent-service) shares this one definition of "a
 * memory".
 */
export async function memoryFileCount(scopeDir: string): Promise<number> {
  return (await entryPaths(scopeDir)).length;
}

/** A script's text as the routes may hand it out, or why it may not be. */
type ScriptText =
  | { ok: true; content: string; size: number; mtime: Date }
  | { ok: false; reason: MemoryOmittedFile["reason"]; size: number; mtime: Date };

/**
 * Reads a script for a reader that needs its text: null when it is absent or not a regular file
 * (lstat, so a symlink is never followed), otherwise its text — or the reason it is withheld: over
 * the per-file bound (decided from the size, before reading), or not UTF-8 text. A NUL byte counts
 * as not text, since an import refuses one and the export would otherwise hand out a document
 * that cannot come back.
 */
async function readScriptText(target: string): Promise<ScriptText | null> {
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
    const files = await entryPaths(dir);
    let latest = 0;
    for (const filePath of files) {
      try {
        const stat = await fs.stat(path.join(dir, filePath));
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

  /** One scope's memories: its topic files with their frontmatter, then its scripts. */
  async listFiles(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryFilesResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const files: MemoryFileInfo[] = [];
    for (const name of await topicFileNames(dir)) {
      const info = await this.topicInfo(dir, name);
      if (info) files.push(info);
    }
    for (const name of await scriptFileNames(dir)) {
      const info = await this.scriptInfo(dir, name);
      if (info) files.push(info);
    }
    return { scopeKey, files };
  }

  /**
   * One memory's content, by its path in the scope. A script is handed out only as text and only
   * up to the per-file bound: past it the answer is 413, and a file that is not UTF-8 text is 415,
   * each saying why — the listing still shows the script, so its owner can see it is there.
   */
  async readFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    filePath: string,
  ): Promise<MemoryFileResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const entry = this.resolveEntry(dir, filePath);
    const notFound = () =>
      new HttpError(404, "memory_file_not_found", `Memory file not found: ${filePath}`);
    if (entry.kind === "script") {
      if ((await scriptsDirOf(dir)) === null) throw notFound();
      const read = await readScriptText(entry.target);
      if (read === null) throw notFound();
      if (!read.ok) {
        throw read.reason === "too_large"
          ? new HttpError(
              413,
              "memory_script_too_large",
              `${filePath} is ${Math.ceil(read.size / 1024)} KB; a script is shown up to ${MEMORY_FILE_MAX_BYTES / 1024} KB.`,
            )
          : new HttpError(415, "memory_script_not_text", `${filePath} is not UTF-8 text.`);
      }
      return {
        scopeKey,
        file: this.describeScript(entry.name, read.size, read.mtime),
        content: read.content,
      };
    }
    try {
      // lstat, not stat: a symlink planted among the topic files (the model can create one with
      // its file tools) must not lead the read outside the Memory directory. A non-regular file
      // — or one deleted between the calls — is a 404, never a 500.
      const stat = await fs.lstat(entry.target);
      if (!stat.isFile()) throw new Error("not a regular file");
      const content = await fs.readFile(entry.target, "utf8");
      return {
        scopeKey,
        file: this.describeTopic(entry.name, content, stat.size, stat.mtime),
        content,
      };
    } catch {
      throw notFound();
    }
  }

  /**
   * The whole scope as one transfer document: every topic file, every script, and the scope's
   * own `MEMORY.md`.
   *
   * JSON rather than an archive, because the payload is entirely UTF-8 text and the import side
   * of it is an untrusted write into the Agent's Memory directory: a JSON document carries no
   * permissions and no compression, and its entries are scope-relative paths that go through the
   * same per-file check every other write here uses, with nothing to unpack first.
   *
   * Unreadable entries are left out rather than failing the export, as elsewhere in this service.
   * A script over the per-file bound or not UTF-8 text is left out too, and named in `omitted`
   * so the reader can say what did not travel. The import bounds otherwise apply to import only —
   * an export reports what the directory actually holds, and a scope grown past them is exactly
   * the thing its owner needs to see.
   */
  async exportScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryScopeExport> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const files: MemoryTransferFile[] = [];
    const omitted: MemoryOmittedFile[] = [];
    for (const name of await topicFileNames(dir)) {
      const content = await this.readTextFile(path.join(dir, name));
      if (content !== null) files.push({ path: name, content });
    }
    const scriptsDir = await scriptsDirOf(dir);
    if (scriptsDir !== null) {
      for (const name of await fileNamesIn(scriptsDir, isScriptFileName)) {
        const read = await readScriptText(path.join(scriptsDir, name));
        if (read === null) continue;
        const filePath = `${SCRIPT_PATH_PREFIX}${name}`;
        if (read.ok) files.push({ path: filePath, content: read.content });
        else omitted.push({ path: filePath, size: read.size, reason: read.reason });
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
   * The default mode keeps every file already on disk and writes only paths the scope does not
   * have, so an import can never cost the user a memory they did not agree to lose. `overwrite`
   * replaces a same-pathed file's content and `replace` additionally deletes what the document
   * does not carry, scripts included; both are refused with 409 unless `confirm` is set — but
   * only when they would actually destroy something, since a confirmation that names nothing is
   * just a click.
   *
   * The index follows the files. A scope with no index takes the document's; `replace` takes it
   * too (the whole scope is being replaced); a merge keeps the index that is there and appends
   * the document's lines for the files this import added, because only the indexes enter the
   * model's context and an unindexed memory is one the Agent never reads.
   *
   * Scripts land in the scope's `scripts/` directory, created when the document brings the first
   * one. A `scripts` that exists as anything but a real directory — a planted symlink, a file —
   * refuses the import with 409 before anything is written, rather than writing through it.
   */
  async importScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
    request: { mode: MemoryImportMode; confirm: boolean; payload: unknown },
  ): Promise<MemoryImportResponse> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const { index, files } = parseTransferDocument(request.payload);
    // Paths are resolved before anything is written, so a document with one bad entry writes
    // nothing at all rather than half of itself.
    const planned = files.map((f) => ({ ...f, entry: this.resolveEntry(dir, f.path) }));
    const bringsScripts = planned.some((f) => f.entry.kind === "script");
    const scriptsDir = path.join(dir, MEMORY_SCRIPTS_DIR);
    const scriptsDirState = bringsScripts ? await this.scriptsDirState(scriptsDir) : "absent";
    if (scriptsDirState === "invalid") {
      throw new HttpError(
        409,
        "memory_scripts_not_a_directory",
        `${MEMORY_SCRIPTS_DIR} in ${scopeKey} is not a directory, so its scripts cannot be imported.`,
      );
    }

    const present = new Set(await entryPaths(dir));
    const carried = new Set(files.map((f) => f.path));
    const collides = files.filter((f) => present.has(f.path)).map((f) => f.path);
    const removed = request.mode === "replace" ? [...present].filter((p) => !carried.has(p)) : [];
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

    if (bringsScripts && scriptsDirState === "absent") await fs.mkdir(scriptsDir);
    const added: string[] = [];
    for (const file of planned) {
      if (request.mode === "skip" && present.has(file.path)) continue;
      await this.writeScopeFile(file.entry.target, file.content);
      if (!present.has(file.path)) added.push(file.path);
    }
    for (const filePath of removed) {
      await fs.unlink(path.join(dir, filePath)).catch(() => {
        // Raced with a delete from a Session: the file is gone either way.
      });
    }

    const written = [...added, ...overwritten];
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
    for (const filePath of removed) await this.pruneIndexLines(dir, filePath);

    return { scopeKey, mode: request.mode, added, overwritten, skipped, removed, indexWritten };
  }

  /** Whether a scope's `scripts` can take imported scripts: a real directory, nothing there yet, or something else that must not be written through. */
  private async scriptsDirState(scriptsDir: string): Promise<"directory" | "absent" | "invalid"> {
    try {
      return (await fs.lstat(scriptsDir)).isDirectory() ? "directory" : "invalid";
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "invalid";
    }
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
    for (const filePath of written) {
      const link = indexLinkPattern(filePath);
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
   * topic files, scripts and the index.
   *
   * The target has already been through `resolveEntry` (or is the reserved index name, which is
   * never client-supplied), so it names a file directly inside this scope or its real `scripts/`.
   * The write goes to a temporary dotfile — invisible to every listing — and is renamed over the
   * target, so a reader never sees a half-written memory. Symlinks are deliberately not followed:
   * the Memory directory is model-writable, and a link planted at a memory's name would otherwise
   * carry the write out of it. Replacing the link keeps the write inside the scope.
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
   * Deletes a topic file or a script and mechanically drops its lines from the scope's
   * `MEMORY.md`: any line whose Markdown link target is exactly this file (`](<path>)`) goes; a
   * mention of the name in ordinary prose, or a link to a different file, survives. This is the
   * only write the API performs on Memory content outside an import — everything else is the
   * model's, through a chat Session.
   */
  async deleteFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    filePath: string,
  ): Promise<void> {
    const dir = await this.requireScopeDir(projectId, agentId, scopeKey);
    const entry = this.resolveEntry(dir, filePath);
    try {
      if (entry.kind === "script" && (await scriptsDirOf(dir)) === null) {
        throw new Error("no scripts directory");
      }
      await fs.unlink(entry.target);
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${filePath}`);
    }
    await this.pruneIndexLines(dir, entry.path);
  }

  /** Removes index lines linking to a deleted file. Best-effort: a missing or unreadable index is left alone. */
  private async pruneIndexLines(dir: string, filePath: string): Promise<void> {
    const indexPath = path.join(dir, MEMORY_INDEX_FILENAME);
    let content: string;
    try {
      content = await fs.readFile(indexPath, "utf8");
    } catch {
      return;
    }
    const link = indexLinkPattern(filePath);
    const lines = content.split("\n");
    const kept = lines.filter((line) => !link.test(line));
    if (kept.length === lines.length) return;
    await this.writeScopeFile(indexPath, kept.join("\n"));
  }

  private async topicInfo(dir: string, name: string): Promise<MemoryFileInfo | null> {
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(path.join(dir, name), "utf8"),
        fs.stat(path.join(dir, name)),
      ]);
      return this.describeTopic(name, content, stat.size, stat.mtime);
    } catch {
      // Raced with a delete, or not readable: leave it out of the listing rather than failing the request.
      return null;
    }
  }

  /** A script's listing entry, from its stats alone: a script has no frontmatter, and its body may be too large or not text. */
  private async scriptInfo(dir: string, name: string): Promise<MemoryFileInfo | null> {
    try {
      const stat = await fs.lstat(path.join(dir, MEMORY_SCRIPTS_DIR, name));
      return stat.isFile() ? this.describeScript(name, stat.size, stat.mtime) : null;
    } catch {
      return null;
    }
  }

  /** One topic's listing entry: frontmatter (falling back to the file name for an unparsed file) plus file stats. */
  private describeTopic(name: string, content: string, size: number, mtime: Date): MemoryFileInfo {
    const meta = parseMemoryFrontmatter(content, name);
    return {
      name,
      path: name,
      kind: "topic",
      title: meta?.name ?? name,
      description: meta?.description ?? "",
      ...(meta?.updatedAt !== undefined ? { updatedAt: meta.updatedAt } : {}),
      size,
      modifiedAt: mtime.toISOString(),
    };
  }

  /** One script's listing entry: its file name stands for the title. */
  private describeScript(name: string, size: number, mtime: Date): MemoryFileInfo {
    return {
      name,
      path: `${SCRIPT_PATH_PREFIX}${name}`,
      kind: "script",
      title: name,
      description: "",
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
   * A memory file's place inside a scope directory, from a client- or document-supplied path.
   * The path must be a topic name (the character rule, not the reserved index name) or
   * `scripts/<name>` with a script name, and the joined path is checked for containment — belt
   * and braces, since the rules already exclude every other separator.
   */
  private resolveEntry(dir: string, filePath: string): MemoryEntry & { target: string } {
    const entry = parseEntryPath(filePath);
    if (entry === null) {
      throw badRequest(
        `File must be a Markdown topic file or ${SCRIPT_PATH_PREFIX}<name> — no other path, no leading dot, and not the ${MEMORY_INDEX_FILENAME} index.`,
      );
    }
    const base = entry.kind === "script" ? path.join(dir, MEMORY_SCRIPTS_DIR) : dir;
    const target = path.join(base, entry.name);
    const rel = path.relative(base, target);
    if (rel !== entry.name || rel.includes(path.sep)) {
      throw badRequest("File name must not contain a path.");
    }
    return { ...entry, target };
  }
}
