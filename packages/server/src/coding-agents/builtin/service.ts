/**
 * Built-in agents: GitHub Copilot, run from the Copilot CLI's own platform package, which this
 * service downloads into the data root and registers as an ordinary coding agent
 * (`copilot-builtin`, over ACP) with the admin's PAT as COPILOT_GITHUB_TOKEN. Download state
 * lives here; the definition and its variables live with the other coding agents.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { sandboxedAgentEnv, type AgentServerDefinition } from "@prismshadow/penguin-coding-agents";
import type { BuiltinAgentInfo } from "../../api/types.js";
import { Config } from "../../hmr/capabilities.js";
import { BuiltinAgents } from "../../mechanisms/builtin-agents.js";
import { CodingAgents } from "../../mechanisms/coding-agents.js";
import { maskApiKey } from "../../services/project-config-service.js";
import { COPILOT_VERSION, copilotPackageName, isMuslLinux } from "./copilot-package.js";
import {
  RuntimeInstallError,
  cleanRuntimes,
  installRuntime,
  installedRuntime,
} from "./runtime-install.js";

const AGENT_ID = "copilot-builtin";
const TITLE = "GitHub Copilot (built-in)";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const MISSING_PROGRAM = "The Copilot program is missing. Try again to download it.";
const SESSIONS_OPEN = "Close the sessions using built-in Copilot before removing it.";

interface Download {
  controller: AbortController;
  received: number;
  total: number | null;
  /** The token to register once the download lands; a later setup or replace updates it. */
  token: string;
  /** Settles (never rejects) when the download has finished, failed or been cancelled. */
  done: Promise<void>;
}

@Component()
export class BuiltinAgentsService implements BuiltinAgents {
  @Use() private readonly config!: Config;
  @Use() private readonly codingAgents!: CodingAgents;

  private readonly packageName = copilotPackageName(process.platform, process.arch, isMuslLinux());
  private download: Download | null = null;
  private failure: string | null = null;
  /** The installed version and the absolute program it runs, or null. */
  private installed: { version: string; program: string } | null = null;

  /** Kernel lifecycle hook: restore what an earlier process installed and sweep leftovers. */
  async setup(): Promise<void> {
    const definition = this.definition();
    const version = definition !== undefined ? this.versionOfCommand(definition.command) : null;
    const runtime = version !== null ? await installedRuntime(this.runtimesDir(), version) : null;
    this.installed =
      runtime !== null ? { version: runtime.version, program: runtime.program } : null;
    // A definition whose program is gone (quarantined, data folder cleared, root moved) is a
    // failed install: the card offers Try again with the stored token, and Remove.
    if (definition !== undefined && runtime === null) this.failure = MISSING_PROGRAM;
    await cleanRuntimes(this.runtimesDir(), this.installed?.version ?? null);
  }

  list(): BuiltinAgentInfo[] {
    return [this.info()];
  }

  startSetup(_id: "copilot", token?: string): BuiltinAgentInfo {
    if (this.packageName === null) return this.info();
    const given = token?.trim() || undefined;
    const pat = given ?? this.definition()?.env?.COPILOT_GITHUB_TOKEN;
    if (pat === undefined || pat === "") {
      throw new RuntimeInstallError(
        "start",
        "Paste a GitHub personal access token to set up Copilot.",
      );
    }
    if (this.download !== null) {
      // Join the download already running; it registers the newest token when it lands.
      if (given !== undefined) this.download.token = given;
      return this.info();
    }
    // A new token applies to what is installed now, whether or not a download follows.
    if (given !== undefined && this.installed !== null) {
      this.writeDefinition(this.installed.program, given);
    }
    if (this.installed?.version === COPILOT_VERSION && this.failure === null) return this.info();
    this.startDownload(pat);
    return this.info();
  }

  cancel(_id: "copilot"): void {
    this.download?.controller.abort();
  }

  replaceToken(_id: "copilot", token: string): BuiltinAgentInfo {
    const pat = token.trim();
    if (pat === "") throw new RuntimeInstallError("start", "Paste a GitHub personal access token.");
    if (this.installed === null) throw new RuntimeInstallError("start", "Set up Copilot first.");
    this.writeDefinition(this.installed.program, pat);
    if (this.download !== null) this.download.token = pat;
    return this.info();
  }

