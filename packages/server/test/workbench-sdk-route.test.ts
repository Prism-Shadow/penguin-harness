/**
 * The page SDK a workbench's pages import: `…/workbenches/:id/sdk/amsp.js` and `…/sdk/workbench.js`.
 *
 * - amsp.js is AMSP's browser build byte for byte, a JavaScript module the workbench's iframe
 *   loads as a same-origin module script, revalidated against its ETag.
 * - workbench.js evaluates beside it and exposes AMSP's exports plus `apiBase`, `transport`,
 *   `followSession` and `abortSession`, the API base read from where it was loaded: `/api`, or
 *   `/server/<machineId>/api` for a machine's workbench.
 * - Both are answered only under an existing workbench of a Project the caller can read, and
 *   only to a signed-in caller.
 * - The browser build travels inside a bundled server, which has no node_modules to read it from.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Amsp from "@prismshadow/amsp";
import { agentDir } from "@prismshadow/penguin-core";
import { compilePushBundle, pushBundleOptions } from "../../../scripts/push-bundle.mjs";
import { apiClient, createTestApp, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SERVER = path.resolve(import.meta.dirname, "..");
/** What the server's own `@prismshadow/amsp/browser` resolves to. */
const BROWSER_BUILD = path.join(
  SERVER,
  "node_modules",
  "@prismshadow",
  "amsp",
  "dist",
  "browser",
  "amsp.js",
);

