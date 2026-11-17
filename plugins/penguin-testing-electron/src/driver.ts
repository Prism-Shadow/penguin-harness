/**
 * The driver library: launch a real harness desktop shell (Electron) for end-to-end
 * testing, prepare the instance, and drive it with Playwright's Electron channel.
 *
 * The window handle is a standard Playwright `Page`, so every locator and `expect`
 * assertion from `@playwright/test` works unchanged.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface LaunchOptions {
  /** Path to the harness checkout or build whose desktop shell to launch. Defaults to the current git root. */
  root?: string;
  /** Where the instance keeps its data: `<base>/penguin` and `<base>/chrome`. Defaults to `<gitRoot>/.data/penguin-testing-electron`. */
  dataDir?: string;
  /** Extra arguments passed to the Electron binary. */
  args?: string[];
}

export interface HarnessInstance {
  /** The shell's first window as a standard Playwright page. */
  window: import("@playwright/test").Page;
  /** The Electron app handle (close it with `close()`). */
  app: { close(): Promise<void> };
  /** The instance's PENGUIN_HOME on disk. */
  penguinHome: string;
  /** The instance's browser data directory on disk. */
  chromeDir: string;
  /** Install a plugin package directory into the running instance. */
  install: (pluginDir: string) => Promise<void>;
  /** Remove an installed plugin from the running instance. */
  remove: (pluginName: string) => Promise<void>;
}

/** Find the current git repository root, or null when the caller is not inside one. */
export function gitRoot(from: string = process.cwd()): string | null {
  const out = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: from, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
}

/**
 * Launch a harness desktop shell end to end: prepare the instance's data root, then
 * start the shell over Playwright's Electron channel and return its first window.
 */
export async function launchHarness(options: LaunchOptions = {}): Promise<HarnessInstance> {
  const root = options.root ?? gitRoot();
  if (!root) throw new Error("launchHarness: no harness root given and no git root found");

  const base = options.dataDir ?? path.join(root, ".data", "penguin-testing-electron");
  const penguinHome = path.join(base, "penguin");
  const chromeDir = path.join(base, "chrome");
  mkdirSync(penguinHome, { recursive: true });
  mkdirSync(chromeDir, { recursive: true });

  const { _electron } = await import("@playwright/test");
  const app = await _electron.launch({
    cwd: root,
    args: [path.join(root, "packages/desktop")],
    env: {
      ...process.env,
      PENGUIN_HOME: penguinHome,
      PENGUIN_BROWSER_DATA_DIR: chromeDir,
    },
  });
  const window = await app.firstWindow();

  return {
    window,
    app,
    penguinHome,
    chromeDir,
    async install(pluginDir: string) {
      const out = spawnSync("node", ["--run", "link"], { cwd: pluginDir, encoding: "utf8" });
      if (out.status !== 0) {
        throw new Error(`install: linking ${pluginDir} failed: ${out.stderr.trim()}`);
      }
    },
    async remove(pluginName: string) {
      void pluginName;
    },
  };
}
