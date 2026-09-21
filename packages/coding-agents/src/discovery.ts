/**
 * Known-agent discovery: a recipe table of the agents people actually have installed,
 * probed against the server machine's PATH (plus the version-manager homes a server
 * process's PATH usually misses — volta, asdf, mise, bun, npm/pnpm globals). Detection is
 * filesystem-only; nothing is executed here.
 *
 * The table is data on purpose, and it splits what orca-style TUI hosts can conflate:
 * `detect` names the CLI whose presence proves the agent is installed, while `launch`
 * names the ACP entrypoint — often a separate adapter package, which is why an installed
 * agent can still lack a runnable launch until the adapter is present.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { resolveCommandPath } from "./resolve.js";

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
}

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
}

const AGENT_RECIPES: AgentRecipe[] = [
  {
    id: "gemini",
    title: "Gemini CLI",
    homepageUrl: "https://github.com/google-gemini/gemini-cli",
    detect: ["gemini"],
    launch: [{ command: "gemini", args: ["--experimental-acp"] }],
    authHint: "Sign in once on the server machine (Google account); a login URL is printed.",
    adapterHint: "Re-run this check after installing the Gemini CLI.",
  },
  {
    id: "claude",
    title: "Claude Code",
    homepageUrl: "https://github.com/zed-industries/claude-agent-acp",
    detect: ["claude"],
    // The ACP entrypoint is a separate adapter over the Claude Code SDK; the legacy
    // package name still installs a working binary, so it stays a candidate.
    launch: [
      { command: "claude-agent-acp", args: [] },
      { command: "claude-code-acp", args: [] },
      { command: "npx", args: ["-y", "claude-agent-acp"] },
    ],
    authHint: "Uses your Claude subscription login or ANTHROPIC_API_KEY on the server machine.",
    adapterHint:
      "Claude Code is installed; add its ACP adapter with: npm install -g claude-agent-acp",
  },
  {
    id: "codex",
    title: "Codex CLI",
    homepageUrl: "https://github.com/openai/codex",
    detect: ["codex"],
    launch: [
      { command: "codex-acp", args: [] },
      { command: "npx", args: ["-y", "@zed-industries/codex-acp"] },
    ],
    authHint: "Run `codex login` once on the server machine; a login URL is printed.",
    adapterHint:
      "Codex is installed; add its ACP adapter with: npm install -g @zed-industries/codex-acp",
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
 * the result is cheap enough to compute per request and always fresh.
 */
export async function discoverAgents(
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<AgentDiscoveryCandidate[]> {
  const env = options.env ?? process.env;
  const extraDirs = await installDirCandidates(options.home ?? os.homedir(), env);
  // Absolute path when found on the machine, undefined when not (resolveCommandPath
  // hands unresolved bare names back unchanged).
  const find = async (command: string) => {
    const resolved = await resolveCommandPath(command, { env, extraDirs });
    return resolved === command ? undefined : resolved;
  };

  return Promise.all(
    AGENT_RECIPES.map(async (recipe): Promise<AgentDiscoveryCandidate> => {
      const detections = await Promise.all(recipe.detect.map(find));
      const detected = detections.some((found) => found !== undefined);
      let launch: AgentLaunch | null = null;
      for (const candidate of recipe.launch) {
        const resolved = await find(candidate.command);
        if (resolved !== undefined) {
          launch = { command: resolved, args: [...candidate.args] };
          break;
        }
      }
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
      };
    }),
  );
}
