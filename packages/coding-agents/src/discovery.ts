/**
 * Known-agent discovery: a recipe table of the agents people actually have installed,
 * probed against the server machine's PATH (plus the version-manager homes a server
 * process's PATH usually misses — volta, asdf, mise, bun, npm/pnpm globals). Detection
 * itself is filesystem-only and spawns nothing, and that includes reading each agent's
 * stored sign-in (its credential file, or the env key it accepts). Callers may
 * additionally ask for live probes (`probe: true`), which execute the found CLI for a
 * `--version` line and its own auth-status command — callers cache those results, they
 * are not free.
 *
 * The table is data on purpose, and it splits what orca-style TUI hosts can conflate:
 * `detect` names the CLI whose presence proves the agent is installed, while `launch`
 * names the ACP entrypoint — often a separate adapter package, which is why an installed
 * agent can still lack a runnable launch until the adapter is present.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveCommandPath } from "./resolve.js";
import { spawnTarget } from "./connection.js";
import { sandboxedAgentEnv } from "./env.js";
import { killProcessTree } from "./process-tree.js";
import type { AgentSessionConfigOption } from "./types.js";

export type AgentAuthStatus = "ok" | "missing" | "unknown";

export interface AgentLaunch {
  command: string;
  args: string[];
}

interface AgentRecipe {
  /** Stable slug; doubles as the definition id the UI prefills. */
  id: string;
  title: string;
  homepageUrl: string;
  /** Commands whose presence on the machine proves the agent itself is installed. */
  detect: string[];
  /** ACP entrypoints, best first; the first one found on the machine is offered. */
  launch: AgentLaunch[];
  /** How the agent authenticates, warned before the first session: the server cannot open a browser. */
  authHint: string;
  /** Shown when the agent is installed but none of the launch candidates are. */
  adapterHint: string;
  /**
   * One command that installs the agent on any OS, when the vendor publishes one; absent
   * when installing differs per OS, and `homepageUrl` says how instead.
   */
  installCommand?: string;
  /**
   * The CLI's own status check, run only on explicit probe: args against the detected
   * binary, exit 0 meaning signed in unless `signedOut` matches its output.
   */
  authProbe?: { args: string[]; signedOut?: RegExp };
  /**
   * Where the agent keeps its sign-in, read without executing anything: the env keys it
   * accepts and its credential files. Finding one means "ok". `absent` is what finding
   * none means: "missing" when those files are the only place a sign-in can live,
   * "unknown" when it may also sit somewhere unreadable (an OS keychain, another CLI).
   */
  signIn?: {
    env: string[];
    files: CredentialFile[];
    absent: AgentAuthStatus;
    /** Env switches that move the login somewhere unreadable, making no file "unknown". */
    unreadableWhen?: string[];
  };
}

