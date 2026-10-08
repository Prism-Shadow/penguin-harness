/**
 * Making one narration, word recording, music or sound-effect clip without an agent, Loom's
 * way.
 *
 * Speech and sound runs used to be Media Agent Sessions told to run a staged helper
 * (`generate-speech.mjs` or `generate-sound.mjs`) once; the Session added a model request, a
 * transcript and a wait per clip and decided nothing. The server now runs the same helper
 * itself, in the run's workspace, with the Media Agent's Vault as its environment, and
 * collects what it wrote exactly as before.
 *
 * The helpers stay the one place the providers are called, so their own suites still cover
 * what is sent and what is written.
 *
 * A helper that needs agenthub (Gemini speech, a hub sound model) does not install it per run:
 * one install per dependency set is kept under the cache folder and linked into each run's
 * workspace as its node_modules.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, type Opaque } from "@prismshadow/penguin-core/kernel";
import { stopTree } from "./sandbox-build-runner.js";

/** Provider calls time out at two minutes; an install on a slow network gets as long again. */
export const MEDIA_HELPER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The provider settings a helper may read. The server's own copies are dropped, so only the
 * Vault's reach it; a hub model's key is in the Vault whenever its run starts.
 */
const PROVIDER_KEYS = ["GEMINI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"];

/** How much of a child's output is kept for the reason it failed. */
const OUTPUT_MAX = 64 * 1024;

export type MediaHelperScript = "generate-speech.mjs" | "generate-sound.mjs";

export interface MediaHelperRun {
  /** The run's workspace, holding the helper, its input file and package.json. */
  workspace: string;
  script: MediaHelperScript;
  /** The Media Agent's Vault. */
  vault: Record<string, string>;
  /** Whether package.json names dependencies to install first (agenthub, for Gemini or a hub model). */
  install: boolean;
  /** Where installed dependencies are kept between runs. */
  cacheDir: string;
  signal: Opaque<"AbortSignal", AbortSignal>;
}

/** Ok, or the reason it was not, in words an author can act on. */
export type MediaHelperResult = { ok: true } | { ok: false; error: string };

/** Where a speech or sound run reaches its helper. Absent, the real child processes below. */
export abstract class MediaHelperPorts extends Interface<{
  runHelper?: (run: MediaHelperRun) => Promise<MediaHelperResult>;
}>() {}

@Component()
export class DefaultMediaHelperPorts implements MediaHelperPorts {}

interface ChildOutcome {
  code: number | null;
  output: string;
  timedOut: boolean;
}

function runChild(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; signal: AbortSignal },
): Promise<ChildOutcome> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new Error("Generation cancelled."));
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_MAX);
    };
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: options.shell,
    });
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, MEDIA_HELPER_TIMEOUT_MS);
    timer.unref();
    const abort = () => stopTree(child);
    options.signal.addEventListener("abort", abort, { once: true });
    const settle = () => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      settle();
      reject(error);
    });
    child.on("close", (code) => {
      settle();
      if (options.signal.aborted) reject(new Error("Generation cancelled."));
      else resolve({ code, output, timedOut });
    });
  });
}

/** The helper's last line: it prints only its own words, never a provider's response. */
function lastLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

/** Installs a package.json's dependencies in `dir`; how it went. */
export type DependencyInstaller = (
  dir: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) => Promise<{ ok: boolean; timedOut: boolean }>;

const NPM_INSTALL = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"];

const npmInstall: DependencyInstaller = async (dir, env, signal) => {
  // Windows resolves npm through its shell wrapper, which takes one command line; the
  // arguments are fixed, so nothing needs quoting.
  const shell = process.platform === "win32";
  const installed = await runChild(
    shell ? `npm ${NPM_INSTALL.join(" ")}` : "npm",
    shell ? [] : NPM_INSTALL,
    { cwd: dir, env, shell, signal },
  ).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return { code: null, output: "", timedOut: false };
  });
  return { ok: installed.code === 0, timedOut: installed.timedOut };
};

/** An install several runs may wait on, and how many still do. */
interface SharedInstall {
  promise: Promise<{ ok: boolean; timedOut: boolean }>;
  controller: AbortController;
  waiters: number;
}

/** Installs under way, by cache folder, so runs that start together share one. */
const installing = new Map<string, SharedInstall>();

/**
 * One run's wait on a shared install. Cancelling the run ends its wait only; the install is
 * stopped once no run waits on it, so another run's cancel never fails this one.
 */
