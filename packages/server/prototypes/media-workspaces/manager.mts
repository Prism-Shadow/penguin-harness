/**
 * PROTOTYPE: a real Git/LFS experiment, deliberately outside the running server.
 * One managed clone owns the object store; each session attachment owns a branch.
 * No production Session or configuration format is changed by this experiment.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface Attachment {
  sessionId: string;
  name: string;
  branch: string;
  baseCommit: string;
  path: string;
  folders: string[];
  checkoutInitialized: boolean;
  state: "preparing" | "ready" | "failed";
  error?: string;
}

interface Registry {
  prototype: "penguin-media-workspaces-v1";
  remote: string;
  baseBranch: string;
  attachments: Attachment[];
}

export type Progress = (message: string) => void;

/**
 * Variables that point git at some other repository, index or object store (a hook's
 * `GIT_DIR`, say). Inherited, they would make every command act on the wrong repository.
 */
const REPOSITORY_LOCATING = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
];

/**
 * The environment git runs in: never prompts, never downloads LFS data on checkout, and
 * acts only on the repository it is run in. Authentication is the operator's: an SSH
 * command or wrapper, askpass, proxy or `GIT_CONFIG_*` setting is kept, and SSH batch mode
 * is only added when no SSH command was chosen.
 */
export function gitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of REPOSITORY_LOCATING) delete env[key];
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_LFS_SKIP_SMUDGE = "1";
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return env;
}

/** Commands never invoke a shell, and automatic Git checkout never downloads LFS data. */
export async function git(cwd: string, args: string[], progress: Progress = () => {}) {
  progress(`git ${args.join(" ")}`);
  const env = gitEnvironment();
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { cwd, env, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_384);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trimEnd());
      else reject(new Error(`git ${args[0]} failed (${code}): ${stderr || stdout}`));
    });
  });
}

function identifier(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(value)) {
    throw new Error(`${label}: use 1–48 lowercase letters, numbers or hyphens.`);
  }
  return value;
}

/** Paths per `git lfs checkout`, so a large folder stays under the command-line limit. */
const CHECKOUT_BATCH = 200;

/** Whether `candidate` is `root` itself or lies beneath it (both already resolved). */
function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative);
}

function folder(value: string) {
  const parts = value.split("/");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9 _./()-]*$/.test(value) ||
    parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  ) {
    throw new Error(`Invalid repository folder: ${value}. Use a relative folder without globs.`);
  }
  return value;
}

export class MediaWorkspacesPrototype {
  readonly root: string;
  readonly repository: string;
  readonly registryPath: string;
  readonly progress: Progress;

  constructor(root: string, progress: Progress = () => {}) {
    this.root = path.resolve(root);
    this.repository = path.join(this.root, "repository");
    this.registryPath = path.join(this.root, "PROTOTYPE-registry.json");
    this.progress = progress;
  }

