/**
 * The driver library: test a plugin against a real harness desktop shell (Electron), end
 * to end. Two tiers, one library:
 *
 * - `testPlugin` — the whole lifecycle in one call: launch, link the plugin in through the
 *   instance's own management surface, wait for it to load, run the units, remove and
 *   close. The caller hands the units over as MODULES (`@Component` classes with a
 *   `run(context)` method) and reads the per-unit results.
 * - The low-level surface (`launchHarness`, `installPlugin`, `waitForActive`,
 *   `removePlugin`, `closeHarness`) — the same steps one at a time, for the author's
 *   exploratory round: launch a shell, install and remove plugins by hand across the same
 *   instance, keep the window between rounds. Every step is what `testPlugin` itself does,
 *   just held by the caller instead of driven in one go.
 *
 * The window handle is a standard Playwright `Page`, so every locator and `expect`
 * assertion from `@playwright/test` works unchanged inside a unit.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { moduleMetaOf } from "@prismshadow/penguin-core/kernel";
import type { ModuleClass, Plugin } from "@prismshadow/penguin-core/plugin";

/** What a unit's `run` receives: the shell's first window as a standard Playwright page. */
export interface TestContext {
  window: import("@playwright/test").Page;
}

/**
 * The contract a test unit satisfies: a `@Component` (or `@Module`) class with a `run`
 * method, executed by the driver in the caller's process. The class's name — the module
 * name — is the unit's name in the results.
 */
export interface TestUnit {
  run: (context: TestContext) => Promise<void> | void;
}

/** Options the launch step accepts; shared by `launchHarness` and `testPlugin`. */
export interface LaunchOptions {
  /** Path to the harness checkout or build whose desktop shell to launch. Defaults to the current git root. */
  root?: string;
  /** Where the instance keeps its data: `<base>/penguin` and `<base>/chrome`. Defaults to `<gitRoot>/.data/penguin-testing-electron`. */
  dataDir?: string;
}

export interface TestPluginOptions extends LaunchOptions {
  /** Path to the plugin package under test (its directory). */
  pluginDir: string;
  /**
   * The units to run, as modules: `@Component` classes with a `run(context)` method —
   * as a list, or as the plugin package's default export shape (`{ modules }`). Classes
   * without a `run` are ignored, so the whole module list can go in as is.
   */
  units: readonly ModuleClass[] | Plugin;
}

export interface TestResult {
  unit: string;
  ok: boolean;
  error?: string;
  /** How long the unit took, in milliseconds. */
  durationMs: number;
}

/**
 * A running harness instance, held by the caller on the low-level tier: the Electron app,
 * its first window, the instance's HTTP endpoint and the admin session to call it with.
 * Every low-level step takes this handle; `closeHarness` ends the run.
 */
export interface HarnessInstance {
  /** The Electron app Playwright launched (screenshots, windows, `close`). */
  app: import("@playwright/test").ElectronApplication;
  /** The shell's first window, as a standard Playwright page. */
  window: import("@playwright/test").Page;
  /** The instance's HTTP endpoint, e.g. `http://localhost:7364`. */
  base: string;
  /** The admin session cookie headers for the instance's management surface. */
  authHeaders: Record<string, string>;
  /** The Project plugins install into: the first one, or one the driver created. */
  project: string;
}

/** Find the current git repository root, or null when the caller is not inside one. */
export function gitRoot(from: string = process.cwd()): string | null {
  const out = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: from, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
}

/** The data roots an instance gets: `<base>/penguin` (PENGUIN_HOME) and `<base>/chrome`. */
export function instanceDirs(root: string, dataDir?: string): { penguinHome: string; chromeDir: string } {
  const base = dataDir ?? path.join(root, ".data", "penguin-testing-electron");
  return { penguinHome: path.join(base, "penguin"), chromeDir: path.join(base, "chrome") };
}

/**
 * Launch a harness desktop shell and hold it: the caller drives the steps from here —
 * `installPlugin`, `waitForActive`, `removePlugin`, and `closeHarness` when the round is
 * over. The instance gets its own data root and its own seeded admin (never the user
 * harness's), and launches with `--lang=en` so the shell's UI language is deterministic
 * whatever the host machine's locale is — selectors in units do not chase translations.
 */