interface CredentialFile {
  /** The file's path, from the server's home dir and env (for a relocated config home). */
  at: (home: string, env: NodeJS.ProcessEnv) => string;
  /** Whether the parsed JSON actually holds a sign-in; absent means existing is enough. */
  holds?: (json: unknown) => boolean;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const nonEmpty = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === "string"
      ? value !== ""
      : Object.keys(record(value)).length > 0;

export interface AgentDiscoveryCandidate {
  recipeId: string;
  title: string;
  homepageUrl: string;
  /** The agent's own CLI was found on the server machine. */
  detected: boolean;
  /**
   * A runnable ACP entrypoint, resolved to an absolute command. Independent of
   * `detected`: an npx-run adapter resolves even when the agent's own CLI is absent,
   * so consumers gate "usable" on `detected`, not on this. Null means nothing runnable
   * was found; `setupHint` says what is missing.
   */
  launch: AgentLaunch | null;
  authHint: string;
  setupHint: string | null;
  /** The one command that installs the agent, when there is one for every OS. */
  installCommand?: string;
  /** The CLI's own `--version` line; present only when the discovery call probed. */
  version?: string;
  /**
   * Whether the agent is signed in: from its stored sign-in on every call, and from its
   * own status command when the call probed (which wins unless it could not tell).
   * Absent when the agent is not detected, or when it keeps its sign-in nowhere Penguin
   * knows to look.
   */
  authStatus?: AgentAuthStatus;
  /** Where `authStatus` came from: the CLI's own status command, or its stored sign-in. */
  authSource?: "cli" | "stored";
  /**
   * The config options a live probe session observed (model choices, toggles); present
   * only when the caller probed the launch and the agent answered.
   */
  models?: AgentSessionConfigOption[];
}

const AGENT_RECIPES: AgentRecipe[] = [
  {
    id: "gemini",
    title: "Gemini CLI",
    homepageUrl: "https://github.com/google-gemini/gemini-cli",
    detect: ["gemini"],
    launch: [{ command: "gemini", args: ["--acp"] }],
    authHint: "Sign in once on the server machine (Google account); a login URL is printed.",
    adapterHint: "Re-run this check after installing the Gemini CLI.",
    installCommand: "npm install -g @google/gemini-cli",
    signIn: {
      env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI"],
      files: [{ at: (home) => path.join(home, ".gemini", "oauth_creds.json") }],
      absent: "missing",
      unreadableWhen: ["GEMINI_FORCE_ENCRYPTED_FILE_STORAGE"],
    },
  },
  {
    id: "claude",
    title: "Claude Code",
    homepageUrl: "https://github.com/agentclientprotocol/claude-agent-acp",
    detect: ["claude"],
    // The ACP entrypoint is a separate adapter over the Claude Code SDK; the legacy
    // package name still installs a working binary, so it stays a candidate. The adapter
    // is published scoped only: an unscoped `claude-agent-acp` does not exist on npm.
    launch: [
      { command: "claude-agent-acp", args: [] },
      { command: "claude-code-acp", args: [] },
      { command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"] },
    ],
    authHint: "Uses your Claude subscription login or ANTHROPIC_API_KEY on the server machine.",
    adapterHint:
      "Claude Code is installed; add its ACP adapter with: npm install -g @agentclientprotocol/claude-agent-acp",
    installCommand:
      "npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp",
    authProbe: { args: ["auth", "status"], signedOut: /"loggedIn"\s*:\s*false/ },
    // macOS keeps the subscription login in the keychain, so no file is not signed out.
    signIn: {
      env: [
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
      ],
      files: [
        {
          at: (home, env) =>
            path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"), ".credentials.json"),
        },
      ],
      absent: "unknown",
    },
  },
  {
    id: "codex",
    title: "Codex CLI",
    homepageUrl: "https://github.com/openai/codex",
    detect: ["codex"],
    launch: [
      { command: "codex-acp", args: [] },
      { command: "npx", args: ["-y", "@agentclientprotocol/codex-acp"] },
    ],
    authHint: "Run `codex login` once on the server machine; a login URL is printed.",
    adapterHint:
      "Codex is installed; add its ACP adapter with: npm install -g @agentclientprotocol/codex-acp",
    installCommand: "npm install -g @openai/codex @agentclientprotocol/codex-acp",
    authProbe: { args: ["login", "status"], signedOut: /not logged in/i },
    // Codex can be set to keep its login in the OS keyring instead of this file.
    signIn: {
      env: [],
      files: [
        { at: (home, env) => path.join(env.CODEX_HOME ?? path.join(home, ".codex"), "auth.json") },
      ],
      absent: "unknown",
    },
  },
  // The three below speak ACP natively, so the CLI itself is the launch: an installed
  // agent is always runnable and the adapter hint never applies.
  {
    id: "opencode",
    title: "OpenCode",
    homepageUrl: "https://github.com/sst/opencode",
    detect: ["opencode"],
    launch: [{ command: "opencode", args: ["acp"] }],
    authHint: "Run `opencode auth login` once on the server machine for the provider you use.",
    adapterHint: "Re-run this check after installing OpenCode.",
    installCommand: "npm install -g opencode-ai",
    // A provider key in the environment or in its own config works too, so no stored
    // login is not proof of being signed out.
    signIn: {
      env: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"],
      files: [
        {
          at: (home, env) =>
            path.join(
              env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
              "opencode",
              "auth.json",
            ),
          holds: nonEmpty,
        },
      ],
      absent: "unknown",
    },
  },
  {
    id: "copilot",
    title: "GitHub Copilot CLI",
    homepageUrl: "https://github.com/github/copilot-cli",
    detect: ["copilot"],
    launch: [{ command: "copilot", args: ["--acp"] }],
    authHint: "Sign in once on the server machine with `copilot` and its /login command.",
    adapterHint: "Re-run this check after installing the Copilot CLI.",
    installCommand: "npm install -g @github/copilot",
    // Copilot can also sign in through the GitHub CLI's login, which this cannot read.
    signIn: {
      env: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
      files: [
        {
          at: (home, env) =>
            path.join(env.COPILOT_HOME ?? path.join(home, ".copilot"), "config.json"),
          holds: (json) => nonEmpty(record(json).loggedInUsers),
        },
      ],
      absent: "unknown",
    },
  },
  {
    id: "cline",
    title: "Cline",
    homepageUrl: "https://github.com/cline/cline",
    detect: ["cline"],
    launch: [{ command: "cline", args: ["--acp"] }],
    authHint: "Run `cline auth` once on the server machine.",
    adapterHint: "Re-run this check after installing the Cline CLI.",
    installCommand: "npm install -g cline",
    signIn: {
      env: [
        "CLINE_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "AI_GATEWAY_API_KEY",
        "V0_API_KEY",
      ],
      files: [
        {
          at: (home, env) =>
            path.join(
              env.CLINE_DATA_DIR ?? path.join(home, ".cline", "data"),
              "settings",
              "providers.json",
            ),
          // Signed in when any provider holds an account login or an API key.
          holds: (json) =>
            Object.values(record(record(json).providers)).some((provider) => {
              const settings = record(record(provider).settings);
              return (
                nonEmpty(settings.auth) ||
                Object.entries(settings).some(
                  ([key, value]) => /apikey/i.test(key) && nonEmpty(value),
                )
              );
            }),
        },
      ],
      absent: "unknown",
    },
  },
  // The agents below speak ACP natively too. None has a sign-in Penguin can read, so their
  // cards say sign-in is unknown until a session or a Test shows otherwise.
  {
    id: "devin",
    title: "Devin for Terminal",
    homepageUrl: "https://cli.devin.ai/docs",
    detect: ["devin"],
    launch: [{ command: "devin", args: ["acp"] }],
    authHint: "Run `devin` once on the server machine and sign in to your Devin account.",
    adapterHint: "Update Devin for Terminal to a build with the `devin acp` command.",
  },
  {
    id: "hermes",
    title: "Hermes",
    homepageUrl: "https://hermes-agent.nousresearch.com/docs/",
    detect: ["hermes"],
    launch: [{ command: "hermes", args: ["acp"] }],
    authHint: "Run `hermes` once on the server machine and set up the model provider it asks for.",
    adapterHint: "Re-run this check after installing Hermes.",
  },
  {
    id: "kilo",
    title: "Kilo",
    homepageUrl: "https://kilo.ai/docs/cli",
    detect: ["kilo"],
    launch: [{ command: "kilo", args: ["acp"] }],
    authHint: "Run `kilo auth login` once on the server machine.",
    adapterHint: "Re-run this check after installing the Kilo CLI.",
    installCommand: "npm install -g @kilocode/cli",
  },
  {
    id: "kimi",
    title: "Kimi Code CLI",
    homepageUrl: "https://github.com/MoonshotAI/kimi-code",
    detect: ["kimi"],
    launch: [{ command: "kimi", args: ["acp"] }],
    authHint: "Run `kimi` once on the server machine and use its /login command.",
    adapterHint: "Re-run this check after installing Kimi Code CLI.",
    installCommand: "npm install -g @moonshot-ai/kimi-code",
  },
  {
    id: "kiro",
    title: "Kiro CLI",
    homepageUrl: "https://kiro.dev/docs/cli/",
    detect: ["kiro-cli"],
    launch: [{ command: "kiro-cli", args: ["acp"] }],
    authHint: "Run `kiro-cli login` once on the server machine.",
    adapterHint: "Re-run this check after installing the Kiro CLI.",
  },
  {
    id: "trae",
    title: "Trae CLI",
    homepageUrl: "https://www.volcengine.com/docs/86677/2227861?lang=en",
    detect: ["traecli"],
    launch: [{ command: "traecli", args: ["acp", "serve"] }],
    authHint: "Run `traecli` once on the server machine and sign in.",
    adapterHint: "Re-run this check after installing the Trae CLI.",
  },
  {
    id: "vibe",
    title: "Mistral Vibe",
    homepageUrl: "https://github.com/mistralai/mistral-vibe",
    // `vibe-acp` ships in the same package as `vibe` and is the ACP entrypoint.
    detect: ["vibe", "vibe-acp"],
    launch: [{ command: "vibe-acp", args: [] }],
    authHint: "Run `vibe` once on the server machine and enter a Mistral API key.",
    adapterHint: "Reinstall Mistral Vibe: its `vibe-acp` entrypoint is missing.",
    installCommand: "uv tool install mistral-vibe",
    signIn: { env: ["MISTRAL_API_KEY"], files: [], absent: "unknown" },
  },
];

/**
 * Install homes for CLIs a server process's PATH misses: version-manager shims and the
 * per-user npm/pnpm global bins, plus the versioned Node roots (fnm, nvm). Windows takes
 * npm's AppData shim dir; the POSIX absolutes are skipped on Windows where they do not
 * exist.
 */
async function installDirCandidates(home: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const dirs = [
    ".local/bin",
    ".volta/bin",
    ".bun/bin",
    ".asdf/shims",
    ".local/share/mise/shims",
    ".npm-global/bin",
    // OpenCode's own installer puts its binary here and only edits shell profiles,
    // which a server process never reads.
    ".opencode/bin",
  ].map((p) => path.join(home, p));
  if (process.platform === "win32") {
    dirs.push(path.join(home, "AppData", "Roaming", "npm"));
    dirs.push(path.join(home, "AppData", "Local", "pnpm"));
  } else {
    dirs.push("/usr/local/bin", "/opt/homebrew/bin");
    if (process.platform === "darwin") dirs.push(path.join(home, "Library", "pnpm"));
    else dirs.push(path.join(home, ".local/share/pnpm"));
  }
  dirs.push(...(await versionedToolchainDirs(home, env)));
  return [...new Set(dirs)];
}

/** Real subdirectories of `dir`; a missing root simply contributes nothing. */
async function subdirectories(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
}

/**
 * One bin dir per installed Node version: fnm keeps shims in `node-versions/<version>/installation`
 * under its root; nvm in `versions/node/<version>/bin`; nvm-windows puts them directly in each
 * `v<semver>` dir under %APPDATA%\nvm. fnm's per-shell multishell dirs are symlinks, so the
 * isDirectory check excludes them — a PATH entry that dies with its shell must never be
 * suggested.
 */
async function versionedToolchainDirs(home: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const dirs: string[] = [];
  const fnmRoots = [
    env.FNM_DIR,
    path.join(home, ".local", "share", "fnm"),
    path.join(home, ".fnm"),
    ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "fnm")] : []),
    ...(env.APPDATA ? [path.join(env.APPDATA, "fnm")] : []),
  ].filter((root): root is string => typeof root === "string" && root !== "");
  for (const root of fnmRoots) {
    for (const version of await subdirectories(path.join(root, "node-versions"))) {
      dirs.push(path.join(version, "installation"));
    }
  }
  const nvmRoots = [env.NVM_DIR, path.join(home, ".nvm")].filter(
    (root): root is string => typeof root === "string" && root !== "",
  );
  for (const root of nvmRoots) {
    for (const version of await subdirectories(path.join(root, "versions", "node"))) {
      dirs.push(path.join(version, "bin"));
    }
  }
  if (env.APPDATA !== undefined && env.APPDATA !== "") {
    for (const version of await subdirectories(path.join(env.APPDATA, "nvm"))) {
      if (/^v\d/.test(path.basename(version))) dirs.push(version);
    }
  }
  return dirs;
}