function waitForInstall(
  shared: SharedInstall,
  signal: AbortSignal,
): Promise<{ ok: boolean; timedOut: boolean }> {
  if (signal.aborted) return Promise.reject(new Error("Generation cancelled."));
  shared.waiters += 1;
  return new Promise((resolve, reject) => {
    let waiting = true;
    const leave = () => {
      if (!waiting) return false;
      waiting = false;
      shared.waiters -= 1;
      signal.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!leave()) return;
      if (shared.waiters === 0) shared.controller.abort();
      reject(new Error("Generation cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    shared.promise.then(
      (outcome) => {
        if (leave()) resolve(outcome);
      },
      (error: unknown) => {
        if (leave()) reject(error);
      },
    );
  });
}

async function exists(file: string): Promise<boolean> {
  return fs
    .lstat(file)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
}

/** How old a scratch install must be before pruning takes it for one a crash left behind. */
export const SCRATCH_STALE_MS = 60 * 60 * 1000;

/**
 * After `kept` was installed, removes the cache folders it supersedes: other versions of the
 * same packages (an older agenthub once AGENTHUB_VERSION is raised), and scratch installs a
 * crash left behind. A folder for other packages, or an install under way, is left alone.
 * Best effort: a folder that cannot be removed (a helper still running from it) is tried
 * again after the next install.
 */
async function pruneSuperseded(kept: string, dependencies: Record<string, string>) {
  const root = path.dirname(kept);
  const names = packageNames(dependencies);
  const busy = [...installing.keys()].map((dir) => `${path.basename(dir)}.`);
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  for (const entry of entries) {
    const dir = path.join(root, entry);
    if (dir === kept) continue;
    try {
      if (entry.endsWith(".tmp")) {
        if (busy.some((prefix) => entry.startsWith(prefix))) continue;
        if (Date.now() - (await fs.stat(dir)).mtimeMs < SCRATCH_STALE_MS) continue;
        await fs.rm(dir, { recursive: true, force: true });
        continue;
      }
      const other = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      if (packageNames(other.dependencies ?? {}) !== names) continue;
      // Moved aside first: a folder a running helper holds cannot be moved on Windows, so
      // it stays whole rather than half removed. What is moved is scratch from then on.
      const aside = `${dir}.${randomUUID()}.tmp`;
      await fs.rename(dir, aside);
      await fs.rm(aside, { recursive: true, force: true });
    } catch {
      // Left for the next install to try again.
    }
  }
}

/** A dependency set's package names, in the order its cache key sorts them. */
function packageNames(dependencies: Record<string, string>): string {
  return JSON.stringify(Object.keys(dependencies).sort((a, b) => a.localeCompare(b)));
}

/**
 * Gives the workspace the dependencies its package.json names, installed once per dependency
 * set under `cacheDir` and linked in as its node_modules. An install goes to a scratch folder
 * that is renamed into place only when it succeeded, so a folder in the cache is always
 * complete; a failed one leaves nothing and the next run tries again.
 */
export async function linkCachedDependencies(
  workspace: string,
  cacheDir: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  install: DependencyInstaller = npmInstall,
): Promise<MediaHelperResult> {
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  if (!Object.keys(dependencies).length) return { ok: true };
  const dir = path.join(
    path.resolve(cacheDir),
    createHash("sha256").update(JSON.stringify(dependencies)).digest("hex").slice(0, 16),
  );
  if (!(await exists(dir))) {
    let shared = installing.get(dir);
    if (!shared) {
      // The install's own signal, not the first run's: it stops only once no run waits on it.
      const controller = new AbortController();
      const promise = (async () => {
        const scratch = `${dir}.${randomUUID()}.tmp`;
        await fs.mkdir(scratch, { recursive: true });
        await fs.writeFile(
          path.join(scratch, "package.json"),
          JSON.stringify({ private: true, type: "module", dependencies }),
        );
        const outcome = await install(scratch, env, controller.signal).catch(async (error: unknown) => {
          await fs.rm(scratch, { recursive: true, force: true });
          throw error;
        });
        if (!outcome.ok) {
          await fs.rm(scratch, { recursive: true, force: true });
          return outcome;
        }
        // Another process may have filled the same folder meanwhile; its copy is as good.
        await fs.rename(scratch, dir).catch(async (error: unknown) => {
          if (!(await exists(dir))) throw error;
          await fs.rm(scratch, { recursive: true, force: true });
        });
        await pruneSuperseded(dir, dependencies);
        return outcome;
      })().finally(() => installing.delete(dir));
      shared = { promise, controller, waiters: 0 };
      installing.set(dir, shared);
    }
    const outcome = await waitForInstall(shared, signal);
    if (!outcome.ok)
      return {
        ok: false,
        error: outcome.timedOut
          ? "Installing the provider client took too long."
          : "Could not install the provider client. Check that npm is installed and can reach the registry.",
      };
  }
  // A junction needs no privilege on Windows; elsewhere the type is ignored and it is a symlink.
  await fs.symlink(
    path.join(dir, "node_modules"),
    path.join(workspace, "node_modules"),
    "junction",
  );
  return { ok: true };
}

/**
 * Gives the helper its dependencies when it has any, then runs it with this process's own
 * Node. The inherited environment loses its provider keys, so the Vault is the only source
 * of credentials, as it was for the Session.
 */
export async function runMediaHelper(run: MediaHelperRun): Promise<MediaHelperResult> {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  for (const key of PROVIDER_KEYS) delete inherited[key];
  if (run.install) {
    const linked = await linkCachedDependencies(run.workspace, run.cacheDir, inherited, run.signal);
    if (!linked.ok) return linked;
  }
  const made = await runChild(process.execPath, [run.script], {
    cwd: run.workspace,
    // Under the desktop app this interpreter is Electron, which runs a script only with
    // ELECTRON_RUN_AS_NODE set (as test-browser's nodeChildEnv does).
    env: {
      ...inherited,
      ...run.vault,
      ...(process.versions.electron !== undefined ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    shell: false,
    signal: run.signal,
  });
  if (made.code === 0) return { ok: true };
  if (made.timedOut) return { ok: false, error: "The provider took too long to answer." };
  return { ok: false, error: lastLine(made.output) ?? "Generation failed." };
}
