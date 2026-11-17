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
  /**
   * Install the plugin under test through the instance's own management surface — never
   * by writing into the plugin prefix directly. The plugin list is per-Agent and loading
   * flips by generation: installing registers the plugin into the Agent's list and the
   * next generation of the loader picks it up; uninstall goes back the same way.
   */
  install: (pluginDir: string) => Promise<void>;
  /** Remove an installed plugin from the running instance, the same way it went in. */
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

  const dataBase = options.dataDir ?? path.join(root, ".data", "penguin-testing-electron");
  const penguinHome = path.join(dataBase, "penguin");
  const chromeDir = path.join(dataBase, "chrome");
  mkdirSync(penguinHome, { recursive: true });
  mkdirSync(chromeDir, { recursive: true });

  const { _electron } = await import("@playwright/test");
  const adminPassword = options.adminPassword ?? "penguin-testing-electron";
  const app = await _electron.launch({
    cwd: root,
    args: [path.join(root, "packages/desktop")],
    env: {
      ...process.env,
      PENGUIN_HOME: penguinHome,
      PENGUIN_BROWSER_DATA_DIR: chromeDir,
      // The instance's own seeded admin, so the driver may call the instance's plugin
      // management surface (install/remove) as an admin. This credential belongs to the
      // throwaway instance only — it is never the user harness's.
      PENGUIN_SEED_ADMIN_PASSWORD: adminPassword,
    },
  });
  const window = await app.firstWindow();

  // The instance's HTTP endpoint. The desktop shell announces its embedded server's port
  // in its userData directory (server-port), not under PENGUIN_HOME; userData follows the
  // app name, which the dev profile suffixes.
  const port = await (async () => {
    const { readFileSync } = await import("node:fs");
    const candidates = [
      path.join(process.env.HOME ?? "", ".config", "PenguinHarness-Dev", "server-port"),
      path.join(process.env.HOME ?? "", ".config", "PenguinHarness", "server-port"),
    ];
    for (let i = 0; i < 100; i++) {
      for (const file of candidates) {
        try {
          const value = readFileSync(file, "utf8").trim();
          if (/^\d{1,5}$/.test(value)) return Number(value);
        } catch {
          // not written yet
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("launchHarness: the instance never announced its port");
  })();

  const base = `http://localhost:${port}`;

  const loginResponse = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "admin", password: adminPassword }),
  });
  if (!loginResponse.ok) {
    throw new Error(`launchHarness: admin login failed (${loginResponse.status})`);
  }
  if (!loginResponse.headers.get("set-cookie")) {
    throw new Error("launchHarness: the login answered no session cookie");
  }
  const authHeaders: Record<string, string> = {
    cookie: loginResponse.headers.get("set-cookie")!.split(";")[0]!,
  };

  // A project to install plugins into: the first project on the instance, or one the
  // driver creates when the fresh instance has none.
  const project = await fetch(`${base}/api/projects`, { headers: authHeaders })
    .then((r) => {
      if (!r.ok) throw new Error(`launchHarness: listing projects failed (${r.status})`);
      return r.json() as Promise<{ projects: Array<{ projectId: string }> }>;
    })
    .then(async (body) => {
      const existing = body.projects[0]?.projectId;
      if (existing) return existing;
      const created = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "penguin-testing-electron" }),
      });
      if (!created.ok) {
        throw new Error(`launchHarness: creating a project failed (${created.status})`);
      }
      return "penguin-testing-electron";
    });

  return {
    window,
    app,
    penguinHome,
    chromeDir,
    async install(pluginDir: string) {
      // Through the instance's own management surface — never a bare copy into the plugin
      // prefix. The package is packed and uploaded as an archive; the route installs it
      // via npm, lists it in the project's table and applies (the loader flips a
      // generation, so the next load carries it).
      const { execFileSync } = await import("node:child_process");
      const tarball = execFileSync("npm", ["pack", "--ignore-scripts", pluginDir], {
        encoding: "utf8",
      }).trim().split("\n").pop()!;
      const dataBase64 = (
        await import("node:fs").then((fs) => fs.promises.readFile(tarball))
      ).toString("base64");
      const response = await fetch(`${base}/api/projects/${project}/plugins/installed/archive`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ dataBase64, overwrite: true }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `install: the instance refused ${pluginDir} (${response.status}): ${detail.slice(0, 400)}`,
        );
      }
      await import("node:fs").then((fs) => fs.promises.rm(tarball, { force: true }));
    },
    async remove(pluginName: string) {
      const response = await fetch(
        `${base}/api/projects/${project}/plugins/installed?specifier=${encodeURIComponent(pluginName)}`,
        { method: "DELETE", headers: authHeaders },
      );
      if (!response.ok) {
        throw new Error(`remove: the instance refused ${pluginName} (${response.status})`);
      }
    },
  };
}