/**
 * Probe the machine for each known agent. `env` and `home` are injectable for tests;
 * the filesystem pass is cheap enough to compute per request and always fresh. With
 * `probe: true` each detected agent's CLI is additionally executed once for a
 * `--version` line and its auth status — callers cache those results.
 *
 * `env` is the server's own environment, used to find the CLIs. `agentEnv` is the one an
 * agent is actually spawned with (a sandboxed allow-list plus its definition's own vars):
 * the sign-in checks and the probes read that, since a key only the server holds never
 * reaches the agent. It defaults to the bare sandboxed environment.
 */
export async function discoverAgents(
  options: {
    env?: NodeJS.ProcessEnv;
    home?: string;
    probe?: boolean;
    agentEnv?: (recipeId: string) => NodeJS.ProcessEnv;
  } = {},
): Promise<AgentDiscoveryCandidate[]> {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const agentEnv = options.agentEnv ?? (() => sandboxedAgentEnv({}, env));
  const extraDirs = await installDirCandidates(home, env);
  // Absolute path when found on the machine, undefined when not (resolveCommandPath
  // hands unresolved bare names back unchanged).
  const find = async (command: string) => {
    const resolved = await resolveCommandPath(command, { env, extraDirs });
    return resolved === command ? undefined : resolved;
  };

  return Promise.all(
    AGENT_RECIPES.map(async (recipe): Promise<AgentDiscoveryCandidate> => {
      const detections = await Promise.all(recipe.detect.map(find));
      const detectedPath = detections.find((found) => found !== undefined);
      const detected = detectedPath !== undefined;
      let launch: AgentLaunch | null = null;
      for (const candidate of recipe.launch) {
        const resolved = await find(candidate.command);
        if (resolved !== undefined) {
          launch = { command: resolved, args: [...candidate.args] };
          break;
        }
      }
      const childEnv = detected ? agentEnv(recipe.id) : {};
      const probed =
        options.probe === true && detectedPath !== undefined
          ? await probeCli(detectedPath, recipe, childEnv)
          : {};
      const stored =
        detected && recipe.signIn !== undefined
          ? await storedSignIn(recipe.signIn, home, childEnv)
          : undefined;
      // The CLI's own answer wins; where it could not tell, what it stored still says.
      const cliAnswered = probed.authStatus !== undefined && probed.authStatus !== "unknown";
      const authStatus = cliAnswered ? probed.authStatus : (stored ?? probed.authStatus);
      return {
        recipeId: recipe.id,
        title: recipe.title,
        homepageUrl: recipe.homepageUrl,
        detected,
        launch,
        authHint: recipe.authHint,
        setupHint:
          launch !== null
            ? null
            : detected
              ? recipe.adapterHint
              : "Not found on the server machine.",
        ...(recipe.installCommand !== undefined ? { installCommand: recipe.installCommand } : {}),
        ...(probed.version !== undefined ? { version: probed.version } : {}),
        ...(authStatus !== undefined
          ? { authStatus, authSource: cliAnswered ? ("cli" as const) : ("stored" as const) }
          : {}),
      };
    }),
  );
}

