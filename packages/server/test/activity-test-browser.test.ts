/**
 * The test browser: whether it is installed, the admin-only install (one at a time), the
 * link it opens an activity on, and the page session quality checks and tests use.
 *
 * Nothing here downloads or starts a browser: the installer, the executable lookup and the
 * browser launcher are all fakes.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import { openPage, type BrowserLauncher } from "../src/activities/browser-session.js";
import {
  INSTALL_MARKER,
  STATUS_LOG_TAIL,
  locatePlaywrightChromium,
  loopbackAuthority,
  nodeChildEnv,
  spawnPlaywrightInstall,
  type TestBrowser,
  type TestBrowserInstallOutcome,
  type TestBrowserInstallSpec,
  type TestBrowserPorts,
} from "../src/activities/test-browser.js";
import type { TestBrowserStatusResponse } from "../src/activities/test-browser-types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

/** Where the fake lookup says Chromium lives under a browsers directory. */
const executableIn = (dir: string) => path.join(dir, "chromium-0000", "chrome");

/** Unpacks the fake browser; `complete: false` stops before Playwright's last step, the marker. */
async function placeExecutable(dir: string, { complete = true } = {}) {
  await fs.mkdir(path.dirname(executableIn(dir)), { recursive: true });
  await fs.writeFile(executableIn(dir), "fake browser");
  if (complete) await fs.writeFile(path.join(dir, "chromium-0000", INSTALL_MARKER), "");
}

/** An installer the test finishes by hand, recording what it was asked to do. */
function heldInstaller() {
  const specs: TestBrowserInstallSpec[] = [];
  let release: (outcome: TestBrowserInstallOutcome) => void = () => {};
  const runInstall = (spec: TestBrowserInstallSpec) => {
    specs.push(spec);
    return new Promise<TestBrowserInstallOutcome>((resolve) => (release = resolve));
  };
  /** Finishes the install once it has really started (the service creates the directory first). */
  const finish = async (outcome: TestBrowserInstallOutcome, calls = 1) => {
    await vi.waitFor(() => expect(specs).toHaveLength(calls));
    release(outcome);
  };
  return { specs, runInstall, finish };
}