  /** A process-wide lock also protects separate CLI invocations, not only async calls. */
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true });
    const lockPath = path.join(this.root, "PROTOTYPE.lock");
    const lock = await fs.open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      throw new Error(
        `Prototype is busy. If a previous process crashed, inspect ${lockPath} before removing it.`,
      );
    });
    try {
      await lock.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      );
      return await action();
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }

  private async read(): Promise<Registry> {
    const registry = JSON.parse(await fs.readFile(this.registryPath, "utf8")) as Registry;
    if (registry.prototype !== "penguin-media-workspaces-v1") {
      throw new Error("This directory does not contain a supported prototype registry.");
    }
    return registry;
  }

  private async save(registry: Registry) {
    const pending = `${this.registryPath}.pending`;
    await fs.writeFile(pending, `${JSON.stringify(registry, null, 2)}\n`);
    await fs.rename(pending, this.registryPath);
  }

  async init(remote: string, baseBranch = "main") {
    if (!remote || remote.startsWith("-") || /[\r\n]/.test(remote))
      throw new Error("Invalid remote.");
    identifier(baseBranch, "Base branch");
    return this.exclusive(async () => {
      const entries = (await fs.readdir(this.root)).filter((entry) => entry !== "PROTOTYPE.lock");
      if (entries.length) {
        const existing = await this.read();
        if (existing.remote !== remote || existing.baseBranch !== baseBranch) {
          throw new Error("This prototype root already belongs to another remote or base branch.");
        }
        return existing;
      }
      await git(this.root, ["lfs", "version"], this.progress);
      await git(
        this.root,
        [
          "clone",
          "--no-checkout",
          "--filter=blob:none",
          "--single-branch",
          "--branch",
          baseBranch,
          "--",
          remote,
          this.repository,
        ],
        this.progress,
      );
      await git(this.repository, ["lfs", "install", "--local"], this.progress);
      // Keep this repository's cache under its own common git directory, even when a
      // developer has configured a different global lfs.storage location.
      await git(this.repository, ["config", "--local", "lfs.storage", "lfs"], this.progress);
      const registry: Registry = {
        prototype: "penguin-media-workspaces-v1",
        remote,
        baseBranch,
        attachments: [],
      };
      await this.save(registry);
      return registry;
    });
  }

  async refresh() {
    return this.exclusive(async () => {
      const registry = await this.read();
      await git(this.repository, ["fetch", "origin", registry.baseBranch], this.progress);
      return {
        baseCommit: await git(this.repository, ["rev-parse", `origin/${registry.baseBranch}`]),
      };
    });
  }

  private find(registry: Registry, sessionId: string, name: string) {
    const attachment = registry.attachments.find(
      (item) => item.sessionId === sessionId && item.name === name,
    );
    if (!attachment) throw new Error(`No media workspace named ${name} for session ${sessionId}.`);
    return attachment;
  }

  private async checkFolders(worktree: string, folders: string[], revision = "HEAD") {
    for (const entry of folders) {
      const kind = await git(worktree, ["cat-file", "-t", `${revision}:${entry}`]);
      if (kind !== "tree") throw new Error(`${entry} is not a repository folder at this revision.`);
    }
  }

  private async hydrate(attachment: Attachment) {
    // Explicit filters are command-local: worktrees must not overwrite one another's
    // fetchinclude configuration. Sparse checkout itself uses worktree-local config.
    const patterns = attachment.folders.map((entry) => `${entry}/**`);
    await git(
      attachment.path,
      ["lfs", "fetch", "--include", patterns.join(","), "--exclude", "", "origin", "HEAD"],
      this.progress,
    );
    // Only files still holding pointer text are checked out. `git lfs checkout` by pattern
    // would also recreate every tracked file the agent deleted, undoing its work; files it
    // edited are never pointers, so they are not touched either.
    const waiting = await this.remainingPointers(attachment);
    for (let start = 0; start < waiting.length; start += CHECKOUT_BATCH) {
      const batch = waiting.slice(start, start + CHECKOUT_BATCH);
      await git(attachment.path, ["lfs", "checkout", "--", ...batch], this.progress);
    }
    const pointers = await this.remainingPointers(attachment);
    if (pointers.length) {
      throw new Error(`Assets still contain LFS pointers: ${pointers.slice(0, 10).join(", ")}`);
    }
  }

  private async remainingPointers(attachment: Attachment) {
    const tracked = await git(attachment.path, ["ls-files", "-z", "--", ...attachment.folders]);
    const inside = await fs.realpath(attachment.path);
    const pointers: string[] = [];
    for (const relative of tracked.split("\0").filter(Boolean)) {
      const file = path.join(attachment.path, relative);
      // A symlink anywhere on the way, not only the file itself, must not make hydration
      // verification read outside the attachment: resolve the whole path, then check it.
      const real = await fs.realpath(file).catch(() => null);
      if (!real || !isWithin(inside, real)) continue;
      const stat = await fs.lstat(real).catch(() => null);
      if (!stat?.isFile()) continue;
      const handle = await fs.open(file, "r");
      try {
        const buffer = Buffer.alloc(256);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (
          buffer
            .subarray(0, bytesRead)
            .toString()
            .startsWith("version https://git-lfs.github.com/spec/v1\n")
        ) {
          pointers.push(relative);
        }
      } finally {
        await handle.close();
      }
    }
    return pointers;
  }

  async create(sessionId: string, name: string, requestedFolders: string[]) {
    identifier(sessionId, "Session ID");
    identifier(name, "Workspace name");
    const folders = [...new Set(requestedFolders.map(folder))];
    if (!folders.length) throw new Error("Select at least one repository folder.");
    return this.exclusive(async () => {
      const registry = await this.read();
      if (registry.attachments.some((item) => item.sessionId === sessionId && item.name === name)) {
        throw new Error(
          "This attachment already exists. Use ensure to add folders or retry downloads.",
        );
      }
      const baseCommit = await git(this.repository, [
        "rev-parse",
        `origin/${registry.baseBranch}^{commit}`,
      ]);
      await this.checkFolders(this.repository, folders, baseCommit);
      // Recorded before anything exists on disk: if the process stops at any point after
      // this, the attachment is in the registry and `ensure` finishes it, instead of a
      // branch and worktree that neither `create` (branch exists) nor `ensure` (no record)
      // could recover.
      const attachment: Attachment = {
        sessionId,
        name,
        branch: `codex/media/${sessionId}/${name}`,
        baseCommit,
        path: path.join(this.root, "sessions", sessionId, name),
        folders,
        checkoutInitialized: false,
        state: "preparing",
      };
      registry.attachments.push(attachment);
      await this.save(registry);
      await this.prepare(registry, attachment);
      return attachment;
    });
  }

  /**
   * Adds the attachment's worktree when it is not there yet: on its first preparation, or
   * after a stop that left only the record, or only the branch. An existing branch is
   * checked out as it is, so commits made on it are kept.
   */
  private async ensureWorktree(attachment: Attachment) {
    if (await fs.stat(path.join(attachment.path, ".git")).catch(() => null)) return;
    // Forget a worktree git still lists but whose folder is gone, so it can be added again.
    await git(this.repository, ["worktree", "prune"], this.progress);
    await fs.mkdir(path.dirname(attachment.path), { recursive: true });
    const branchExists = await git(this.repository, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${attachment.branch}`,
    ]).then(
      () => true,
      () => false,
    );
    await git(
      this.repository,
      branchExists
        ? ["worktree", "add", "--no-checkout", attachment.path, attachment.branch]
        : [
            "worktree",
            "add",
            "--no-checkout",
            "-b",
            attachment.branch,
            attachment.path,
            attachment.baseCommit,
          ],
      this.progress,
    );
    // A new worktree has an empty index again, whatever an earlier one had reached.
    attachment.checkoutInitialized = false;
  }

  private async prepare(registry: Registry, attachment: Attachment) {
    attachment.state = "preparing";
    delete attachment.error;
    await this.save(registry);
    try {
      await this.ensureWorktree(attachment);
      await git(
        attachment.path,
        ["sparse-checkout", "set", "--cone", "--", ...attachment.folders],
        this.progress,
      );
      if (!attachment.checkoutInitialized) {
        // --no-checkout leaves an empty index. Sparse-checkout set configures the
        // selection but does not seed it. Populate once, before agents can edit.
        // The merge form refuses to overwrite conflicting working files.
        await git(attachment.path, ["read-tree", "-mu", "HEAD"], this.progress);
        attachment.checkoutInitialized = true;
        await this.save(registry);
      }
      await this.hydrate(attachment);
      attachment.state = "ready";
    } catch (error) {
      attachment.state = "failed";
      attachment.error = String(error);
      throw error;
    } finally {
      await this.save(registry);
    }
  }

  async ensure(sessionId: string, name: string, requestedFolders: string[]) {
    const folders = requestedFolders.map(folder);
    return this.exclusive(async () => {
      const registry = await this.read();
      const attachment = this.find(registry, sessionId, name);
      // Checked in the managed repository, not the worktree, which may be what is missing.
      const onBranch = await git(this.repository, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${attachment.branch}`,
      ]).catch(() => attachment.baseCommit);
      await this.checkFolders(this.repository, folders, onBranch);
      // Expand only. Shrinking could remove work the agent still needs.
      attachment.folders = [...new Set([...attachment.folders, ...folders])];
      await this.prepare(registry, attachment);
      return attachment;
    });
  }

  async status(sessionId?: string, name?: string) {
    return this.exclusive(async () => {
      const registry = await this.read();
      const attachments = registry.attachments.filter(
        (item) => (!sessionId || item.sessionId === sessionId) && (!name || item.name === name),
      );
      return await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const [changes, head, branch, lfsEnv, remainingPointers] = await Promise.all([
              git(attachment.path, ["status", "--short", "--untracked-files=normal"]),
              git(attachment.path, ["rev-parse", "HEAD"]),
              git(attachment.path, ["branch", "--show-current"]),
              git(attachment.path, ["lfs", "env"]),
              this.remainingPointers(attachment),
            ]);
            return {
              ...attachment,
              head,
              currentBranch: branch,
              changes,
              remainingPointers,
              lfsObjectDirectory: lfsEnv
                .split(/\r?\n/)
                .find((line) => line.startsWith("LocalMediaDir="))
                ?.slice(14),
            };
          } catch (error) {
            return { ...attachment, inspectionError: String(error) };
          }
        }),
      );
    });
  }
}
