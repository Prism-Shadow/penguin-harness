/**
 * GitMirror's local-git adapter: a blobless bare mirror of the delivery repository under the
 * organization directory (`git/<owner>/<repo>.git`, created with `--filter=blob:none`).
 * Ancestry, merge bases and "the commits it lacks carry no content" need commits and trees,
 * never file contents, so the mirror holds no blob it was not asked for.
 *
 * Remote access borrows the machine's `gh` as a credential helper (`gh auth git-credential`):
 * nothing is stored here, and a public repository reads anonymously when `gh` is absent. The
 * mirror serves the PR graph only — it is no workspace and writes no workspace's refs. Every
 * command runs as an argument vector (no shell), bounded in time and stopped by the signal.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { GitMirror, RemoteRefs } from "./ports.js";

/** ls-remote and fetch reach the network: a minute. */
export const REMOTE_TIMEOUT_MS = 60_000;
/** Local questions of the mirror. */
const LOCAL_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The environment of every git run: no prompt, C messages, and no lazy fetch — a question about
 * a commit the mirror lacks must answer "missing", not quietly fetch it (git 2.45 and later;
 * an older git fetches the one commit, which answers the same question more slowly).
 */
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GH_PROMPT_DISABLED: "1",
  GIT_NO_LAZY_FETCH: "1",
  LC_ALL: "C",
};

/** Where an organization's mirror of `owner/repo` lives. */
export function mirrorDir(orgDir: string, repo: string): string {
  const [owner, name] = repo.split("/") as [string, string];
  return path.join(orgDir, "git", owner, `${name}.git`);
}