describe("test browser", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(ports: TestBrowserPorts = {}) {
    const t = await createTestApp({
      testBrowserPorts: { locateExecutable: async (dir) => executableIn(dir), ...ports },
    });
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const status = async () => {
      const res = await admin.get("/api/admin/test-browser");
      expect(res.status).toBe(200);
      return ((await res.json()) as TestBrowserStatusResponse).browser;
    };
    const browser = t.deps.tree.api<TestBrowser>("ActivitiesModule", "TestBrowser");
    return { t, admin, status, browser, home: path.join(t.root, "browsers") };
  }

  it("reports the browser missing on a fresh home", async () => {
    const { status, browser, home } = await setup();
    const report = await status();
    expect(report).toMatchObject({
      available: true,
      installed: false,
      path: home,
      installing: false,
      error: null,
      log: null,
    });
    // The version Playwright drives is known before anything is installed.
    expect(report.version).toMatch(/^\d+\.\d+/);
    expect(await browser.executablePath()).toBeNull();
  });

  it("reports it unavailable, and refuses an install, where Playwright is not shipped", async () => {
    // The desktop app: its bundled server has no playwright-core package beside it.
    const installer = heldInstaller();
    const { admin, status } = await setup({
      playwrightCoreDir: null,
      runInstall: installer.runInstall,
    });
    expect(await status()).toMatchObject({ available: false, installed: false, version: null });
    const refused = await admin.post("/api/admin/test-browser/install");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "test_browser_unavailable" } });
    expect(installer.specs).toHaveLength(0);
    expect((await status()).installing).toBe(false);
  });

  it("reports it installed once the executable is on disk", async () => {
    const { status, browser, home } = await setup();
    await placeExecutable(home);
    expect((await status()).installed).toBe(true);
    expect(await browser.executablePath()).toBe(executableIn(home));
  });

  it("does not count a browser whose install stopped before Playwright finished it", async () => {
    const { status, browser, home } = await setup();
    await placeExecutable(home, { complete: false });
    expect((await status()).installed).toBe(false);
    expect(await browser.executablePath()).toBeNull();
  });

  it("reports a timed-out install that left a half-unpacked browser as not installed", async () => {
    const installer = heldInstaller();
    const { admin, status } = await setup({ runInstall: installer.runInstall });
    await admin.post("/api/admin/test-browser/install");
    await vi.waitFor(() => expect(installer.specs).toHaveLength(1));
    await placeExecutable(installer.specs[0]!.browsersDir, { complete: false });
    await installer.finish({ result: "timed_out", log: "" });
    await vi.waitFor(async () => expect((await status()).installing).toBe(false));
    expect(await status()).toMatchObject({ installed: false, error: "timed_out" });
  });

  it("uses the browser a release package ships when the home has none", async () => {
    const bundled = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bundled-browsers-"));
    cleanups.push(() => fs.rm(bundled, { recursive: true, force: true }));
    await placeExecutable(bundled);
    const { status, browser, home } = await setup({ bundledDir: bundled });
    expect(await status()).toMatchObject({ installed: true, path: bundled });
    expect(await browser.executablePath()).toBe(executableIn(bundled));
    // One installed into the home takes over from the packaged one.
    await placeExecutable(home);
    expect(await browser.executablePath()).toBe(executableIn(home));
  });

  it("lets only an admin see or install it", async () => {
    const installer = heldInstaller();
    const { t, status } = await setup({ runInstall: installer.runInstall });
    const { cookie } = await provisionUser(t.app, "author");
    const author = apiClient(t.app, cookie);
    expect((await author.get("/api/admin/test-browser")).status).toBe(403);
    expect((await author.post("/api/admin/test-browser/install")).status).toBe(403);
    expect(installer.specs).toHaveLength(0);
    expect((await status()).installing).toBe(false);
  });

  it("installs one at a time into the home, and reports it installed", async () => {
    const installer = heldInstaller();
    const { admin, status, home } = await setup({ runInstall: installer.runInstall });

    const started = await admin.post("/api/admin/test-browser/install");
    expect(started.status).toBe(202);
    expect(((await started.json()) as TestBrowserStatusResponse).browser.installing).toBe(true);

    // A second press while the first runs is refused, and starts nothing.
    const again = await admin.post("/api/admin/test-browser/install");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "test_browser_installing" } });
    await vi.waitFor(() => expect(installer.specs).toHaveLength(1));

    const [spec] = installer.specs;
    expect(spec!.browsersDir).toBe(home);
    expect(spec!.env.PLAYWRIGHT_BROWSERS_PATH).toBe(home);
    expect(path.basename(spec!.cliPath)).toBe("cli.js");
    expect(spec!.timeoutMs).toBe(15 * 60 * 1000);

    await placeExecutable(home);
    await installer.finish({ result: "ok", log: "downloaded" });
    await vi.waitFor(async () => expect((await status()).installing).toBe(false));
    expect(await status()).toMatchObject({ installed: true, error: null, log: null });

    // Done, a new install may start again (a repair).
    expect((await admin.post("/api/admin/test-browser/install")).status).toBe(202);
    await installer.finish({ result: "ok", log: "" }, 2);
    await vi.waitFor(async () => expect((await status()).installing).toBe(false));
  });

  it("names a failed install and keeps the end of its output", async () => {
    const installer = heldInstaller();
    const { admin, status } = await setup({ runInstall: installer.runInstall });
    await admin.post("/api/admin/test-browser/install");
    const log = `${"x".repeat(STATUS_LOG_TAIL)}\nError: getaddrinfo ENOTFOUND cdn.example`;
    await installer.finish({ result: "failed", log });
    await vi.waitFor(async () => expect((await status()).installing).toBe(false));
    const report = await status();
    expect(report).toMatchObject({ installed: false, error: "failed" });
    expect(report.log).toHaveLength(STATUS_LOG_TAIL);
    expect(report.log!.endsWith("ENOTFOUND cdn.example")).toBe(true);
  });

  it("reports an install that exits cleanly but leaves no browser as incomplete", async () => {
    const installer = heldInstaller();
    const { admin, status } = await setup({ runInstall: installer.runInstall });
    await admin.post("/api/admin/test-browser/install");
    await installer.finish({ result: "ok", log: "nothing happened" });
    await vi.waitFor(async () => expect((await status()).installing).toBe(false));
    expect(await status()).toMatchObject({ installed: false, error: "incomplete" });
  });

  it("reports a timed-out install", async () => {
    const installer = heldInstaller();
    const { admin, status } = await setup({ runInstall: installer.runInstall });
    await admin.post("/api/admin/test-browser/install");
    await installer.finish({ result: "timed_out", log: "" });
    await vi.waitFor(async () => expect((await status()).installing).toBe(false));
    expect((await status()).error).toBe("timed_out");
  });

  it("signs a link that plays the activity on this server's loopback address", async () => {
    const { t, browser } = await setup();
    const { cookie } = await provisionUser(t.app, "player");
    const owner = apiClient(t.app, cookie);
    const project = await owner.post("/api/projects", { projectId: "player-browser" });
    expect(project.status, await project.clone().text()).toBe(201);
    const created = await owner.post("/api/projects/player-browser/activities", {
      productCode: "words",
      refNum: 1,
      title: "Words",
    });
    const activity = (await created.json()) as ActivityDetail;

    const link = new URL(
      await browser.playUrl("player-browser", activity.id, { scene: "intro", language: "es-MX" }),
    );
    expect(link.origin).toBe("http://127.0.0.1:7364");
    expect(link.pathname).toMatch(/^\/preview\/activity\/[^/]+\/play$/);
    expect(link.searchParams.get("scene")).toBe("intro");
    expect(link.searchParams.get("language")).toBe("es-MX");

    // The token works where it was issued and nowhere else.
    const here = await t.app.request(`${link.pathname}${link.search}`, {
      headers: { host: "127.0.0.1:7364" },
    });
    expect(await here.text()).not.toBe("Not found");
    const elsewhere = await t.app.request(link.pathname, { headers: { host: "localhost:7364" } });
    expect(elsewhere.status).toBe(404);
  });

  it("finds the loopback address for any bind", () => {
    expect(loopbackAuthority({ host: "127.0.0.1", port: 7364 })).toBe("127.0.0.1:7364");
    expect(loopbackAuthority({ host: "0.0.0.0", port: 80 })).toBe("127.0.0.1:80");
    expect(loopbackAuthority({ host: "::", port: 9 })).toBe("[::1]:9");
    expect(loopbackAuthority({ host: "localhost", port: 1 })).toBe("localhost:1");
  });
});

