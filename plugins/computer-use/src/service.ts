/**
 * The plugin's state on this server, one per data root: whether agent-desktop is installed (and
 * installing it), the program to run, and runs of it with the environment and state directory a
 * caller gets.
 *
 * It outlives a re-assembly of the App: the modules are created again per generation, and each
 * hands this service its current settings readers (`bind`), so an install that is running keeps
 * running and the card keeps showing it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentDesktopEnv } from "./env.js";
import {
  installAgentDesktop,
  readInstalled,
  targetPinOf,
  UnsupportedPlatformError,
} from "./install.js";
import type { Installed, InstallProgress } from "./install.js";
import { resolveLaunch, xdgDataDirs } from "./launch-name.js";
import type { LaunchChoice } from "./launch-name.js";
import { AGENT_DESKTOP, targetKey } from "./pin.js";
import type { AgentDesktopPin } from "./pin.js";
import { runAgentDesktop } from "./runner.js";
import type { AgentDesktopProgram, RunOutput } from "./runner.js";
import { SelfTree } from "./self-target.js";
import { mkdirPrivate, stateRootOf, sweepStateDirs } from "./state.js";
import { settingsOf, registryOf } from "./settings.js";
import type { ComputerUseSettings } from "./settings.js";

/** Where agent-desktop stands on this server. */
export type InstallState =
  | {
      kind: "unsupported";
      target: string;
      /** What this machine lacks beside its target (a C library agent-desktop cannot run on). */
      libc?: { en: string; zh: string };
    }
  | { kind: "missing" }
  | { kind: "installing"; progress: InstallProgress | null; startedAt: number }
  | { kind: "installed"; installed: Installed }
  | { kind: "failed"; message: string; at: number }
  | {
      kind: "override";
      path: string;
      /** What `<path> version` reported, or null when it did not answer. */
      version: string | null;
      problem: string | null;
    };

/** The program to run, or why there is none. */
export type ProgramChoice =
  | { ok: true; program: AgentDesktopProgram; helper?: string; version: string }
  | {
      ok: false;
      code: "unsupported" | "not_installed" | "installing" | "install_failed";
      message: string;
    };

export interface ServiceOptions {
  root: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  pin?: AgentDesktopPin;
  selfTree?: SelfTree;
  now?: () => number;
  log?: (line: string) => void;
  /** Tests: the program that stands in for agent-desktop (a script that prints envelopes). */
  program?: AgentDesktopProgram;
  /** Linux: the glibc version, or null for none (musl); read from Node's report by default. */
  glibc?: string | null;
  /** Tests: where `launch` looks for desktop entries and programs, and what counts as the system's. */
  launch?: {
    dataDirs?: string[];
    pathDirs?: string[];
    trusted?: (file: string) => Promise<boolean>;
  };
}

/** The oldest glibc agent-desktop's Linux programs run on. */
const MIN_GLIBC = [2, 35] as const;

/** This Linux machine's glibc version, or null when it has none (musl). */
export function glibcVersion(): string | null {
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: unknown } })
    ?.header;
  return typeof header?.glibcVersionRuntime === "string" ? header.glibcVersionRuntime : null;
}

/** Why a Linux C library cannot run agent-desktop, or null when it can. */
export function libcProblem(glibc: string | null): { en: string; zh: string } | null {
  if (glibc === null) {
    return {
      en: "it has no glibc (musl, as on Alpine), and agent-desktop's Linux programs need glibc 2.35 or later",
      zh: "它没有 glibc（如 Alpine 的 musl），而 agent-desktop 的 Linux 程序需要 glibc 2.35 及以上",
    };
  }
  const [major = 0, minor = 0] = glibc.split(".").map((n) => Number.parseInt(n, 10));
  if (major > MIN_GLIBC[0] || (major === MIN_GLIBC[0] && minor >= MIN_GLIBC[1])) return null;
  return {
    en: `its glibc is ${glibc}, and agent-desktop's Linux programs need glibc 2.35 or later`,
    zh: `它的 glibc 是 ${glibc}，而 agent-desktop 的 Linux 程序需要 glibc 2.35 及以上`,
  };
}

/** What the settings readers give the service, current per generation. */
export interface SettingsReaders {
  get(name: string): Record<string, unknown>;
}

