/**
 * Workbench pages written in TSX, checked and emitted by the server that serves them.
 *
 * - A valid page loads: the `.js` it compiled to is served where the HTML asks for it, and the
 *   HTML comes with the page runtime's stylesheet and import map, relative to its folder.
 * - A page whose props no longer fit the runtime's types fails the load by file, line and
 *   column, and the pages that were serving keep serving — even on a reload of their own
 *   revision.
 * - A workbench without TSX is untouched: its HTML comes back byte for byte.
 * - An import of a package the runtime does not provide, or of code outside `ui/`, is refused
 *   by name.
 * - Without a runtime, a TSX workbench fails saying where it looked, and a plain one loads.
 *
 * Loads go through `reload` rather than the listing, so no folder watcher reloads beside them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentStateDir } from "@prismshadow/penguin-core";
import type { WorkbenchInfo } from "../src/api/types.js";
import { webDistWithUiRuntime } from "./fixtures/workbench-runtime.js";
import { apiClient, createTestApp, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-ui";
const AGENT = "default_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;

const MANIFEST = {
  name: "Workbench",
  requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
  provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
  contributes: {
    "WebModule.sessionTabs": [
      {
        id: "page.main",
        key: "main",
        title: "Page",
        renderer: { iframe: { src: "ui/index.html" } },
      },
    ],
  },
  children: [],
};

// The handler needs no DOM, and its declarations are the costliest part of a program.
const INDEX = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create() {
        return { api: { main: { async handle() { return { body: null }; } } } };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="app.js"></script>
  </body>
</html>
`;

const PAGE = `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@prismshadow/penguin-ui";

function App() {
  const [count, setCount] = useState(0);
  return <Button variant="primary" onClick={() => setCount(count + 1)}>Clicked {count}</Button>;
}

createRoot(document.getElementById("root")!).render(<App />);
`;

/** What a compiled page's `<head>` opens with, for a page `up` away from `sdk/`. */
const runtimeTags = (up: string) =>
  `<link rel="stylesheet" href="${up}sdk/ui/penguin-ui.css" data-penguin-ui>` +
  `<script type="importmap">{"imports":{` +
  `"@prismshadow/penguin-ui":"${up}sdk/ui/penguin-ui.js",` +
  `"react":"${up}sdk/ui/react.js",` +
  `"react/jsx-runtime":"${up}sdk/ui/react-jsx-runtime.js",` +
  `"react-dom":"${up}sdk/ui/react-dom.js",` +
  `"react-dom/client":"${up}sdk/ui/react-dom-client.js"}}</script>`;