/** A value that switches a sign-in on: set, and not an explicit off ("0", "false"). */
function isOn(value: string | undefined): boolean {
  return value !== undefined && value !== "" && !/^(0|false|no|off)$/i.test(value.trim());
}

/**
 * The agent's stored sign-in, read from the env keys it accepts and its credential files;
 * runs nothing. `env` is the environment the agent is spawned with.
 */
async function storedSignIn(
  signIn: NonNullable<AgentRecipe["signIn"]>,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<AgentAuthStatus> {
  if (signIn.env.some((key) => isOn(env[key]))) return "ok";
  // Some agents can move their login into the OS keychain; then no file is not signed out.
  if (signIn.unreadableWhen?.some((key) => isOn(env[key])) === true) return "unknown";
  for (const file of signIn.files) {
    let text: string;
    try {
      text = await fs.readFile(file.at(home, env), "utf8");
    } catch {
      continue;
    }
    if (file.holds === undefined) return "ok";
    try {
      // Line comments allowed: Copilot's config opens with one. A BOM is dropped first.
      const json = text.replace(/^﻿/, "").replace(/^\s*\/\/.*$/gm, "");
      if (file.holds(JSON.parse(json))) return "ok";
    } catch {
      // Unparseable is not signed out: the agent may still read what this cannot.
      return "unknown";
    }
  }
  return signIn.absent;
}

/**
 * Run the detected CLI's `--version` and its auth status check. Version reads the first
 * output line; auth classifies by explicit pattern first, then by exit code. Every
 * failure degrades to "absent"/"unknown" — a probe must never fail the discovery.
 */
async function probeCli(
  file: string,
  recipe: AgentRecipe,
  env: NodeJS.ProcessEnv,
): Promise<Pick<AgentDiscoveryCandidate, "version" | "authStatus">> {
  const [versionRun, authRun] = await Promise.all([
    quickRun(file, ["--version"], env, 3_000),
    recipe.authProbe ? quickRun(file, recipe.authProbe.args, env, 5_000) : undefined,
  ]);
  const version =
    versionRun.code === undefined
      ? undefined
      : versionRun.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line !== "");
  // A check that could not run or never answered says nothing about the login; nor does a
  // failure that is not the signed-out answer (a broken config also exits non-zero).
  let authStatus: AgentAuthStatus = "unknown";
  if (authRun !== undefined && authRun.code !== undefined) {
    const output = authRun.stdout + authRun.stderr;
    if (recipe.authProbe?.signedOut?.test(output) === true) authStatus = "missing";
    else if (authRun.code === 0) authStatus = "ok";
    else if (recipe.authProbe?.signedOut === undefined) authStatus = "missing";
  }
  return {
    ...(version !== undefined ? { version } : {}),
    ...(recipe.authProbe ? { authStatus } : {}),
  };
}

/** Output kept from a quick run: a status line or a version fits many times over. */
const OUTPUT_CAP = 64 * 1024;

/**
 * Run a short CLI command and collect what it printed. `code` is its exit code, or
 * undefined when it could not start or did not finish in time. The timeout settles the run
 * itself and kills the whole process tree: on Windows a `.cmd` shim runs under cmd.exe,
 * and killing only that leaves the real CLI holding the pipes open, so waiting for
 * `close` could wait forever. Input is closed, so a command that prompts ends instead.
 */
function quickRun(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | undefined }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    const settle = (code: number | undefined) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    };
    const [command, routedArgs] = spawnTarget(file, args);
    let child: ChildProcess;
    try {
      child = spawn(command, routedArgs, {
        env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // Its own process group off Windows, so the kill reaches everything it started.
        detached: process.platform !== "win32",
        ...(command !== file ? { windowsVerbatimArguments: true } : {}),
      });
    } catch {
      settle(undefined);
      return;
    }
    timer = setTimeout(() => {
      killProcessTree(child);
      settle(undefined);
    }, timeoutMs);
    timer.unref();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString();
    });
    child.on("error", () => settle(undefined));
    child.on("close", (code) => settle(code ?? undefined));
  });
}