/** An install that failed is tried again on demand after this long. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export class ComputerUseService {
  readonly root: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly pin: AgentDesktopPin;
  readonly selfTree: SelfTree;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly testProgram: AgentDesktopProgram | undefined;
  private readonly launchOpts: ServiceOptions["launch"];
  private readers: SettingsReaders | null = null;
  private current: InstallState = { kind: "missing" };
  private installing: Promise<void> | null = null;
  private checked: Promise<void> | null = null;
  private overrideSeen: string | null = null;
  private lastSweep = 0;

  constructor(opts: ServiceOptions) {
    this.root = opts.root;
    this.platform = opts.platform ?? process.platform;
    this.arch = opts.arch ?? process.arch;
    this.pin = opts.pin ?? AGENT_DESKTOP;
    this.env = opts.env ?? process.env;
    this.fetchImpl = opts.fetch;
    this.selfTree = opts.selfTree ?? new SelfTree();
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((line) => console.warn(line));
    this.testProgram = opts.program;
    this.launchOpts = opts.launch;
    const target = targetKey(this.platform, this.arch);
    if (this.pin.targets[target] === undefined) {
      this.current = { kind: "unsupported", target };
    } else if (this.platform === "linux" && opts.program === undefined) {
      const libc = libcProblem(opts.glibc !== undefined ? opts.glibc : glibcVersion());
      if (libc !== null) this.current = { kind: "unsupported", target, libc };
    }
  }

  /** The readers of this generation of the App. */
  bind(readers: SettingsReaders): void {
    this.readers = readers;
  }

  settings(): ComputerUseSettings {
    return settingsOf(this.readers?.get("computer-use") ?? {});
  }

  registry(): string {
    return registryOf(this.readers?.get("plugin-sources") ?? {}, this.env);
  }

  state(): InstallState {
    return this.current;
  }

  /**
   * Brings the state up to date with the disk and the settings — once per process for the disk —
   * and, when the plugin is on and nothing is installed, starts the install.
   */
  async start(): Promise<void> {
    await this.refresh();
    const s = this.settings();
    if (s.enabled && s.binaryPath === "" && this.current.kind === "missing") void this.install();
    void this.sweep();
  }

  /** Re-reads what is installed (the first time, and after the settings change). */
  async refresh(): Promise<void> {
    const s = this.settings();
    if (s.binaryPath !== "") {
      if (this.overrideSeen !== s.binaryPath || this.current.kind !== "override") {
        this.overrideSeen = s.binaryPath;
        this.current = await this.readOverride(s.binaryPath);
      }
      return;
    }
    this.overrideSeen = null;
    if (this.current.kind === "override") {
      // The path was cleared: what counts again is what this plugin installed.
      this.current = { kind: "missing" };
      this.checked = null;
    }
    if (this.current.kind === "unsupported" || this.current.kind === "installing") return;
    this.checked ??= (async () => {
      try {
        const installed = await readInstalled(this.root, {
          platform: this.platform,
          arch: this.arch,
          pin: this.pin,
        });
        if (this.current.kind !== "installing") {
          this.current =
            installed !== null ? { kind: "installed", installed } : { kind: "missing" };
        }
      } catch (err) {
        if (err instanceof UnsupportedPlatformError) {
          this.current = { kind: "unsupported", target: err.target };
        }
      }
    })();
    await this.checked;
  }

  private async readOverride(file: string): Promise<InstallState> {
    if (!path.isAbsolute(file)) {
      return { kind: "override", path: file, version: null, problem: "the path is not absolute" };
    }
    try {
      await fs.access(file);
    } catch {
      return { kind: "override", path: file, version: null, problem: "no file is there" };
    }
    const version = await new Promise<string | null>((resolve) => {
      execFile(
        file,
        ["version"],
        { timeout: 10_000, windowsHide: true, env: agentDesktopEnv(this.env, this.platform, {}) },
        (err, stdout) => {
          if (err) return resolve(null);
          try {
            const parsed = JSON.parse(stdout) as { data?: { version?: unknown } };
            resolve(typeof parsed.data?.version === "string" ? parsed.data.version : null);
          } catch {
            resolve(null);
          }
        },
      );
    });
    return {
      kind: "override",
      path: file,
      version,
      problem: version === null ? "it did not answer `version` with an envelope" : null,
    };
  }

  /**
   * Installs the pinned agent-desktop; resolves when the attempt has ended. A second call while
   * one runs joins it. Nothing is installed for an unsupported machine, while the plugin is off,
   * or while a program path is set.
   */
  install(): Promise<void> {
    if (this.installing !== null) return this.installing;
    const s = this.settings();
    if (this.current.kind === "unsupported" || !s.enabled || s.binaryPath !== "") {
      return Promise.resolve();
    }
    const startedAt = this.now();
    this.current = { kind: "installing", progress: null, startedAt };
    this.installing = (async () => {
      try {
        const installed = await installAgentDesktop({
          root: this.root,
          registry: this.registry(),
          platform: this.platform,
          arch: this.arch,
          pin: this.pin,
          ...(this.fetchImpl !== undefined ? { fetch: this.fetchImpl } : {}),
          progress: (progress) => {
            this.current = { kind: "installing", progress, startedAt };
          },
        });
        this.current = { kind: "installed", installed };
        this.log(`[computer-use] agent-desktop ${installed.version} installed in ${installed.dir}`);
      } catch (err) {
        if (err instanceof UnsupportedPlatformError) {
          this.current = { kind: "unsupported", target: err.target };
        } else {
          const message = err instanceof Error ? err.message : String(err);
          this.current = { kind: "failed", message, at: this.now() };
          this.log(`[computer-use] installing agent-desktop failed: ${message}`);
        }
      } finally {
        this.installing = null;
      }
    })();
    return this.installing;
  }

  /** The program to run now; a missing install (or a failed one, after a while) is started. */
  async program(): Promise<ProgramChoice> {
    if (this.testProgram !== undefined) {
      return { ok: true, program: this.testProgram, version: this.pin.version };
    }
    await this.refresh();
    const state = this.current;
    switch (state.kind) {
      case "override":
        if (state.problem !== null) {
          return {
            ok: false,
            code: "not_installed",
            message: `the agent-desktop program path setting names ${state.path}, but ${state.problem}`,
          };
        }
        return {
          ok: true,
          program: { file: state.path },
          ...this.helperBeside(state.path),
          version: state.version ?? "unknown",
        };
      case "installed":
        return {
          ok: true,
          program: { file: state.installed.program },
          ...(state.installed.helper !== undefined ? { helper: state.installed.helper } : {}),
          version: state.installed.version,
        };
      case "unsupported":
        return {
          ok: false,
          code: "unsupported",
          message:
            state.libc !== undefined
              ? `Computer Use cannot run on this machine: ${state.libc.en}`
              : `agent-desktop has no program for ${state.target}; Computer Use runs on macOS, Windows and Linux, on x64 and arm64`,
        };
      case "installing":
        return {
          ok: false,
          code: "installing",
          message: `agent-desktop ${this.pin.version} is being installed on this server; try again in a minute`,
        };
      case "failed":
        if (this.now() - state.at > RETRY_AFTER_MS) void this.install();
        return {
          ok: false,
          code: "install_failed",
          message: `agent-desktop could not be installed (${state.message}); an administrator retries it in Settings → Plugins → Computer Use`,
        };
      case "missing":
        void this.install();
        return {
          ok: false,
          code: "installing",
          message: `agent-desktop ${this.pin.version} is being installed on this server; try again in a minute`,
        };
    }
  }

  private helperBeside(program: string): { helper?: string } {
    return this.platform === "darwin"
      ? { helper: path.join(path.dirname(program), "agent-desktop-macos-helper") }
      : {};
  }

  /** The environment one run gets: the session variables, the state root, the macOS helper. */
  /** What `launch <app>` hands agent-desktop on this system, or why it is refused (launch-name.ts). */
  launchTarget(app: string): Promise<LaunchChoice> {
    return resolveLaunch(app, {
      platform: this.platform,
      dataDirs: this.launchOpts?.dataDirs ?? xdgDataDirs(this.env),
      pathDirs:
        this.launchOpts?.pathDirs ??
        (this.env.PATH ?? "").split(path.delimiter).filter((d) => d !== ""),
      ...(this.launchOpts?.trusted !== undefined ? { trusted: this.launchOpts.trusted } : {}),
    });
  }

  /** The environment of one run; `pathOverride` replaces PATH (a Linux launch: system directories only). */
  envFor(stateDir: string, helper?: string, pathOverride?: string): Record<string, string> {
    return agentDesktopEnv(this.env, this.platform, {
      AGENT_DESKTOP_HOME: stateDir,
      ...(this.platform === "darwin" && helper !== undefined
        ? { AGENT_DESKTOP_MACOS_HELPER_PATH: helper }
        : {}),
      ...(pathOverride !== undefined ? { PATH: pathOverride } : {}),
    });
  }

  /** Runs one command with `choice`'s program in `stateDir`. */
  run(
    choice: Extract<ProgramChoice, { ok: true }>,
    argv: readonly string[],
    opts: { stateDir: string; stdin?: Buffer | string; budgetMs: number; path?: string },
  ): Promise<RunOutput> {
    void this.sweep();
    return runAgentDesktop(choice.program, {
      argv,
      env: this.envFor(opts.stateDir, choice.helper, opts.path),
      // The user's home, never the state directory: an app agent-desktop launches inherits the
      // working directory, and on Windows a process's working directory cannot be removed while
      // it runs, which would pin the Session's state directory for the app's lifetime.
      cwd: os.homedir(),
      ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
      budgetMs: opts.budgetMs,
    });
  }

  /** The state directory of runs the server makes for itself (the card's checks). */
  async probeDir(): Promise<string> {
    const dir = path.join(stateRootOf(this.root), "server");
    await mkdirPrivate(this.root, dir);
    return dir;
  }

  /** Sweeps unused state directories, at most once an hour. */
  private async sweep(): Promise<void> {
    if (this.now() - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = this.now();
    try {
      await sweepStateDirs(this.root);
    } catch {
      // Best effort: a directory that cannot be removed now is tried again in an hour.
    }
  }

  /** Whether this machine is one of the pin's targets. */
  supported(): boolean {
    try {
      targetPinOf(this.pin, this.platform, this.arch);
      return true;
    } catch {
      return false;
    }
  }
}

/** One service per data root, shared by every generation of the App in this process. */
const services = new Map<string, ComputerUseService>();

export function serviceFor(root: string, make: () => ComputerUseService): ComputerUseService {
  let service = services.get(root);
  if (service === undefined) {
    service = make();
    services.set(root, service);
  }
  return service;
}