async function writeWorkbench(root: string, id: string, files: Record<string, string>) {
  const dir = path.join(agentStateDir(root, PROJECT, AGENT), "workbenches", id);
  const all = {
    "package.json": JSON.stringify({ name: id, type: "module", penguin: { modules: [MANIFEST] } }),
    "index.ts": INDEX,
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
  return dir;
}

async function ownerOf(t: TestApp) {
  const a = await provisionUser(t.app, "owner");
  const owner = apiClient(t.app, a.cookie);
  const created = await owner.post("/api/projects", { projectId: PROJECT, name: "ui" });
  expect(created.status, await created.text()).toBe(201);
  return owner;
}

async function reload(owner: ReturnType<typeof apiClient>, id: string): Promise<WorkbenchInfo> {
  const res = await owner.post(`${BASE}/${id}/reload`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { workbench: WorkbenchInfo }).workbench;
}

// Every load runs the compiler, a page's program with the DOM's declarations.
describe("TSX pages", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let web: string;
  let dir: string;
  let loaded: WorkbenchInfo;

  beforeAll(async () => {
    web = await webDistWithUiRuntime(await makeTempRoot());
    t = await createTestApp({ config: { webDist: web } });
    owner = await ownerOf(t);
    dir = await writeWorkbench(t.root, "board", {
      "ui/index.html": HTML,
      "ui/more/page.html": HTML,
      "ui/app.tsx": PAGE,
    });
    loaded = await reload(owner, "board");
  }, 30_000);
  afterAll(async () => {
    await t.cleanup();
  });

  it("serves a valid page's emitted code, and its HTML with the runtime's stylesheet and import map", async () => {
    expect(loaded.error).toBeNull();
    const app = await owner.get(`${BASE}/board/ui/app.js`);
    expect(app.status).toBe(200);
    expect(app.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const emitted = await fs.readFile(
      path.join(dir, ".build", loaded.revision, "ui", "app.js"),
      "utf8",
    );
    expect(await app.text()).toBe(emitted);
    expect(emitted).toContain('from "react/jsx-runtime"');

    const index = await owner.get(`${BASE}/board/ui/index.html`);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await index.text()).toBe(HTML.replace("<head>", `<head>${runtimeTags("../")}`));
    const nested = await owner.get(`${BASE}/board/ui/more/page.html`);
    expect(await nested.text()).toBe(HTML.replace("<head>", `<head>${runtimeTags("../../")}`));

    // The runtime's types beside the handler's, which a new workbench still got first.
    await fs.access(path.join(dir, ".harness", "plugin.d.ts"));
    await fs.access(
      path.join(dir, ".harness", "ui", "node_modules", "@prismshadow", "penguin-ui", "index.d.ts"),
    );
  });

  it("fails a page whose props no longer fit, and keeps serving the pages that were", async () => {
    const before = await (await owner.get(`${BASE}/board/ui/app.js`)).text();
    // The server's runtime changed under a page that fit the old one: the same revision reloads.
    const types = path.join(
      web,
      "workbench-runtime",
      "types",
      "node_modules",
      "@prismshadow",
      "penguin-ui",
      "index.d.ts",
    );
    const original = await fs.readFile(types, "utf8");
    await fs.writeFile(types, original.replace('"primary" | "secondary"', '"secondary"'));
    try {
      const failed = await reload(owner, "board");
      expect(failed.revision).toBe(loaded.revision);
      expect(failed.error).toMatch(/^ui\/app\.tsx:7:18 TS2322 /);
      const status = JSON.parse(
        await fs.readFile(path.join(dir, ".build", "status.json"), "utf8"),
      ) as { ok: boolean; error: string };
      expect(status).toMatchObject({ ok: false, error: failed.error });
      const app = await owner.get(`${BASE}/board/ui/app.js`);
      expect(app.status).toBe(200);
      expect(await app.text()).toBe(before);
    } finally {
      await fs.writeFile(types, original);
    }
  });

  it("serves a workbench without TSX exactly as written", async () => {
    const plain = await writeWorkbench(t.root, "plain", {
      "ui/index.html": HTML,
      "ui/app.js": 'document.body.append("plain");\n',
    });
    const info = await reload(owner, "plain");
    expect(info.error).toBeNull();
    const index = await owner.get(`${BASE}/plain/ui/index.html`);
    expect(Buffer.from(await index.arrayBuffer())).toEqual(
      await fs.readFile(path.join(plain, "ui", "index.html")),
    );
    await expect(fs.access(path.join(plain, ".harness", "ui"))).rejects.toThrow();
    await expect(fs.access(path.join(plain, ".build", info.revision, "ui"))).rejects.toThrow();
  });

  it("refuses by name a package the runtime does not provide, and code outside ui/", async () => {
    await writeWorkbench(t.root, "imports", {
      "ui/index.html": HTML,
      "ui/app.tsx":
        'import _ from "lodash";\nimport { shared } from "../shared.js";\n\nconsole.log(_, shared);\n',
      "shared.ts": "export const shared = 1;\n",
    });
    const { error } = await reload(owner, "imports");
    expect(error).toContain(
      "ui/app.tsx:1:15 imports 'lodash': a page imports files under ui/ by a relative path, and of packages only what this server provides: @prismshadow/penguin-ui, react, react/jsx-runtime, react-dom, react-dom/client",
    );
    expect(error).toContain("ui/app.tsx:2:24 imports '../shared.js': it is outside ui/");
  });
});

describe("TSX pages on a server without the page runtime", { timeout: 30_000 }, () => {
  let t: TestApp;

  afterAll(async () => {
    await t.cleanup();
  });

  it("fails a TSX workbench saying where the runtime was looked for, and loads a plain one", async () => {
    // The test configuration's Web App directory does not exist.
    t = await createTestApp();
    const owner = await ownerOf(t);
    await writeWorkbench(t.root, "board", { "ui/index.html": HTML, "ui/app.tsx": PAGE });
    await writeWorkbench(t.root, "plain", { "ui/index.html": HTML, "ui/app.js": "" });
    const { error } = await reload(owner, "board");
    expect(error).toContain("ui/ has TSX pages, but this server has no page runtime");
    expect(error).toContain(path.join(t.deps.config.webDist, "workbench-runtime", "manifest.json"));
    expect((await reload(owner, "plain")).error).toBeNull();
  });
});