export async function launchHarness(options: LaunchOptions = {}): Promise<HarnessInstance> {
  const root = options.root ?? gitRoot();
  if (!root) throw new Error("launchHarness: no harness root given and no git root found");

  const { penguinHome, chromeDir } = instanceDirs(root, options.dataDir);
  mkdirSync(penguinHome, { recursive: true });
  mkdirSync(chromeDir, { recursive: true });

  const { _electron } = await import("@playwright/test");
  const adminPassword = "penguin-testing-electron";
  const app = await _electron.launch({
    cwd: root,
    args: [path.join(root, "packages/desktop"), "--lang=en"],
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
      throw new Error("launchHarness: the instance never announced its port");
    })();
    const base = `http://localhost:${port}`;

    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "admin", password: adminPassword }),
    });
    if (!loginResponse.ok || !loginResponse.headers.get("set-cookie")) {
      throw new Error("launchHarness: admin login failed");
    }
    const authHeaders: Record<string, string> = {
      cookie: loginResponse.headers.get("set-cookie")!.split(";")[0]!,
    };

    // A project to install plugins into: the first project on the instance, or one the
    // driver creates when the fresh instance has none.
    const project = await fetch(`${base}/api/projects`, { headers: authHeaders })
      .then((r) => {
        if (!r.ok) throw new Error("launchHarness: listing projects failed");
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
        if (!created.ok) throw new Error("launchHarness: creating a project failed");
        return "penguin-testing-electron";
      });

    return { app, window, base, authHeaders, project };
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
}

/** The plugin package's name, read from its manifest — the name install/remove act on. */
export async function pluginNameOf(pluginDir: string): Promise<string> {
  const fs = await import("node:fs");
  const manifest = JSON.parse(await fs.promises.readFile(path.join(pluginDir, "package.json"), "utf8")) as {
    name: string;
  };
  return manifest.name;
}

/**
 * Link a plugin package into the running instance through its own management surface —
 * the same verb the author-facing `penguin plugin link` uses: the directory is referenced
 * in place, no packaging, no copying. `force` lets a name the build ships be replaced for
 * this throwaway instance; the build's own copy returns when the link is removed.
 */
export async function installPlugin(
  instance: HarnessInstance,
  pluginDir: string,
  options: { force?: boolean } = {},
): Promise<string> {
  const name = await pluginNameOf(pluginDir);
  const linked = await fetch(`${instance.base}/api/projects/${instance.project}/plugins/installed/link`, {
    method: "POST",
    headers: { ...instance.authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      dir: path.resolve(pluginDir),
      overwrite: true,
      ...(options.force === true ? { force: true } : {}),
    }),
  });
  if (!linked.ok) {
    const detail = await linked.text().catch(() => "");
    throw new Error(
      `installPlugin: the instance refused ${pluginDir} (${linked.status}): ${detail.slice(0, 400)}`,
    );
  }

  // The link only puts the directory in the prefix; a Project asking for the name is
  // what loads it (the route's own contract). Ask by name — the specifier resolves to
  // the linked directory on this instance, so nothing downloads.
  const asked = await fetch(`${instance.base}/api/projects/${instance.project}/plugins/installed`, {
    method: "POST",
    headers: { ...instance.authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ specifier: name }),
  });
  if (!asked.ok) {
    const detail = await asked.text().catch(() => "");
    throw new Error(
      `installPlugin: asking the instance for ${name} failed (${asked.status}): ${detail.slice(0, 400)}`,
    );
  }
  return name;
}

/**
 * Poll the instance's own view until the named plugin runs. Resolves once the loader has
 * flipped its generation for the link; throws what the instance itself reported when the
 * plugin cannot load.
 */
