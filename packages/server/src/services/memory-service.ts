/**
 * Workspace Memory management (`agent_state/memory/`): the Web App's read/write access to
 * what the Agent remembers between Sessions.
 *
 * The layout is core's (see core's state/memory.ts): one shared index at `memory/AGENTS.md`,
 * one directory per Workspace holding Markdown topic files. This service never invents paths
 * from client input — a request names an `agentId`, a `workspaceKey` and a file name inside
 * that Workspace, each validated against a character rule and then re-checked for containment
 * after resolution, so neither `..` nor a symlink can reach outside the Agent's Memory
 * directory.
 *
 * Files are the source of truth and are read fresh on every request (they are small, requests
 * are rare, and the model edits the same files from its side).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_INDEX_FILENAME,
  MEMORY_PLACEHOLDER,
  memoryDir,
  memoryIndexPath,
  parseMemoryFrontmatter,
  readWorkspaceMarker,
  workspaceMemoryDir,
} from "@prismshadow/penguin-core";
import type {
  MemoryFileInfo,
  MemoryFilesResponse,
  MemoryFileResponse,
  MemoryIndexResponse,
  MemoryOverviewResponse,
  MemoryWorkspaceInfo,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { AgentConfigService } from "./agent-config-service.js";

/** Workspace directory names: what core's key generator produces, plus the leeway of a hand-made directory. Excludes `.`/`..` and any separator, so the name can never climb out of `memory/`. */
const WORKSPACE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Topic file names: a Markdown file, no leading dot (dotfiles like `.workspace` are the Harness's, not topics). */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

/** Write cap for one Memory file: Memory is an index plus short topics, and a file this size is already far past what belongs in a prompt-adjacent store. */
export const MAX_MEMORY_FILE_BYTES = 256 * 1024;

export class MemoryService {
  constructor(
    private readonly root: string,
    private readonly agentConfigService: AgentConfigService,
  ) {}

  /** The tab's landing payload: the Agent-level switch, the shared index, and one entry per Workspace directory. */
  async overview(projectId: string, agentId: string): Promise<MemoryOverviewResponse> {
    const view = await this.agentConfigService.getConfig(projectId, agentId);
    return {
      enabled: view.config.memory.enabled,
      templateInjects: view.config.systemPrompt.includes(MEMORY_PLACEHOLDER),
      memoryDir: memoryDir(this.root, projectId, agentId),
      index: await this.readIndexContent(projectId, agentId),
      workspaces: await this.listWorkspaces(projectId, agentId),
    };
  }

  /** Workspace directories under `memory/`, newest activity first (a directory with no topic file yet sorts last, by key). */
  async listWorkspaces(projectId: string, agentId: string): Promise<MemoryWorkspaceInfo[]> {
    const base = memoryDir(this.root, projectId, agentId);
    let entries: string[];
    try {
      entries = (await fs.readdir(base, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // No memory/ directory yet (never initialized, or an Agent that has only run in temporary Workspaces).
      return [];
    }
    const workspaces = await Promise.all(
      entries.map((key) => this.workspaceInfo(path.join(base, key), key)),
    );
    return workspaces.sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      if (a.updatedAt) return -1;
      if (b.updatedAt) return 1;
      return a.workspaceKey.localeCompare(b.workspaceKey);
    });
  }

  private async workspaceInfo(dir: string, key: string): Promise<MemoryWorkspaceInfo> {
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
    const workspacePath = await readWorkspaceMarker(dir);
    return {
      workspaceKey: key,
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      fileCount: files.length,
      ...(latest > 0 ? { updatedAt: new Date(latest).toISOString() } : {}),
    };
  }

  /** Topic files of one Workspace: Markdown only, so the `.workspace` marker and any stray directory stay out. */
  private async topicFileNames(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile() && FILE_NAME_PATTERN.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  async listFiles(
    projectId: string,
    agentId: string,
    workspaceKey: string,
  ): Promise<MemoryFilesResponse> {
    const dir = await this.requireWorkspaceDir(projectId, agentId, workspaceKey);
    const names = await this.topicFileNames(dir);
    const files: MemoryFileInfo[] = [];
    for (const name of names) {
      const info = await this.fileInfo(dir, name);
      if (info) files.push(info);
    }
    return { workspaceKey, files };
  }

  async readFile(
    projectId: string,
    agentId: string,
    workspaceKey: string,
    fileName: string,
  ): Promise<MemoryFileResponse> {
    const dir = await this.requireWorkspaceDir(projectId, agentId, workspaceKey);
    const target = this.resolveFile(dir, fileName);
    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
    const stat = await fs.stat(target);
    return {
      workspaceKey,
      file: this.describe(fileName, content, stat.size, stat.mtime),
      content,
    };
  }

  /** Creates or overwrites a topic file. The Workspace directory must already exist — Workspaces come from Sessions, not from this API. */
  async writeFile(
    projectId: string,
    agentId: string,
    workspaceKey: string,
    fileName: string,
    content: string,
  ): Promise<MemoryFileResponse> {
    const dir = await this.requireWorkspaceDir(projectId, agentId, workspaceKey);
    const target = this.resolveFile(dir, fileName);
    this.assertWritableContent(content);
    await fs.writeFile(target, content, "utf8");
    return this.readFile(projectId, agentId, workspaceKey, fileName);
  }

  /** Renames a topic file within its Workspace; refuses to clobber an existing name. */
  async renameFile(
    projectId: string,
    agentId: string,
    workspaceKey: string,
    fileName: string,
    nextName: string,
  ): Promise<MemoryFileResponse> {
    const dir = await this.requireWorkspaceDir(projectId, agentId, workspaceKey);
    const from = this.resolveFile(dir, fileName);
    const to = this.resolveFile(dir, nextName);
    if (from === to) return this.readFile(projectId, agentId, workspaceKey, fileName);
    if (await pathExists(to)) {
      throw new HttpError(409, "memory_file_exists", `Memory file already exists: ${nextName}`);
    }
    try {
      await fs.rename(from, to);
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
    return this.readFile(projectId, agentId, workspaceKey, nextName);
  }

  /** Deletes a topic file. The index entry pointing at it is the caller's to clean up (the client edits the index in the same flow). */
  async deleteFile(
    projectId: string,
    agentId: string,
    workspaceKey: string,
    fileName: string,
  ): Promise<void> {
    const dir = await this.requireWorkspaceDir(projectId, agentId, workspaceKey);
    const target = this.resolveFile(dir, fileName);
    try {
      await fs.unlink(target);
    } catch {
      throw new HttpError(404, "memory_file_not_found", `Memory file not found: ${fileName}`);
    }
  }

  async readIndex(projectId: string, agentId: string): Promise<MemoryIndexResponse> {
    await this.agentConfigService.requireExists(projectId, agentId);
    return { content: await this.readIndexContent(projectId, agentId) };
  }

  /** Writes the shared index, creating `memory/` if this Agent has never had one. */
  async writeIndex(
    projectId: string,
    agentId: string,
    content: string,
  ): Promise<MemoryIndexResponse> {
    await this.agentConfigService.requireExists(projectId, agentId);
    this.assertWritableContent(content);
    await fs.mkdir(memoryDir(this.root, projectId, agentId), { recursive: true });
    await fs.writeFile(memoryIndexPath(this.root, projectId, agentId), content, "utf8");
    return { content };
  }

  private async readIndexContent(projectId: string, agentId: string): Promise<string> {
    try {
      return await fs.readFile(memoryIndexPath(this.root, projectId, agentId), "utf8");
    } catch {
      return "";
    }
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

  private assertWritableContent(content: string): void {
    if (Buffer.byteLength(content, "utf8") > MAX_MEMORY_FILE_BYTES) {
      throw badRequest(`Memory content exceeds ${MAX_MEMORY_FILE_BYTES} bytes.`);
    }
  }

  /**
   * Validates a workspace key and returns its directory, 404 if it does not exist. The key is
   * only ever a single directory name — a Workspace directory is created by a Session, so this
   * API never creates one.
   */
  private async requireWorkspaceDir(
    projectId: string,
    agentId: string,
    workspaceKey: string,
  ): Promise<string> {
    await this.agentConfigService.requireExists(projectId, agentId);
    if (!WORKSPACE_KEY_PATTERN.test(workspaceKey)) {
      throw badRequest("workspaceKey is invalid.");
    }
    const dir = workspaceMemoryDir(this.root, projectId, agentId, workspaceKey);
    try {
      if ((await fs.stat(dir)).isDirectory()) return dir;
    } catch {
      // Fall through to the 404 below.
    }
    throw new HttpError(
      404,
      "memory_workspace_not_found",
      `Workspace has no Memory directory: ${workspaceKey}`,
    );
  }

  /**
   * The absolute path of a topic file inside a Workspace Memory directory. The name must pass
   * the character rule, must not be the reserved index name, and the joined path is checked
   * for containment — belt and braces, since the rule already excludes separators.
   */
  private resolveFile(dir: string, fileName: string): string {
    if (!FILE_NAME_PATTERN.test(fileName)) {
      throw badRequest("File name must be a Markdown file (letters, digits, . _ - and .md).");
    }
    if (fileName === MEMORY_INDEX_FILENAME) {
      throw badRequest(
        `${MEMORY_INDEX_FILENAME} is the shared Memory index; edit it through the index endpoint.`,
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
