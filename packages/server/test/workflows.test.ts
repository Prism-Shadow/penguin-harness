/**
 * Workflows: an Agent's own plugin package booted as a module tree — TypeScript the server
 * checks and transpiles, interfaces compared with the version the workflow installed,
 * tabs it contributes, loaded by content, versioned on every successful load, restorable,
 * and never taken down by a broken edit.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir } from "@prismshadow/penguin-core";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import type { WorkflowInfo, WorkflowVersion } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-wf";
const AGENT = "default_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workflows`;
const HOST_KEY = "@prismshadow/penguin-server#WorkflowHost";
const MAIN_KEY = "@prismshadow/penguin-server#WorkflowMain";

const TAB = {
  id: "demo.board",
  key: "board",
  title: "Board",
  titleZh: "看板",
  renderer: { iframe: { src: "ui/index.html" } },
};

const MANIFEST = {
  name: "Workflow",
  requires: { host: { iface: HOST_KEY, from: "Host" } },
  provides: { main: MAIN_KEY },
  contributes: { "WebModule.sessionTabs": [TAB] },
  children: [],
};

function packageJson(modules: unknown[] = [MANIFEST], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "Demo",
    version: "1.0.0",
    type: "module",
    penguin: { modules },
    ...extra,
  });
}

function indexSource(greeting: string): string {
  return `import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workflow: {
      create({ use }) {
        const host = use.host;
        return {
          api: {
            main: {
              async handle(req) {
                if (req.path === "/open") {
                  // The SDK's verbs, scoped to this Project: another of its Agents, never a stranger's Session.
                  const agent = req.query["agent"];
                  // No argument at all is this Agent: the rendered types keep the parameter optional.
                  const opened = await (agent ? host.createSession({ agentId: agent }) : host.createSession()).catch((e: Error) => e.message);
                  const ran = await host.run(req.query["session"] ?? "", [{ text: "hi" }]).catch((e: Error) => e.message);
                  return { body: { opened, ran, agents: host.listAgents().map((a) => a.agentId) } };
                }
                if (req.path === "/page") {
                  const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "set-cookie": "x=1" };
                  return { headers, body: "<h1>proxied</h1>" };
                }
                if (req.path === "/upload") {
                  // Whatever was sent comes back as sent, with what the handler saw of the request.
                  const headers: Record<string, string> = {
                    "content-type": req.headers["content-type"] ?? "application/octet-stream",
                    "x-saw-cookie": String("cookie" in req.headers),
                    "x-json-body": JSON.stringify(req.body),
                  };
                  return { status: 201, headers, bytes: req.bytes ?? new Uint8Array() };
                }
                if (req.path === "/events") {
                  const headers: Record<string, string> = { "content-type": "text/event-stream" };
                  async function* events() {
                    yield "data: one\\n\\n";
                    await new Promise((r) => setTimeout(r, 400));
                    yield new TextEncoder().encode("data: two\\n\\n");
                  }
                  return { headers, stream: events() };
                }
                if (req.path === "/moved") {
                  const headers: Record<string, string> = { location: "page" };
                  return { status: 302, headers };
                }
                if (req.path === "/count" && req.method === "POST") {
                  const n = (((host.getState() ?? {}) as { count?: number }).count ?? 0) + 1;
                  await host.setState({ count: n });
                  return { body: { count: n } };
                }
                return { status: 200, body: { greeting: ${JSON.stringify(greeting)}, path: req.path, q: req.query } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkflowPackage;
`;
}

/** Rewrites the table the harness wrote into the folder: the workflow was written against an OLDER one. */
async function writtenAgainst(dir: string, edit: (table: IfaceTable) => void): Promise<void> {
  const file = path.join(dir, ".harness", "ifaces.json");
  const table = JSON.parse(await fs.readFile(file, "utf8")) as IfaceTable;
  edit(table);
  await fs.writeFile(file, JSON.stringify(table));
}

