/**
 * The sandbox as the file tools see it. read_file, edit_file and write_file run inside the
 * harness process, so no sandbox runner can wrap them the way it wraps a command; instead
 * the Session's sandbox policy — the same one its commands are confined under — is applied
 * here, by the harness itself, before each operation:
 *
 * - `read-only` denies every write, except under the temporary directory when the policy
 *   keeps it writable;
 * - `workspace-write` allows writes under the Workspace, the Session's scratchpad and the
 *   temporary directory, and denies them everywhere else;
 * - a masked path is denied for reading and writing under every mode;
 * - a URL read follows the network level: none reaches nothing, local reaches loopback only.
 *
 * Every decision is made on the REAL path: symlinks are resolved to what they point at (a
 * write follows the chain the way the write itself will), and a path that does not exist
 * yet is resolved through its deepest existing ancestor — so a link planted inside the
 * Workspace cannot carry a write outside it. What the harness cannot do is hold that
 * decision against a command that swaps a directory for a link between the check and the
 * write; the window is one operation wide.
 *
 * A denial is a sentence for the model, naming the mode and what is writable, so the
 * next attempt can be a different one. Docs: /docs/tools § "File tools".
 */
import os from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { modelVisiblePath } from "../../internal/model-visible-path.js";
import { resolveWriteTarget } from "../../internal/atomic-write.js";
import type { SandboxSettings } from "../../plugin/sandbox.js";

/** What one Session's file access is decided against. */
export interface FileAccessScope {
  policy: SandboxSettings;
  /** The Session's Workspace, writable under `workspace-write`. */
  workspaceDir: string;
  /** The Session's scratchpad, writable under `workspace-write` beside the Workspace; absent for a Session without one. */
  scratchpadDir?: string;
}

/**
 * The real path of `target`: its realpath when it exists, otherwise the realpath of its
 * deepest existing ancestor with the missing tail appended. Resolves symlinks along the
 * existing part, which is what a policy decision needs.
 */
export async function canonicalPath(target: string): Promise<string> {
  const absolute = path.resolve(target);
  let dir = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(dir);
      return tail.length === 0 ? real : path.join(real, ...tail);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return absolute;
      tail.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

/** Whether `target` is `root` or lies under it (both already canonical). */
function isUnder(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The temporary directories the sandbox backends keep writable: the platform one, plus
 * `/tmp` where it differs (a macOS tmpdir lives under /private/var).
 */
function tempRoots(): string[] {
  const roots = [os.tmpdir()];
  if (process.platform !== "win32") roots.push("/tmp");
  return roots;
}

/** Loopback hosts, the whole of what the `local` network level reaches. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  return v4 !== null && v4[1] === "127";
}

/** Applies one Session's sandbox policy to the file tools' operations; each `deny*` answers with the denial to show the model, or null when the operation may go ahead. */
export class SandboxFileAccess {
  constructor(private readonly scope: FileAccessScope) {}

  /** Why `target` may not be read under the policy, or null. Only a mask denies a read. */
  async denyRead(target: string): Promise<string | null> {
    const real = await canonicalPath(target);
    return this.maskDenial(real, target);
  }

  /**
   * Why `target` may not be written under the policy, or null. Decided on where the write
   * lands — the end of the symlink chain — and the same masks as a read.
   */
  async denyWrite(target: string): Promise<string | null> {
    const real = await canonicalPath(await resolveWriteTarget(path.resolve(target)));
    const masked = await this.maskDenial(real, target);
    if (masked !== null) return masked;
    const { policy } = this.scope;
    if (policy.mode === "danger-full-access") return null;
    const roots = await this.writableRoots();
    for (const root of roots) if (isUnder(real, root)) return null;
    const shown = modelVisiblePath(target);
    if (policy.mode === "read-only") {
      return `Denied by the sandbox: this session is read-only, so "${shown}" cannot be written${
        roots.length > 0 ? ` (only the temporary directory is writable)` : ""
      }.`;
    }
    return `Denied by the sandbox: "${shown}" is outside the directories this session may write to (mode workspace-write; writable: ${roots.map(modelVisiblePath).join(", ")}).`;
  }

  /** Why `url` may not be fetched under the policy's network level, or null. */
  denyUrl(url: string): string | null {
    const level = this.scope.policy.network;
    if (level === undefined) return null;
    if (level === "none") {
      return `Denied by the sandbox: this session has no network access, so "${url}" cannot be fetched.`;
    }
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return null; // not a URL after all; the caller's own parsing reports it
    }
    if (isLoopbackHost(hostname)) return null;
    return `Denied by the sandbox: this session reaches only the local network (localhost), so "${url}" cannot be fetched.`;
  }

  /** The canonical roots a write may land under, in the order a denial lists them. */
  private async writableRoots(): Promise<string[]> {
    const { policy, workspaceDir, scratchpadDir } = this.scope;
    const roots: string[] = [];
    if (policy.mode === "workspace-write") {
      roots.push(workspaceDir);
      if (scratchpadDir !== undefined) roots.push(scratchpadDir);
    }
    if (policy.writableTemp !== false) roots.push(...tempRoots());
    const canonical = await Promise.all(roots.map((root) => canonicalPath(root)));
    return [...new Set(canonical)];
  }

  /** The mask `real` falls under, as a denial, or null. */
  private async maskDenial(real: string, target: string): Promise<string | null> {
    for (const mask of this.scope.policy.maskPaths ?? []) {
      if (isUnder(real, await canonicalPath(mask))) {
        return `Denied by the sandbox: "${modelVisiblePath(target)}" is under a path masked for this session.`;
      }
    }
    return null;
  }
}
