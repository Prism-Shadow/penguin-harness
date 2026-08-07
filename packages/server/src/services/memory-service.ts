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
 * The API is deliberately read + delete only: content changes go through a chat Session where
 * the model edits the same files, keeping frontmatter and index in step. The one write this
 * service performs is mechanical — deleting a topic file also drops its `](<file>)` index lines,
 * so the index never lists a file that is gone.
 *
 * This service never invents paths from client input — a request names an `agentId`, a
 * `scopeKey` and a file name inside that scope, each validated against a character rule and
 * then re-checked for containment after resolution, so neither `..` nor a symlink can reach
 * outside the Agent's Memory directory.
 *
 * Files are the source of truth and are read fresh on every request (they are small, requests
 * are rare, and the model edits the same files from its side).
 */
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
  MemoryOverviewResponse,
  MemoryScopeInfo,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { AgentConfigService } from "./agent-config-service.js";

/** Scope directory names: what core's key generator produces, plus the leeway of a hand-made directory. Excludes `.`/`..` and any separator, so the name can never climb out of `memory/`. */
const SCOPE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Topic file names: a Markdown file, no leading dot (dotfiles like `.workspace` are the Harness's, not topics). */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

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
      ...(latest > 0 ? { updatedAt: new Date(latest).toISOString() } : {}),
    };
  }

  /** Topic files of one scope: Markdown only, minus the index — the `.workspace` marker and any stray directory stay out too. */
  private async topicFileNames(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir, { withFileTypes: true }))
        .filter(
          (e) => e.isFile() && e.name !== MEMORY_INDEX_FILENAME && FILE_NAME_PATTERN.test(e.name),
        )
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
    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
    const stat = await fs.stat(target);
    return {
      scopeKey,
      file: this.describe(fileName, content, stat.size, stat.mtime),
      content,
    };
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
    const link = `](${fileName})`;
    if (!content.includes(link)) return;
    const kept = content.split("\n").filter((line) => !line.includes(link));
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
      ...(meta?.type !== undefined ? { type: meta.type } : {}),
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
      return dir;
    }
    try {
      if ((await fs.stat(dir)).isDirectory()) return dir;
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
   * The absolute path of a topic file inside a scope directory. The name must pass the
   * character rule, must not be the reserved index name, and the joined path is checked
   * for containment — belt and braces, since the rule already excludes separators.
   */
  private resolveFile(dir: string, fileName: string): string {
    if (!FILE_NAME_PATTERN.test(fileName)) {
      throw badRequest("File name must be a Markdown file (letters, digits, . _ - and .md).");
    }
    if (fileName === MEMORY_INDEX_FILENAME) {
      throw badRequest(`${MEMORY_INDEX_FILENAME} is the scope's index, not a topic file.`);
    }
    const target = path.join(dir, fileName);
    const rel = path.relative(dir, target);
    if (rel !== fileName || rel.includes(path.sep)) {
      throw badRequest("File name must not contain a path.");
    }
    return target;
  }
}