// Most of these run the TypeScript compiler, several times each: on a CI runner a single test
// can pass 5s, the default POSIX limit, without anything being wrong.
describe("workflows", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let ownerCookie: string;
  let dir: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, a.cookie);
    ownerCookie = a.cookie;
    const created = await owner.post("/api/projects", { projectId: PROJECT, name: "wf" });
    expect(created.status, await created.text()).toBe(201);
    dir = path.join(agentDir(t.root, PROJECT, AGENT), "workflows", "demo");
    await fs.mkdir(path.join(dir, "ui"), { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), packageJson());
    await fs.writeFile(path.join(dir, "index.ts"), indexSource("hello"));
    await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>demo v1</h1>");
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function list(): Promise<WorkflowInfo[]> {
    const res = await owner.get(BASE);
    expect(res.status).toBe(200);
    return ((await res.json()) as { workflows: WorkflowInfo[] }).workflows;
  }

  it("checks and transpiles the TypeScript, boots the tree, serves its UI and dispatches to its handler", async () => {
    const [wf] = await list();
    expect(wf).toMatchObject({ id: "demo", name: "Demo", version: "1.0.0", error: null });
    expect(wf!.uiRev).toMatch(/^[0-9a-f]{12}$/);
    // The tab is the contribution, its page path turned into the URL it is served from.
    expect(wf!.tabs).toEqual([
      { ...TAB, renderer: { iframe: { src: `${BASE}/demo/ui/index.html` } } },
    ]);
    // The emitted code lives in a dot-directory: no part of the revision or the versions.
    // Beside it, what the load came to — the Agent's only view of it is its own files.
    expect((await fs.readdir(path.join(dir, ".build"))).sort()).toEqual(
      [wf!.revision, "status.json"].sort(),
    );
    expect(JSON.parse(await fs.readFile(path.join(dir, ".build", "status.json"), "utf8"))).toEqual({
      ok: true,
      revision: wf!.revision,
      checkedAt: wf!.loadedAt,
      error: null,
      tabs: ["board"],
      hints: [],
    });
    // Its types came from this harness, not from a package: written once, then left alone.
    expect((await fs.readdir(path.join(dir, ".harness"))).sort()).toEqual([
      "README.md",
      "harness.json",
      "ifaces.json",
      "plugin.d.ts",
    ]);
    const types = await fs.readFile(path.join(dir, ".harness", "plugin.d.ts"), "utf8");
    expect(types).toContain("export interface WorkflowHost {");
    expect(types).toContain("export interface WorkflowPackage {");
    await expect(fs.stat(path.join(dir, "node_modules"))).rejects.toThrow();

    const ui = await owner.get(`${BASE}/demo/ui/index.html`);
    expect(ui.status).toBe(200);
    // No default document: a tab names its page.
    expect((await owner.get(`${BASE}/demo/ui/`)).status).toBe(404);
    expect(ui.headers.get("content-type")).toContain("text/html");
    expect(await ui.text()).toBe("<h1>demo v1</h1>");
    expect((await owner.get(`${BASE}/demo/ui/../package.json`)).status).toBe(404);
    expect((await owner.get(`${BASE}/demo/ui/nope.js`)).status).toBe(404);

    const res = await owner.get(`${BASE}/demo/api/greet?x=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ greeting: "hello", path: "/greet", q: { x: "1" } });

    // Host state persists on disk across a reload.
    expect(await (await owner.post(`${BASE}/demo/api/count`, {})).json()).toEqual({ count: 1 });
    expect((await owner.post(`${BASE}/demo/reload`)).status).toBe(200);
    expect(await (await owner.post(`${BASE}/demo/api/count`, {})).json()).toEqual({ count: 2 });
    expect(JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"))).toEqual({
      count: 2,
    });
  });

  it("does not treat its own state write as an edit: the revision holds and nothing is staged", async () => {
    const [before] = await list();
    // Writing state used to leave a `state.json.tmp` behind, which the watcher read as an
    // edit (recompiling the workflow and tearing down the tree that had just written it) and
    // the revision hash read as content.
    expect(await (await owner.post(`${BASE}/demo/api/count`, {})).json()).toEqual({ count: 1 });
    const [after] = await list();
    expect(after!.revision).toBe(before!.revision);
    expect(after!.loadedAt).toBe(before!.loadedAt);
    const left = (await fs.readdir(dir)).filter((n) => n.includes("tmp"));
    expect(left).toEqual([]);
  });

  it("a folder file that disappears mid-read is a change, not a failed request", async () => {
    // `walk` lists the files, then each is read: one that goes away in between (an editor's
    // scratch file, the Agent deleting one) used to reject the read and answer 500 although
    // the loaded instance was fine.
    await fs.writeFile(path.join(dir, "notes.md"), "gone in a moment");
    const [listed] = await list();
    expect(listed!.error).toBe(null);
    await fs.rm(path.join(dir, "notes.md"));
    const res = await owner.get(`${BASE}/demo/api/greet`);
    expect(res.status, await res.text()).toBe(200);
  });

  it("re-imports an edited folder, records every version and rolls back to any of them", async () => {
    const [v1] = await list();
    await fs.writeFile(path.join(dir, "index.ts"), indexSource("bonjour"));
    await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>demo v2</h1>");
    const reload = await owner.post(`${BASE}/demo/reload`);
    const v2 = ((await reload.json()) as { workflow: WorkflowInfo }).workflow;
    expect(v2.revision).not.toBe(v1!.revision);
    expect(v2.uiRev).not.toBe(v1!.uiRev);
    expect(
      (await (await owner.get(`${BASE}/demo/api/`)).json()) as { greeting: string },
    ).toMatchObject({
      greeting: "bonjour",
    });

    const history = (await (await owner.get(`${BASE}/demo/history`)).json()) as {
      versions: WorkflowVersion[];
    };
    expect(history.versions.map((v) => v.revision)).toEqual([v2.revision, v1!.revision]);
    expect(history.versions[1]!.files).toContain("ui/index.html");

    const back = await owner.post(`${BASE}/demo/rollback`, { revision: v1!.revision });
    expect(back.status).toBe(200);
    expect(((await back.json()) as { workflow: WorkflowInfo }).workflow.revision).toBe(
      v1!.revision,
    );
    expect(await (await owner.get(`${BASE}/demo/ui/index.html`)).text()).toBe("<h1>demo v1</h1>");
    // Only the serving revision keeps its emitted code.
    expect((await fs.readdir(path.join(dir, ".build"))).sort()).toEqual(
      [v1!.revision, "status.json"].sort(),
    );
    expect(
      (await (await owner.get(`${BASE}/demo/api/`)).json()) as { greeting: string },
    ).toMatchObject({
      greeting: "hello",
    });
    // The rolled-back revision is now the newest entry, once.
    const after = (await (await owner.get(`${BASE}/demo/history`)).json()) as {
      versions: WorkflowVersion[];
    };
    expect(after.versions.map((v) => v.revision)).toEqual([v1!.revision, v2.revision]);
    expect((await owner.post(`${BASE}/demo/rollback`, { revision: "000000000000" })).status).toBe(
      404,
    );
  });

  it("keeps the previous instance serving when an edit does not load, and names the problem", async () => {
    await list();
    await fs.writeFile(
      path.join(dir, "package.json"),
      packageJson([
        {
          ...MANIFEST,
          requires: { host: { iface: "@prismshadow/penguin-server#Workflows", from: "Host" } },
        },
      ]),
    );
    const res = await owner.post(`${BASE}/demo/reload`);
    const broken = ((await res.json()) as { workflow: WorkflowInfo }).workflow;
    // Named before anything runs: the host gave this workflow no types for that interface.
    expect(broken.error).toContain(
      "requires.host '@prismshadow/penguin-server#Workflows': not among the types this workflow was written against",
    );
    expect(await (await owner.get(`${BASE}/demo/api/`)).json()).toMatchObject({
      greeting: "hello",
    });
    expect(await (await owner.get(`${BASE}/demo/history`)).json()).toMatchObject({
      versions: [{ name: "Demo" }],
    });
  });

  async function reload(): Promise<WorkflowInfo> {
    const res = await owner.post(`${BASE}/demo/reload`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { workflow: WorkflowInfo }).workflow;
  }

  async function reloadError(): Promise<string> {
    const workflow = await reload();
    // Whatever went wrong, the instance that loaded keeps answering, with its tabs.
    expect(workflow.tabs).toHaveLength(1);
    expect(await (await owner.get(`${BASE}/demo/api/`)).json()).toMatchObject({
      greeting: "hello",
    });
    return workflow.error ?? "";
  }

  it("refuses source that does not type-check, with the compiler's file, line and reason", async () => {
    await list();
    await fs.writeFile(
      path.join(dir, "index.ts"),
      indexSource("hello")
        .replace("await host.setState({ count: n });", "await host.setStat({ count: n });")
        .replace("return { body: { count: n } };", 'return "text";'),
    );
    const error = await reloadError();
    expect(error).toMatch(
      /index\.ts:\d+:\d+ TS2551 Property 'setStat' does not exist on type 'WorkflowHost'/,
    );
    expect(error).toContain("TS2322");
    // The same words reach the Agent through its files.
    expect(
      JSON.parse(await fs.readFile(path.join(dir, ".build", "status.json"), "utf8")),
    ).toMatchObject({ ok: false, error });
    // Said once, by the author's own file; the server's copy of the same question is left out.
    expect(error).not.toContain("default export");
    expect(error.match(/TS2322/g)).toHaveLength(1);

    // A JSON body may be null: an optional `unknown` member stays `unknown` in the table.
    await fs.writeFile(
      path.join(dir, "index.ts"),
      indexSource("hello").replace("return { body: { count: n } };", "return { body: null };"),
    );
    expect((await reload()).error).toBeNull();

    // Untyped is refused too: `strict` leaves no implicit any to slip through.
    await fs.writeFile(
      path.join(dir, "index.ts"),
      indexSource("hello").replace(" satisfies WorkflowPackage", ""),
    );
    expect(await reloadError()).toContain("TS7031");
  });

  it("opens and runs Sessions the SDK's way, inside its own Project only", async () => {
    await list();
    const res = await owner.get(`${BASE}/demo/api/open?agent=nobody&session=not-a-session`);
    expect(await res.json()).toEqual({
      opened: "createSession: this Project has no Agent 'nobody'",
      ran: "run: this Project has no Session 'not-a-session'",
      agents: [AGENT],
    });
    const own = await (await owner.get(`${BASE}/demo/api/open`)).json();
    // Its own Agent passes the Project check and reaches the session runtime, which in this
    // fixture has no model key to open a Session with.
    expect(own).toMatchObject({ opened: expect.stringContaining("API key") });
  });

  it("notices an Agent's FIRST workflow, made with nothing but its file tools", async () => {
    // Another Agent of the Project, with no workflows/ folder when its list is first read.
    const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: "builder" });
    expect(made.status, await made.text()).toBe(201);
    const base = `/api/projects/${PROJECT}/agents/builder/workflows`;
    expect(((await (await owner.get(base)).json()) as { workflows: unknown[] }).workflows).toEqual(
      [],
    );

    const first = path.join(agentDir(t.root, PROJECT, "builder"), "workflows", "first");
    await fs.mkdir(path.join(first, "ui"), { recursive: true });
    await fs.writeFile(path.join(first, "package.json"), packageJson());
    await fs.writeFile(path.join(first, "index.ts"), indexSource("first"));
    await fs.writeFile(path.join(first, "ui", "index.html"), "<h1>first</h1>");

    // Nobody lists again: the server has to see the folder appear and load it on its own.
    const statusFile = path.join(first, ".build", "status.json");
    let status: { ok?: boolean } = {};
    for (let i = 0; i < 100 && status.ok === undefined; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = await fs.readFile(statusFile, "utf8").then(
        (text) => JSON.parse(text) as { ok: boolean },
        () => ({}),
      );
    }
    expect(status).toMatchObject({ ok: true, error: null, tabs: ["board"] });
  });

  it("refuses JavaScript", async () => {
    await list();
    await fs.rename(path.join(dir, "index.ts"), path.join(dir, "index.mjs"));
    expect(await reloadError()).toContain(
      "a workflow is written in TypeScript: rename index.mjs to index.ts",
    );
  });

  it("compares the types the workflow was written against with this platform's, both ways", async () => {
    await list();
    // requires: it was written when the host had a method this platform lacks.
    await writtenAgainst(dir, (t) => {
      t.ifaces[HOST_KEY]!.methods["removedSince"] = { params: [], returns: { void: true } };
    });
    let error = await reloadError();
    expect(error).toContain(`Workflow: requires.host '${HOST_KEY}'`);
    expect(error).toContain("removedSince");

    // provides: the handler it was written against answers with something else.
    await writtenAgainst(dir, (t) => {
      delete t.ifaces[HOST_KEY]!.methods["removedSince"];
      t.ifaces[MAIN_KEY]!.methods["handle"]!.returns = { promise: { data: "string" } };
    });
    error = await reloadError();
    expect(error).toContain(`Workflow: provides.main '${MAIN_KEY}'`);
    expect(error).toContain("TS2322");

    // An addition on the platform's side breaks nothing.
    await fs.rm(path.join(dir, ".harness"), { recursive: true });
    expect((await reload()).error).toBeNull();
    await writtenAgainst(dir, (t) => {
      delete t.ifaces[HOST_KEY]!.methods["log"];
    });
    expect((await reload()).error).toBeNull();

    // A table that cannot be read is a problem, never a pass against the platform's own;
    // deleting the directory is how a workflow takes this harness's types afresh.
    await fs.writeFile(path.join(dir, ".harness", "ifaces.json"), "{");
    expect(await reloadError()).toContain(".harness/ifaces.json cannot be read");
    await fs.rm(path.join(dir, ".harness"), { recursive: true });
    expect((await reload()).error).toBeNull();
  });

  it("takes tabs from contributions: several per workflow, pages under ui/, open slots only", async () => {
    await list();
    const stats = {
      ...TAB,
      id: "demo.stats",
      key: "stats",
      title: "Stats",
      renderer: { iframe: { src: "ui/stats.html" } },
    };
    const write = (contributes: Record<string, unknown[]>) =>
      fs.writeFile(path.join(dir, "package.json"), packageJson([{ ...MANIFEST, contributes }]));

    await write({ "WebModule.sessionTabs": [TAB, stats] });
    const two = await reload();
    expect(two.error).toBeNull();
    expect(two.tabs.map((tab) => tab.key)).toEqual(["board", "stats"]);

    await write({
      "WebModule.sessionTabs": [{ ...TAB, renderer: { iframe: { src: "index.ts" } } }],
    });
    expect((await reload()).error).toContain("renderer.iframe.src must be a file under ui/");
    await write({
      "WebModule.pages": [
        {
          id: "demo.page",
          key: "p",
          path: "/p",
          nav: "main",
          admin: false,
          renderer: { builtin: "x" },
        },
      ],
    });
    expect((await reload()).error).toContain("WebModule.pages");
    await write({ "WebModule.sessionTabs": [{ ...TAB, title: 7 }] });
    expect((await reload()).error).toContain("module tree rejected");
    // A workflow with no contribution is server-side only — and since this one has pages, the
    // load says that nothing shows them, with the entry to add, in the API and in the status
    // file alike (the Agent that wrote it may have only the file).
    await write({});
    const bare = (await reload()) as { error: string | null; tabs: unknown[]; hints: string[] };
    expect(bare).toMatchObject({ error: null, tabs: [] });
    expect(bare.hints).toHaveLength(1);
    expect(bare.hints[0]).toContain('"WebModule.sessionTabs"');
    expect(bare.hints[0]).toContain("ui/index.html");
    const status = JSON.parse(await fs.readFile(path.join(dir, ".build", "status.json"), "utf8"));
    expect(status).toMatchObject({ ok: true, tabs: [], hints: bare.hints });
    // The harness describes its own contract beside the types it wrote.
    expect(await fs.readFile(path.join(dir, ".harness", "README.md"), "utf8")).toContain(
      "A page shows only if a tab is contributed for it",
    );
    // With the tab back there is nothing to hint at.
    await write({ "WebModule.sessionTabs": [TAB] });
    expect(((await reload()) as { hints: string[] }).hints).toEqual([]);
  });

  it("hands a handler any body and sends back any content type; JSON stays the default", async () => {
    await list();
    // An upload: not JSON, so the handler gets the bytes as sent — and never the app's cookie.
    const sent = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const upload = await t.app.request(`${BASE}/demo/api/upload`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/x-demo" },
      body: sent,
    });
    expect(upload.status).toBe(201);
    expect(upload.headers.get("content-type")).toBe("application/x-demo");
    expect(upload.headers.get("x-saw-cookie")).toBe("false");
    expect(upload.headers.get("x-json-body")).toBe("null");
    expect(new Uint8Array(await upload.arrayBuffer())).toEqual(sent);
    // A form is what another site can make a browser send with the cookie attached, so on this
    // mount the browser's own account of the request's origin is the defense: a form from one
    // of the app's pages passes, the same form from anywhere else does not.
    const form = (site: string) =>
      t.app.request(`${BASE}/demo/api/upload`, {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": site,
        },
        body: "a=1",
      });
    expect((await form("same-origin")).status).toBe(201);
    const forged = await form("cross-site");
    expect(forged.status).toBe(403);
    expect(((await forged.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_write",
    );
    // Everywhere else a form is still refused outright.
    const elsewhere = await t.app.request(`${BASE}/demo/reload`, {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "text/plain",
        "sec-fetch-site": "same-origin",
      },
      body: "x",
    });
    expect(elsewhere.status).toBe(415);
    // A page: the handler names the content type, the string goes out as written, and a
    // workflow does not get to set the app's cookies.
    const page = await owner.get(`${BASE}/demo/api/page`);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("set-cookie")).toBeNull();
    expect(await page.text()).toBe("<h1>proxied</h1>");
    // A stream: the first chunk is in the client's hands while the handler is still producing
    // the second — nothing is held back until the end.
    const events = await owner.get(`${BASE}/demo/api/events`);
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const reader = events.body!.getReader();
    const startedAt = Date.now();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: one\n\n");
    expect(Date.now() - startedAt).toBeLessThan(300);
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("data: two\n\n");
    expect((await reader.read()).done).toBe(true);
    // A redirect, relative to the api mount.
    const moved = await owner.get(`${BASE}/demo/api/moved`);
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("page");
    // And what every existing workflow does is unchanged: JSON in, JSON out.
    const json = await owner.post(`${BASE}/demo/api/count`, {});
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(await json.json()).toEqual({ count: 1 });
  });

  it("removes the folder and its recorded versions on request", async () => {
    await list();
    expect((await owner.delete(`${BASE}/demo`)).status).toBe(204);
    expect(await list()).toEqual([]);
    await expect(fs.stat(dir)).rejects.toThrow();
    expect((await owner.get(`${BASE}/demo/api/`)).status).toBe(404);
    expect((await owner.delete(`${BASE}/demo`)).status).toBe(404);
    const history = (await (await owner.get(`${BASE}/demo/history`)).json()) as {
      versions: WorkflowVersion[];
    };
    expect(history.versions).toEqual([]);
  });

  it("is scoped to the Project's users", async () => {
    const other = apiClient(t.app, (await provisionUser(t.app, "other")).cookie);
    expect((await other.get(BASE)).status).toBe(404);
    expect((await other.get(`${BASE}/demo/ui/index.html`)).status).toBe(404);
    expect((await other.delete(`${BASE}/demo`)).status).toBe(404);
    expect((await owner.get(`${BASE}/demo/ui/index.html`)).status).toBe(200);
    expect((await owner.get(`${BASE}/nope/ui/index.html`)).status).toBe(404);
    expect((await owner.get(`${BASE}/nope/api/`)).status).toBe(404);
  });
});