  async remove(_id: "copilot"): Promise<void> {
    // A running agent holds its program open; deleting under it half-fails on Windows.
    if (this.codingAgents.listSessions().some((s) => s.agentId === AGENT_ID)) {
      throw new RuntimeInstallError("start", SESSIONS_OPEN);
    }
    const running = this.download;
    if (running !== null) {
      running.controller.abort();
      // Let the install finish unwinding before its folders are deleted underneath it.
      await running.done;
    }
    this.codingAgents.removeBuiltinDefinition(AGENT_ID);
    this.installed = null;
    this.failure = null;
    await fs.rm(this.runtimesDir(), { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(this.copilotHome(), { recursive: true, force: true }).catch(() => undefined);
  }

  // --- internals ---------------------------------------------------------------------------

  /** Synchronous up to the first await, so concurrent setups see the download and join it. */
  private startDownload(token: string): void {
    const controller = new AbortController();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => (settle = resolve));
    const download: Download = { controller, received: 0, total: null, token, done };
    this.download = download;
    this.failure = null;
    void this.runDownload(download).finally(() => {
      if (this.download === download) this.download = null;
      settle();
    });
  }

  private async runDownload(download: Download): Promise<void> {
    const { signal } = download.controller;
    try {
      const home = this.copilotHome();
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const runtime = await installRuntime({
        // Read at download time: tests (and operators) point it at another registry.
        registry: (process.env.PENGUIN_NPM_REGISTRY ?? DEFAULT_REGISTRY).replace(/\/+$/u, ""),
        packageName: this.packageName!,
        version: COPILOT_VERSION,
        runtimesDir: this.runtimesDir(),
        signal,
        // The --version check runs the downloaded program: no server secrets, its own home.
        env: sandboxedAgentEnv({ COPILOT_HOME: home }),
        onProgress: (received, total) => {
          download.received = received;
          download.total = total;
        },
      });
      if (signal.aborted) throw new RuntimeInstallError("cancelled", "The download was cancelled.");
      this.writeDefinition(runtime.program, download.token);
      const previous = this.installed?.version ?? null;
      this.installed = { version: runtime.version, program: runtime.program };
      if (previous !== null && previous !== runtime.version) {
        await cleanRuntimes(this.runtimesDir(), runtime.version);
      }
    } catch (error) {
      this.failure =
        error instanceof RuntimeInstallError && error.kind === "cancelled"
          ? null
          : `Could not set up Copilot: ${(error as Error).message}`;
    }
  }

  private writeDefinition(program: string, token: string): void {
    const home = this.copilotHome();
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.codingAgents.saveBuiltinDefinition({
      id: AGENT_ID,
      title: TITLE,
      command: program,
      args: ["--acp"],
      env: { COPILOT_GITHUB_TOKEN: token, COPILOT_HOME: home },
      builtin: "copilot",
    });
  }

  private info(): BuiltinAgentInfo {
    const token = this.definition()?.env?.COPILOT_GITHUB_TOKEN;
    const installedVersion = this.installed?.version ?? null;
    const status: BuiltinAgentInfo["status"] =
      this.packageName === null
        ? "unsupported"
        : this.download !== null
          ? "downloading"
          : this.failure !== null
            ? "failed"
            : installedVersion === null
              ? "not-installed"
              : installedVersion !== COPILOT_VERSION
                ? "update-available"
                : "ready";
    return {
      id: "copilot",
      agentId: AGENT_ID,
      title: TITLE,
      status,
      installedVersion,
      pinnedVersion: COPILOT_VERSION,
      downloadSize: this.download?.total ?? null,
      progress:
        this.download === null
          ? null
          : { received: this.download.received, total: this.download.total },
      tokenMasked: token !== undefined && token !== "" ? maskApiKey(token) : null,
      envPending:
        this.codingAgents.listAgents({ withEnv: true }).find((a) => a.id === AGENT_ID)
          ?.envPending === true,
      message:
        this.packageName === null
          ? `Copilot has no build for this machine (${process.platform}-${process.arch}).`
          : this.failure,
    };
  }

  private definition(): AgentServerDefinition | undefined {
    return this.codingAgents
      .listDefinitionsForBuiltin()
      .find((d) => d.id === AGENT_ID && d.builtin === "copilot");
  }

  private runtimesDir(): string {
    return path.join(this.config.root, "runtimes", "copilot");
  }

  private copilotHome(): string {
    return path.join(this.config.root, "coding-agents", AGENT_ID, "copilot-home");
  }

  /** The version folder a saved command points into, or null. */
  private versionOfCommand(command: string): string | null {
    const relative = path.relative(this.runtimesDir(), command);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const version = relative.split(path.sep)[0];
    return version !== undefined && version !== "" ? version : null;
  }
}
