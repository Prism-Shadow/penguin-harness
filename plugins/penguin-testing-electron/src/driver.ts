/**
 * The driver library: test a plugin against a real harness desktop shell (Electron), end
 * to end. The user declares what to test; the driver runs the whole lifecycle — launch
 * the shell, set the instance up, link the plugin in through the instance's own
 * management surface, wait for it to load, run the declared units, remove the plugin and
 * close the shell — and reports each unit's result.
 *
 * The window handle is a standard Playwright `Page`, so every locator and `expect`
 * assertion from `@playwright/test` works unchanged inside a unit.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

/** One declared test unit: what the plugin under test promises about the real shell. */
export interface TestUnit {
  description?: string;
  run: (context: TestContext) => Promise<void>;
}

/** What a unit sees: the shell's first window as a standard Playwright page. */
export interface TestContext {
  window: import("@playwright/test").Page;
}

export interface TestPluginOptions {
  /** Path to the plugin package under test (its directory). */
  pluginDir: string;
  /** The units to run, by name. */
  units: Record<string, TestUnit>;
  /** Path to the harness checkout or build whose desktop shell to launch. Defaults to the current git root. */
  root?: string;
  /** Where the instance keeps its data: `<base>/penguin` and `<base>/chrome`. Defaults to `<gitRoot>/.data/penguin-testing-electron`. */
  dataDir?: string;
}

export interface TestResult {
  unit: string;
  ok: boolean;
  error?: string;
  /** How long the unit took, in milliseconds. */
  durationMs: number;
}

/** Find the current git repository root, or null when the caller is not inside one. */
export function gitRoot(from: string = process.cwd()): string | null {
  const out = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: from, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
}

/**
 * Test a plugin against a real harness shell, end to end. The lifecycle runs once, in
 * order, and the shell closes in a `finally` whatever happens; each unit's result comes
 * back individually, so one failing unit does not hide the others.
 */
export async function testPlugin(options: TestPluginOptions): Promise<TestResult[]> {
  const root = options.root ?? gitRoot();
  if (!root) throw new Error("testPlugin: no harness root given and no git root found");

  const dataBase = options.dataDir ?? path.join(root, ".data", "penguin-testing-electron");
  const penguinHome = path.join(dataBase, "penguin");
  const chromeDir = path.join(dataBase, "chrome");
  mkdirSync(penguinHome, { recursive: true });
  mkdirSync(chromeDir, { recursive: true });

  const manifest = JSON.parse(
    await import("node:fs").then((fs) =>
      fs.promises.readFile(path.join(options.pluginDir, "package.json"), "utf8"),
    ),
  ) as { name: string };
  const pluginName = manifest.name;

  const { _electron } = await import("@playwright/test");
  const adminPassword = "penguin-testing-electron";
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

  const authHeadersRef: { headers: Record<string, string> } = { headers: {} };
  let baseUrl: string | null = null;
  try {
    const window = await app.firstWindow();

    // The instance's HTTP endpoint. The desktop shell announces its embedded server's
    // port in its userData directory (server-port), not under PENGUIN_HOME; userData
    // follows the app name, which the dev profile suffixes.
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
      throw new Error("testPlugin: the instance never announced its port");
    })();
    const base = `http://localhost:${port}`;
    baseUrl = base;

    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "admin", password: adminPassword }),
    });
    if (!loginResponse.ok || !loginResponse.headers.get("set-cookie")) {
      throw new Error("testPlugin: admin login failed");
    }
    const authHeaders: Record<string, string> = {
      cookie: loginResponse.headers.get("set-cookie")!.split(";")[0]!,
    };
    authHeadersRef.headers = authHeaders;

    // A project to install plugins into: the first project on the instance, or one the
    // driver creates when the fresh instance has none.
    const project = await fetch(`${base}/api/projects`, { headers: authHeaders })
      .then((r) => {
        if (!r.ok) throw new Error("testPlugin: listing projects failed");
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
        if (!created.ok) throw new Error("testPlugin: creating a project failed");
        return "penguin-testing-electron";
      });

    // Link the plugin in through the instance's own management surface — the same verb
    // the author-facing `penguin plugin link` uses: the directory is referenced in place,
    // no packaging, no copying.
    const linked = await fetch(`${base}/api/projects/${project}/plugins/installed/link`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ dir: path.resolve(options.pluginDir), overwrite: true }),
    });
    if (!linked.ok) {
      const detail = await linked.text().catch(() => "");
      throw new Error(
        `testPlugin: the instance refused ${options.pluginDir} (${linked.status}): ${detail.slice(0, 400)}`,
      );
    }

    // The link only puts the directory in the prefix; a Project asking for the name is
    // what loads it (the route's own contract). Ask by name — the specifier resolves to
    // the linked directory on this instance, so nothing downloads.
    const asked = await fetch(`${base}/api/projects/${project}/plugins/installed`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ specifier: pluginName }),
    });
    if (!asked.ok) {
      const detail = await asked.text().catch(() => "");
      throw new Error(
        `testPlugin: asking the instance for ${pluginName} failed (${asked.status}): ${detail.slice(0, 400)}`,
      );
    }

    // The loader flips a generation; poll the instance's own view until the plugin runs.
    let active = false;
    for (let i = 0; i < 50; i++) {
      const installed = await fetch(`${base}/api/projects/${project}/plugins/installed`, {
        headers: authHeaders,
      }).then((r) => {
        if (!r.ok) throw new Error("testPlugin: reading the installed surface failed");
        return r.json() as Promise<{
          plugins: Array<{ specifier: string; active: boolean; error?: string }>;
        }>;
      });
      const row = installed.plugins.find((p) => p.specifier === pluginName);
      if (row?.active === true) {
        active = true;
        break;
      }
      if (row?.error !== undefined) {
        throw new Error(`testPlugin: the instance cannot load ${pluginName}: ${row.error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!active) {
      throw new Error(`testPlugin: ${pluginName} never became active on the instance`);
    }

    // Run the declared units, each in its own try so one failure does not hide the rest.
    const results: TestResult[] = [];
    for (const [name, unit] of Object.entries(options.units)) {
      const started = Date.now();
      try {
        await unit.run({ window });
        results.push({ unit: name, ok: true, durationMs: Date.now() - started });
      } catch (err) {
        results.push({
          unit: name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        });
      }
    }
    return results;
  } finally {
    // Whatever happened, remove the plugin and close the shell: the instance returns to
    // a clean state and no Electron process outlives the run. The port may never have
    // been announced (an early failure) — the baseUrl is then unknown and the remove is
    // skipped; the shell still closes.
    if (baseUrl !== null) {
      await fetch(
        `${baseUrl}/api/projects/penguin-testing-electron/plugins/installed?specifier=${encodeURIComponent(pluginName)}`,
        { method: "DELETE", headers: authHeadersRef.headers },
      ).catch(() => undefined);
    }
    await app.close().catch(() => undefined);
  }
}