const PROJECT = "owner-sdk";
const AGENT = "default_agent";
const SDK = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches/demo/sdk`;

/** A module script the workbench's iframe loads: its cookie and the browser's fetch metadata. */
const asModuleScript = (cookie: string, extra: Record<string, string> = {}) => ({
  headers: {
    cookie,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "script",
    ...extra,
  },
});

type PageSdk = typeof Amsp & {
  apiBase: string;
  transport: Amsp.HttpTransport;
  followSession(sessionId: string, options?: { tailLimit?: number }): Amsp.SessionReader;
  abortSession(sessionId: string): Promise<boolean>;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("the workbench page SDK", () => {
  let t: TestApp;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestApp();
    const owner = await provisionUser(t.app, "owner");
    cookie = owner.cookie;
    const created = await apiClient(t.app, cookie).post("/api/projects", {
      projectId: PROJECT,
      name: "sdk",
    });
    expect(created.status, await created.text()).toBe(201);
    // A workbench folder is enough: its load fails before the compiler, and it still exists.
    const dir = path.join(agentDir(t.root, PROJECT, AGENT), "workbenches", "demo");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), '{"name":"demo","type":"module"}');
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fetchSdk = async (file: string): Promise<Uint8Array> => {
    const res = await t.app.request(`${SDK}/${file}`, asModuleScript(cookie));
    expect(res.status).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  };

  it("serves AMSP's browser build byte for byte to the iframe's module script, revalidated by ETag", async () => {
    const res = await t.app.request(`${SDK}/amsp.js`, asModuleScript(cookie));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[\w-]+"$/);
    const served = new Uint8Array(await res.arrayBuffer());
    expect(sha256(served)).toBe(sha256(await fs.readFile(BROWSER_BUILD)));

    const again = await t.app.request(
      `${SDK}/amsp.js`,
      asModuleScript(cookie, { "if-none-match": etag! }),
    );
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    const workbench = await t.app.request(`${SDK}/workbench.js`, asModuleScript(cookie));
    expect(workbench.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(workbench.headers.get("cache-control")).toBe("no-cache");
  });

  it("evaluates workbench.js with AMSP's exports and the door of the server it came from", async () => {
    const files = {
      "amsp.js": await fetchSdk("amsp.js"),
      "workbench.js": await fetchSdk("workbench.js"),
    };
    /** Writes the two files where `prefix` + the route would put them, and imports workbench.js. */
    const loadAt = async (...prefix: string[]): Promise<PageSdk> => {
      const dir = path.join(
        t.root,
        "page",
        ...prefix,
        "projects",
        PROJECT,
        "agents",
        AGENT,
        "workbenches",
        "demo",
        "sdk",
      );
      await fs.mkdir(dir, { recursive: true });
      for (const [name, bytes] of Object.entries(files)) {
        await fs.writeFile(path.join(dir, name), bytes);
      }
      // The map amsp.js names, so the module loader does not report it missing.
      await fs.copyFile(`${BROWSER_BUILD}.map`, path.join(dir, "amsp.js.map"));
      const url = pathToFileURL(path.join(dir, "workbench.js")).href;
      return (await import(/* @vite-ignore */ url)) as PageSdk;
    };

    const plain = await loadAt("api");
    const machine = await loadAt("server", "m-1", "api");
    expect(plain.apiBase).toMatch(/\/page\/api$/);
    expect(machine.apiBase).toMatch(/\/page\/server\/m-1\/api$/);
    expect(machine.apiBase.slice(0, -"/server/m-1/api".length)).toBe(
      plain.apiBase.slice(0, -"/api".length),
    );

    const amsp = (await import(
      /* @vite-ignore */ pathToFileURL(path.join(path.dirname(BROWSER_BUILD), "amsp.js")).href
    )) as Record<string, unknown>;
    for (const name of Object.keys(amsp)) expect(machine).toHaveProperty(name);
    expect(machine.transport).toBeInstanceOf(machine.HttpTransport);

    const calls: { url: string; method: string; credentials: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET", credentials: init.credentials });
      return new Response(null, { status: url.endsWith("/abort") ? 202 : 404 });
    });
    const reader = machine.followSession("s 1", { tailLimit: 5 });
    expect(reader).toBeInstanceOf(machine.SessionReader);
    // The stub refuses the stream, which stops the reader for good: one request, then the error.
    await new Promise<void>((resolve) => reader.on("error", () => resolve()));
    expect(await machine.abortSession("s 1")).toBe(true);
    expect(calls).toEqual([
      { url: `${machine.apiBase}/sessions/s%201/amsp`, method: "GET", credentials: "same-origin" },
      {
        url: `${machine.apiBase}/sessions/s%201/abort`,
        method: "POST",
        credentials: "same-origin",
      },
    ]);
  });

  it("answers only a signed-in reader of the Project, under a workbench that exists", async () => {
    expect((await t.app.request(`${SDK}/workbench.js`)).status).toBe(401);
    const stranger = await provisionUser(t.app, "stranger");
    expect((await t.app.request(`${SDK}/amsp.js`, asModuleScript(stranger.cookie))).status).toBe(
      404,
    );
    const missing = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches/gone/sdk/amsp.js`;
    expect((await t.app.request(missing, asModuleScript(cookie))).status).toBe(404);
    expect((await t.app.request(`${SDK}/other.js`, asModuleScript(cookie))).status).toBe(404);
    const otherProject = `/api/projects/no-such/agents/${AGENT}/workbenches/demo/sdk/amsp.js`;
    expect((await t.app.request(otherProject, asModuleScript(cookie))).status).toBe(404);
  });
});

describe("the page SDK in a bundled server", () => {
  it("carries the browser build inside the bundle, with no node_modules to read it from", async () => {
    // Outside the checkout, as a data root's store or an app bundle is.
    const dir = await makeTempRoot();
    const outfile = path.join(dir, "bundle.mjs");
    const options = pushBundleOptions("entry.mjs", outfile);
    delete options.entryPoints;
    await compilePushBundle({
      ...options,
      stdin: {
        contents: [
          `import { pageSdkFile } from ${JSON.stringify(path.join(SERVER, "src", "workbenches", "page-sdk.ts"))};`,
          'import { createHash } from "node:crypto";',
          'const { body } = await pageSdkFile("amsp.js");',
          'console.log(createHash("sha256").update(body).digest("hex"));',
        ].join("\n"),
        resolveDir: SERVER,
        loader: "js",
      },
    });

    const code = await fs.readFile(outfile, "utf8");
    expect(code).not.toMatch(/(?:\bfrom|\bimport\(|\brequire\()\s*["']@prismshadow\/[^"']+["']/);
    const ran = execFileSync(process.execPath, [outfile], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
    expect(ran.trim()).toBe(sha256(await fs.readFile(BROWSER_BUILD)));
  }, 60_000);
});