export async function waitForActive(instance: HarnessInstance, name: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const installed = await fetch(`${instance.base}/api/projects/${instance.project}/plugins/installed`, {
      headers: instance.authHeaders,
    }).then((r) => {
      if (!r.ok) throw new Error("waitForActive: reading the installed surface failed");
      return r.json() as Promise<{
        plugins: Array<{ specifier: string; active: boolean; error?: string }>;
      }>;
    });
    const row = installed.plugins.find((p) => p.specifier === name);
    if (row?.active === true) return;
    if (row?.error !== undefined) {
      throw new Error(`waitForActive: the instance cannot load ${name}: ${row.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`waitForActive: ${name} never became active on the instance`);
}

/**
 * Remove a plugin from the running instance: the link and the Project's ask go, npm
 * uninstalls, and a name the build ships resolves to the build's own copy again.
 */
export async function removePlugin(instance: HarnessInstance, name: string): Promise<void> {
  await fetch(
    `${instance.base}/api/projects/${instance.project}/plugins/installed?specifier=${encodeURIComponent(name)}`,
    { method: "DELETE", headers: instance.authHeaders },
  ).catch(() => undefined);
}

/** Close a harness the low-level tier launched. Safe to call twice. */
export async function closeHarness(instance: HarnessInstance): Promise<void> {
  await instance.app.close().catch(() => undefined);
}

/**
 * Collect the units: the modules the caller handed over, filtered to those that declare
 * `run` — so a plugin's whole module list can go in as is. Each must be a real module (a
 * decorated class), the unit the harness itself is built from, and concrete: the driver
 * instantiates it and calls `run` with the context.
 */
export function collectUnits(units: readonly ModuleClass[] | Plugin): Array<{
  name: string;
  run: (context: TestContext) => Promise<void> | void;
}> {
  // Array.isArray does not narrow the `readonly ModuleClass[] | Plugin` union itself, so
  // widen to unknown first — there it narrows to any[] and the else branch is the Plugin.
  const source: unknown = units;
  const classes: readonly ModuleClass[] = Array.isArray(source)
    ? (source as readonly ModuleClass[])
    : ((source as Plugin).modules ?? []);
  const collected: Array<{ name: string; run: (context: TestContext) => Promise<void> | void }> = [];
  for (const cls of classes) {
    if (typeof cls !== "function") continue; // Plugin.modules entries may be absent
    const proto = cls.prototype as { run?: TestUnit["run"] };
    if (typeof proto.run !== "function") continue;
    const meta = moduleMetaOf(cls); // throws when the class is not a @Module / @Component
    const instance = new (cls as unknown as new () => TestUnit)();
    collected.push({ name: meta.name, run: (context) => instance.run(context) });
  }
  if (collected.length === 0) {
    throw new Error(
      "collectUnits: no units among the given modules — a unit is a @Component class with a run(context) method",
    );
  }
  return collected;
}

/**
 * Test a plugin against a real harness shell, end to end. The lifecycle runs once, in
 * order, and the shell closes in a `finally` whatever happens; each unit's result comes
 * back individually, so one failing unit does not hide the others. Composed from the
 * low-level surface above — the manual tier is the same steps, held by the caller.
 */
export async function testPlugin(options: TestPluginOptions): Promise<TestResult[]> {
  const instance = await launchHarness(options);
  let pluginName: string | null = null;
  try {
    pluginName = await installPlugin(instance, options.pluginDir, { force: true });
    await waitForActive(instance, pluginName);
    const units = collectUnits(options.units);

    // Run the units, each in its own try so one failure does not hide the rest.
    const results: TestResult[] = [];
    for (const unit of units) {
      const started = Date.now();
      try {
        await unit.run({ window: instance.window });
        results.push({ unit: unit.name, ok: true, durationMs: Date.now() - started });
      } catch (err) {
        results.push({
          unit: unit.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        });
      }
    }
    return results;
  } finally {
    // Whatever happened, remove the plugin and close the shell: the instance returns to
    // a clean state and no Electron process outlives the run. The name may never have
    // been resolved (an early failure) — the remove is then skipped; the shell closes.
    if (pluginName !== null) await removePlugin(instance, pluginName);
    await closeHarness(instance);
  }
}