/** A GitHub repository's clone URL. */
export function githubUrl(repo: string): string {
  if (!REPO.test(repo)) throw new Error(`not a repository name: ${repo}`);
  return `https://github.com/${repo}.git`;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export interface LocalGitMirrorOptions {
  /** The bare repository's directory. */
  dir: string;
  /** The remote the mirror follows. */
  url: string;
  /** The URL of another repository a fetch names by `owner/repo` (origins). */
  urlOf?: (repo: string) => string;
  /** The `git` to run. */
  git?: string;
}

export class LocalGitMirror implements GitMirror {
  private ready: Promise<void> | null = null;

  constructor(private readonly opts: LocalGitMirrorOptions) {}

  private run(args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<Run> {
    return new Promise((resolve, reject) => {
      execFile(
        this.opts.git ?? "git",
        [
          // The machine's `gh` lends its login; the helper list is reset first so no other
          // configured helper prompts or stores anything.
          "-c",
          "credential.helper=",
          "-c",
          "credential.helper=!gh auth git-credential",
          ...args,
        ],
        {
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          ...(signal !== undefined ? { signal } : {}),
          env: { ...process.env, ...GIT_ENV },
        },
        (err, stdout, stderr) => {
          if (err === null) {
            resolve({ code: 0, stdout, stderr });
            return;
          }
          const e = err as NodeJS.ErrnoException & { code?: unknown; killed?: boolean };
          if (typeof e.code === "number") {
            resolve({ code: e.code, stdout, stderr });
            return;
          }
          if (e.code === "ENOENT") reject(new Error("git not found"));
          else if (e.name === "AbortError") reject(new Error("aborted"));
          else if (e.killed === true) reject(new Error(`git timed out after ${timeoutMs} ms`));
          else reject(err);
        },
      );
    });
  }

  private async ok(args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const r = await this.run(args, timeoutMs, signal);
    if (r.code !== 0) {
      const line = r.stderr.trim().split(/\r?\n/).at(-1) ?? "";
      throw new Error(`git ${args[0]} failed: ${line || `exit ${r.code}`}`);
    }
    return r.stdout;
  }

  private git(args: readonly string[]): string[] {
    return ["-C", this.opts.dir, ...args];
  }

  /** Creates the bare mirror on first use. */
  private ensure(): Promise<void> {
    this.ready ??= (async () => {
      if (existsSync(path.join(this.opts.dir, "HEAD"))) return;
      await mkdir(path.dirname(this.opts.dir), { recursive: true });
      await this.ok(["init", "--bare", "--quiet", this.opts.dir], LOCAL_TIMEOUT_MS);
      for (const [key, value] of [
        ["remote.origin.url", this.opts.url],
        ["remote.origin.promisor", "true"],
        ["remote.origin.partialclonefilter", "blob:none"],
        ["gc.auto", "0"],
      ] as const) {
        await this.ok(this.git(["config", key, value]), LOCAL_TIMEOUT_MS);
      }
    })().catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  async lsRemote(signal?: AbortSignal): Promise<RemoteRefs> {
    const out = await this.ok(
      ["ls-remote", "--symref", this.opts.url, "HEAD", "refs/heads/*", "refs/pull/*/head"],
      REMOTE_TIMEOUT_MS,
      signal,
    );
    const refs = new Map<string, string>();
    let head: string | null = null;
    for (const line of out.split("\n")) {
      const [left, ref] = line.split("\t");
      if (left === undefined || ref === undefined) continue;
      if (left.startsWith("ref: ")) {
        if (ref === "HEAD") head = left.slice("ref: refs/heads/".length);
        continue;
      }
      if (ref === "HEAD" || !SHA.test(left)) continue;
      refs.set(ref, left.toLowerCase());
    }
    return { refs, head };
  }

  async fetch(
    refs: readonly string[],
    opts: { from?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    if (refs.length === 0) return;
    await this.ensure();
    const url = opts.from === undefined ? "origin" : (this.opts.urlOf ?? githubUrl)(opts.from);
    // A bare commit (a deployment's) is kept under a ref of its own so nothing prunes it.
    const specs = refs.map((r) =>
      SHA.test(r)
        ? `${r}:refs/penguin/commits/${r}`
        : opts.from === undefined
          ? `+${r}:${r}`
          : `+${r}:refs/penguin/origins/${opts.from}/${r.replace(/^refs\//, "")}`,
    );
    await this.ok(
      this.git([
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--filter=blob:none",
        url,
        ...specs,
      ]),
      REMOTE_TIMEOUT_MS,
      opts.signal,
    );
  }

  async missing(oids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(oids.map((o) => o.toLowerCase()))];
    if (wanted.length === 0) return [];
    if (!existsSync(path.join(this.opts.dir, "HEAD"))) return wanted;
    const out = await this.batchCheck(wanted.map((o) => `${o}^{commit}`));
    return wanted.filter((_, i) => out[i]?.endsWith(" missing") !== false);
  }

  /** `git cat-file --batch-check` over these object names, one answer line each. */
  private batchCheck(names: readonly string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.git ?? "git", this.git(["cat-file", "--batch-check"]), {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, ...GIT_ENV },
      });
      let stdout = "";
      const timer = setTimeout(() => child.kill(), LOCAL_TIMEOUT_MS);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(stdout.split("\n").filter((l) => l !== ""));
      });
      child.stdin.end(names.map((n) => `${n}\n`).join(""));
    });
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const r = await this.run(
      this.git(["merge-base", "--is-ancestor", ancestor, descendant]),
      LOCAL_TIMEOUT_MS,
    );
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw new Error(`git merge-base failed: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    const r = await this.run(this.git(["merge-base", a, b]), LOCAL_TIMEOUT_MS);
    if (r.code === 1) return null;
    if (r.code !== 0) throw new Error(`git merge-base failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    return r.stdout.trim() || null;
  }

  async treeEquals(a: string, b: string): Promise<boolean> {
    const out = await this.ok(this.git(["rev-parse", `${a}^{tree}`, `${b}^{tree}`]), LOCAL_TIMEOUT_MS);
    const [x, y] = out.trim().split("\n");
    return x !== undefined && x === y;
  }

  async counts(from: string, to: string): Promise<{ ahead: number; behind: number }> {
    const out = await this.ok(
      this.git(["rev-list", "--left-right", "--count", `${from}...${to}`]),
      LOCAL_TIMEOUT_MS,
    );
    const [behind, ahead] = out.trim().split(/\s+/).map(Number);
    return { ahead: ahead ?? 0, behind: behind ?? 0 };
  }
}
