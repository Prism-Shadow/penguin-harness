/**
 * Workflows: an Agent's own extension package booted as a module tree — loaded by content,
 * served as a page, versioned on every successful load, restorable, and never taken down
 * by a broken edit.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir } from "@prismshadow/penguin-core";
import type { WorkflowInfo, WorkflowVersion } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-wf";
const AGENT = "default_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workflows`;

const MANIFEST = {
  name: "Workflow",
  requires: { host: { iface: "@prismshadow/penguin-server#WorkflowHost", from: "Host" } },
  provides: { main: "@prismshadow/penguin-server#WorkflowMain" },
  contributes: {},
  children: [],
};

function indexSource(greeting: string): string {
  return `export default {
  modules: {
    Workflow: {
      create({ use }) {
        const host = use.host;
        return {
          api: {
            main: {
              async handle(req) {
                if (req.path === "/count" && req.method === "POST") {
                  const n = ((host.getState() ?? {}).count ?? 0) + 1;
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
};
`;
}

describe("workflows", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let dir: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, a.cookie);
    const created = await owner.post("/api/projects", { projectId: PROJECT, name: "wf" });
    expect(created.status, await created.text()).toBe(201);
    dir = path.join(agentDir(t.root, PROJECT, AGENT), "workflows", "demo");
    await fs.mkdir(path.join(dir, "ui"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "Demo", version: "1.0.0", penguin: { modules: [MANIFEST] } }),
    );
    await fs.writeFile(path.join(dir, "index.mjs"), indexSource("hello"));
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

  it("loads the folder as a module tree, serves its UI and dispatches to its handler", async () => {
    const [wf] = await list();
    expect(wf).toMatchObject({ id: "demo", name: "Demo", version: "1.0.0", error: null });
    expect(wf!.uiRev).toMatch(/^[0-9a-f]{12}$/);

    const ui = await owner.get(`${BASE}/demo/ui/`);
    expect(ui.status).toBe(200);
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

  it("re-imports an edited folder, records every version and rolls back to any of them", async () => {
    const [v1] = await list();
    await fs.writeFile(path.join(dir, "index.mjs"), indexSource("bonjour"));
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
    expect(await (await owner.get(`${BASE}/demo/ui/`)).text()).toBe("<h1>demo v1</h1>");
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
      JSON.stringify({
        name: "Demo",
        penguin: {
          modules: [
            {
              ...MANIFEST,
              requires: {
                host: { iface: "@prismshadow/penguin-server#Workflows", from: "Host" },
              },
            },
          ],
        },
      }),
    );
    const res = await owner.post(`${BASE}/demo/reload`);
    const broken = ((await res.json()) as { workflow: WorkflowInfo }).workflow;
    expect(broken.error).toContain("module tree rejected");
    expect(await (await owner.get(`${BASE}/demo/api/`)).json()).toMatchObject({
      greeting: "hello",
    });
    expect(await (await owner.get(`${BASE}/demo/history`)).json()).toMatchObject({
      versions: [{ name: "Demo" }],
    });
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
    expect((await other.get(`${BASE}/demo/ui/`)).status).toBe(404);
    expect((await other.delete(`${BASE}/demo`)).status).toBe(404);
    expect((await owner.get(`${BASE}/demo/ui/`)).status).toBe(200);
    expect((await owner.get(`${BASE}/nope/ui/`)).status).toBe(404);
    expect((await owner.get(`${BASE}/nope/api/`)).status).toBe(404);
  });
});