describe("installer and lookup", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });
  const tempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-test-browser-"));
    dirs.push(dir);
    return dir;
  };

  it("asks Playwright where Chromium goes under a browsers directory, without installing", async () => {
    const dir = await tempDir();
    const found = await locatePlaywrightChromium(dir);
    expect(found).not.toBeNull();
    expect(found!.startsWith(dir)).toBe(true);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("runs its children as Node under the desktop app's Electron runtime", () => {
    const electron = nodeChildEnv({ PLAYWRIGHT_BROWSERS_PATH: "/b" }, true);
    expect(electron.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(electron.PLAYWRIGHT_BROWSERS_PATH).toBe("/b");
    const plain = nodeChildEnv({ PLAYWRIGHT_BROWSERS_PATH: "/b" }, false);
    expect(plain.ELECTRON_RUN_AS_NODE).toBe(process.env.ELECTRON_RUN_AS_NODE);
    expect(plain.PLAYWRIGHT_BROWSERS_PATH).toBe("/b");
  });

  /** A stand-in for Playwright's CLI: prints its arguments and environment, then exits. */
  async function fakeCli(dir: string, body: string) {
    const cliPath = path.join(dir, "cli.js");
    await fs.writeFile(cliPath, body);
    return cliPath;
  }

  it("runs the installer with the browsers path and reports its exit", async () => {
    const dir = await tempDir();
    const cliPath = await fakeCli(
      dir,
      "console.log(process.argv.slice(2).join(' '), process.env.PLAYWRIGHT_BROWSERS_PATH);" +
        "console.error('boom'); process.exit(3);",
    );
    const outcome = await spawnPlaywrightInstall({
      cliPath,
      browsersDir: dir,
      env: { PLAYWRIGHT_BROWSERS_PATH: dir },
      timeoutMs: 60_000,
      signal: new AbortController().signal,
    });
    expect(outcome.result).toBe("failed");
    expect(outcome.log).toContain(`install --no-shell chromium ${dir}`);
    expect(outcome.log).toContain("boom");
    expect(outcome.log).toContain("exit code 3");
  });

  it("stops an installer that runs past its time limit", async () => {
    const dir = await tempDir();
    const cliPath = await fakeCli(dir, "setInterval(() => {}, 1000);");
    const outcome = await spawnPlaywrightInstall({
      cliPath,
      browsersDir: dir,
      env: {},
      timeoutMs: 300,
      signal: new AbortController().signal,
    });
    expect(outcome.result).toBe("timed_out");
  });
});

describe("browser session", () => {
  function fakeLauncher(options: { gotoFails?: boolean } = {}) {
    const calls = {
      launch: [] as unknown[],
      viewport: null as unknown,
      goto: [] as unknown[],
      timeout: 0,
      closed: 0,
    };
    const page = {
      setDefaultTimeout: (ms: number) => (calls.timeout = ms),
      goto: async (...args: unknown[]) => {
        calls.goto.push(args);
        if (options.gotoFails) throw new Error("net::ERR_CONNECTION_REFUSED");
        return null;
      },
    };
    const launcher = (async (launchOptions: unknown) => {
      calls.launch.push(launchOptions);
      return {
        newContext: async (contextOptions: { viewport: unknown }) => {
          calls.viewport = contextOptions.viewport;
          return { newPage: async () => page };
        },
        close: async () => {
          calls.closed += 1;
        },
      };
    }) as unknown as BrowserLauncher;
    return { launcher, calls, page };
  }

  it("opens the url headless in the given browser and viewport, and closes once", async () => {
    const fake = fakeLauncher();
    const session = await openPage(
      "/browsers/chrome",
      "http://127.0.0.1:7364/preview/activity/t/play",
      { width: 1024, height: 768 },
      { timeoutMs: 5000, launcher: fake.launcher },
    );
    expect(session.page).toBe(fake.page);
    expect(fake.calls.launch).toEqual([
      { executablePath: "/browsers/chrome", headless: true, timeout: 5000 },
    ]);
    expect(fake.calls.viewport).toEqual({ width: 1024, height: 768 });
    expect(fake.calls.timeout).toBe(5000);
    expect(fake.calls.goto).toEqual([
      ["http://127.0.0.1:7364/preview/activity/t/play", { timeout: 5000, waitUntil: "load" }],
    ]);
    await session.close();
    await session.close();
    expect(fake.calls.closed).toBe(1);
  });

  it("closes the browser when the page cannot be opened", async () => {
    const fake = fakeLauncher({ gotoFails: true });
    await expect(
      openPage(
        "/browsers/chrome",
        "http://127.0.0.1:1/",
        { width: 800, height: 600 },
        {
          timeoutMs: 1000,
          launcher: fake.launcher,
        },
      ),
    ).rejects.toThrow("ERR_CONNECTION_REFUSED");
    expect(fake.calls.closed).toBe(1);
  });
});
