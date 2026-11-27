/**
 * Workbenches: an Agent's own plugin package booted as a module tree.
 *
 * A loaded workbench:
 * - Its TypeScript is checked and transpiled into a dot-directory beside a status file the
 *   Agent can read, its types written once from this harness; the tree boots, serves its UI
 *   under ui/ (no default document, nothing outside it) and dispatches to its handler, and its
 *   state persists on disk across a reload.
 * - Its own state write is not an edit: the revision holds and nothing is left staged.
 * - It has three folders of its own — data and cache beside the Agent State, state at a short
 *   path under the data root's `run/` — made when asked for, which its handler reads and writes
 *   with Node's own `fs` (typed for it): what one side writes the other reads, and neither write
 *   reloads it. It listens on a local socket in its state folder, and a socket path past the
 *   103 bytes a Unix socket path holds is refused naming the limit.
 * - An Agent named `aux` and a workbench named `report.v2`, made before such names were refused,
 *   still open; a new Agent under a name Windows reserves is refused, and so is a new Project
 *   named `projects`, the data root's folder of Projects (its other folders' names are free).
 * - With a configured model credential, it opens and runs Sessions the SDK's way, inside
 *   its own Project only, with allow-all: nobody is there to answer an ask. Its Sessions
 *   are archived with workbench provenance, including before their first run after a restart.
 *   The Project's system Agent is neither listed nor opened: it runs no Sessions.
 * - A Session that only talks can select its own model and deny-all: that model's tool call is denied
 *   and the model reads the denial, while one opened without the option still runs its calls;
 *   a mode that would wait for a person is refused by name.
 * - The default Agent serves its preset alongside an authored workbench. Its history only
 *   accepts revisions belonging to the requested workbench.
 * - Agent counts include installed workbenches and follow removal without a compiler load.
 * - A handler takes any body (a form only from the app's own pages) and sends back any
 *   content type, a stream as it is produced and a redirect relative to its mount, never the
 *   app's cookies; JSON stays the default.
 * - It is scoped to the Project's users.
 * - An Agent's first workbench, made with nothing but file tools, is noticed without a list.
 * - A workbench written in JavaScript is refused with the rename it needs.
 *
 * An edited workbench:
 * - A file that disappears mid-read is a change, not a failed request.
 * - Concurrent first reads share the same loaded instance rather than replacing it for each reader.
 * - Listed by id, one workbench loads alone and the Agent's others are not compiled; an unknown
 *   id lists none.
 * - An edited folder is re-imported and committed once per loaded revision to the Agent State
 *   repository, made beside agent_state/ at the first load; a rollback restores a version's
 *   files exactly, keeps the state, and is itself the newest version.
 * - A repository the server cannot read never stops a load: the version is not recorded and
 *   the history answers an error the page can retry.
 * - A file under a name git refuses never stops a load either: it is named in the log and stays
 *   out of the versions.
 * - An unknown required interface leaves the previous instance serving and names the problem.
 * - A source type error reports the file, line and reason, without duplicate diagnostics.
 * - A JSON response body may be null.
 * - Untyped handler parameters are refused and the previous instance keeps serving.
 * - A host method removed since authoring is refused and the previous instance keeps serving.
 * - An incompatible provided handler is refused and the previous instance keeps serving.
 * - Adding a host method since authoring does not break a workbench.
 * - An unreadable type table is refused; removing it installs fresh types and recovers.
 * - Several contributed tabs are exposed in order.
 * - A tab outside ui/, a closed contribution slot and a malformed tab are each refused.
 * - Pages with no tab get a hint in the API and status file; adding a tab clears it.
 * - Its folders are at the agent level unless it names another. Installed from a plugin, it also
 *   has a server and a machine level, the same for every copy of the app, and removing one copy
 *   leaves them; made in place, a shared level is refused naming the agent level.
 * - Removing a workbench removes its folder, its data, cache and state folders, and its versions
 *   are no longer listed; another workbench's data stays.
 * - A legacy Workflow package loads through the new route after one-time conversion, with its state intact.
 *
 * With an engine a plugin contributes to `AgentStateHistoryModule.engines`:
 * - A large workbench's load is written by it, and a restore read through it; the restore a
 *   member asked for is authored under their display name.
 *
 * Every load runs the TypeScript compiler, so the loaded-once group shares one app and one
 * compile; each editing scenario gets an Agent of its own within the editing group's one app.
 * Keep independent edits in separate cases: six or seven compiler runs under one deadline
 * raced the coverage runner even though each individual operation completed normally.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  agentDir,
  agentStateDir,
  createAgent,
  runDir,
  serverAppDir,
  sharedWorkbenchDirs,
  workbenchStateDir,
  type PluginTables,
} from "@prismshadow/penguin-core";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable, ModuleDef } from "@prismshadow/penguin-core/kernel";
import type {
  WorkbenchInfo,
  WorkbenchVersion,
  SessionResponse,
  SessionsResponse,
  ArchivedSessionsResponse,
  AgentsResponse,
} from "../src/api/types.js";
import nodeFs from "node:fs";
import git from "isomorphic-git";
import type { AgentStateEngine, AgentStateEngineSource } from "@prismshadow/penguin-core/plugin";
import { PluginHost } from "../src/plugin/host.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  restartTestApp,
  waitFor,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { gitEngineForTests } from "./helpers/agent-state-git-engine.js";

/** The engine every default test app records versions with (see helpers.ts). */
const liveEngine = await gitEngineForTests();
import { MOCK_MODEL_ID, requestText, startMockLLM } from "./live-session.js";

const PROJECT = "owner-wf";
const AGENT = "default_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;
const HOST_KEY = "@prismshadow/penguin-server#WorkbenchHost";
const MAIN_KEY = "@prismshadow/penguin-server#WorkbenchMain";

const TAB = {
  id: "demo.board",
  key: "board",
  title: "Board",
  titleZh: "看板",
  renderer: { iframe: { src: "ui/index.html" } },
};

const MANIFEST = {
  name: "Workbench",
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
  // These handlers only use ES2022 APIs and Node's own modules, which the server types for
  // every workbench. Loading the DOM declarations on every fixture compilation adds work
  // without exercising another part of the workbench contract.
  return `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        let releaseEvents: (() => void) | undefined;
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
                if (req.path === "/talk") {
                  // The mode is whatever the page sent, cast past its type as plain JavaScript could.
                  const mode = req.query["mode"];
                  const modelId = req.query["model"];
                  const opened = await host
                    .createSession({
                      ...(mode === undefined ? {} : { approvalMode: mode as "deny-all" }),
                      ...(modelId ? { model: { provider: "custom", modelId } } : {}),
                    })
                    .catch((e: Error) => e.message);
                  if (typeof opened !== "string") {
                    await host.run(opened.sessionId, [{ text: "read the probe: " + (mode ?? "default") }]);
                  }
                  return { body: { opened } };
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
                  const released = new Promise<void>((resolve) => { releaseEvents = resolve; });
                  async function* events() {
                    yield "data: one\\n\\n";
                    await released;
                    yield Uint8Array.from("data: two\\n\\n", (char) => char.charCodeAt(0));
                  }
                  return { headers, stream: events() };
                }
                if (req.path === "/release-events" && req.method === "POST") {
                  releaseEvents?.();
                  return { body: null };
                }
                if (req.path === "/moved") {
                  const headers: Record<string, string> = { location: "page" };
                  return { status: 302, headers };
                }
                if (req.path === "/files" && req.method === "POST") {
                  // The page saves a document the Agent edits with its own file tools: Node's
                  // own fs on the workbench's data folder, behind a route of its own.
                  const paths = host.dataPaths();
                  const at = path.join(paths.dataDir, "decks", "a.json");
                  await mkdir(path.dirname(at), { recursive: true });
                  await writeFile(at, JSON.stringify(req.body));
                  return { body: { at, size: (await stat(at)).size, paths } };
                }
                if (req.path === "/files") {
                  const at = path.join(host.dataPaths().dataDir, "notes", "agent.md");
                  return { body: { notes: await readFile(at, "utf8").catch(() => null) } };
                }
                if (req.path === "/levels") {
                  // Every level this copy of the app has, and why a level it has none of is refused.
                  const ask = (level: "agent" | "server" | "machine") => {
                    try {
                      return host.dataPaths(level);
                    } catch (e) {
                      return (e as Error).message;
                    }
                  };
                  return { body: { default: host.dataPaths(), agent: ask("agent"), server: ask("server"), machine: ask("machine") } };
                }
                if (req.path === "/socket") {
                  // A local socket in the state folder: listen, connect, and say what came back.
                  const level = req.query["level"] as "agent" | "server" | undefined;
                  const at = host.socketPath("t.sock", level);
                  let tooLong: string | null = null;
                  try {
                    host.socketPath("x".repeat(120));
                  } catch (e) {
                    tooLong = (e as Error).message;
                  }
                  const server = net.createServer((socket) => socket.end("pong"));
                  await new Promise<void>((resolve) => server.listen(at, resolve));
                  const reply = await new Promise<string>((resolve) => {
                    let text = "";
                    net.connect(at).on("data", (chunk) => (text += chunk.toString())).on("end", () => resolve(text));
                  });
                  await new Promise<void>((resolve) => server.close(() => resolve()));
                  return { body: { at, reply, tooLong } };
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
} satisfies WorkbenchPackage;
`;
}

/** Rewrites the table the harness wrote into the folder: the workbench was written against an OLDER one. */
async function writtenAgainst(dir: string, edit: (table: IfaceTable) => void): Promise<void> {
  const file = path.join(dir, ".harness", "ifaces.json");
  const table = JSON.parse(await fs.readFile(file, "utf8")) as IfaceTable;
  edit(table);
  await fs.writeFile(file, JSON.stringify(table));
}

/** Writes the demo workbench into `dir`: its manifest, its handler, its one page and its PNG icon. */
async function writeDemo(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(path.join(dir, "index.ts"), indexSource("hello"));
  await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>demo v1</h1>");
  await fs.writeFile(path.join(dir, "package.json"), packageJsonWithPenguinIcon());
}

/** The demo's package.json (no icon of its own; the manifest falls back to the penguin SVG). */
function packageJsonWithPenguinIcon(): string {
  return JSON.stringify({
    name: "Demo",
    version: "1.0.0",
    type: "module",
    penguin: { modules: [MANIFEST] },
  });
}

/** An app with the owner's Project and the demo workbench written into its default Agent. */
async function workbenchApp() {
  const t = await createTestApp();
  const a = await provisionUser(t.app, "owner");
  const owner = apiClient(t.app, a.cookie);
  const created = await owner.post("/api/projects", { projectId: PROJECT, name: "wf" });
  expect(created.status, await created.text()).toBe(201);
  const dir = path.join(agentStateDir(t.root, PROJECT, AGENT), "workbenches", "demo");
  await writeDemo(dir);
  return { t, owner, ownerCookie: a.cookie, dir };
}

async function listOf(owner: ReturnType<typeof apiClient>, base = BASE): Promise<WorkbenchInfo[]> {
  const res = await owner.get(base);
  expect(res.status).toBe(200);
  return ((await res.json()) as { workbenches: WorkbenchInfo[] }).workbenches;
}

/** Read the demo by its installed id; the default Agent also owns its preset workbenches. */
async function demoOf(owner: ReturnType<typeof apiClient>): Promise<WorkbenchInfo> {
  const [demo] = await listOf(owner, `${BASE}?id=demo`);
  expect(demo?.id).toBe("demo");
  return demo!;
}

// Most of these run the TypeScript compiler, several times each: on a CI runner a single test
// can pass 5s, the default POSIX limit, without anything being wrong.
describe("a loaded workbench", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let ownerCookie: string;
  let dir: string;
  /** The demo as its one load left it. */
  let wf: WorkbenchInfo;

  // The shared fixture performs the first real compiler load: use the integration budget.
  beforeAll(async () => {
    ({ t, owner, ownerCookie, dir } = await workbenchApp());
    wf = await demoOf(owner);
  }, 30_000);
  afterAll(async () => {
    await t.cleanup();
  });

  /** The count after one more POST: the handler's state as it now stands. */
  const count = async (): Promise<number> =>
    ((await (await owner.post(`${BASE}/demo/api/count`, {})).json()) as { count: number }).count;

  it("checks and transpiles the TypeScript, boots the tree, serves its UI and dispatches to its handler", async () => {
    expect(wf).toMatchObject({ id: "demo", name: "Demo", version: "1.0.0", error: null });
    expect(wf.uiRev).toMatch(/^[0-9a-f]{12}$/);
    // The tab is the contribution, its page path turned into the URL it is served from.
    expect(wf.tabs).toEqual([
      {
        ...TAB,
        renderer: { iframe: { src: `${BASE}/demo/ui/index.html` } },
      },
    ]);
    // The emitted code lives in a dot-directory: no part of the revision or the versions.
    // Beside it, what the load came to — the Agent's only view of it is its own files.
    expect((await fs.readdir(path.join(dir, ".build"))).sort()).toEqual(
      [wf.revision, "status.json"].sort(),
    );
    expect(JSON.parse(await fs.readFile(path.join(dir, ".build", "status.json"), "utf8"))).toEqual({
      ok: true,
      revision: wf.revision,
      checkedAt: wf.loadedAt,
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
    expect(types).toContain("export interface WorkbenchHost {");
    expect(types).toContain("export interface WorkbenchPackage {");
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
    const before = await count();
    expect((await owner.post(`${BASE}/demo/reload`)).status).toBe(200);
    expect(await count()).toBe(before + 1);
    expect(JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"))).toEqual({
      count: before + 1,
    });
  });

  it("lists both workbenches and scopes each history and rollback to its installed id", async () => {
    const installed = await listOf(owner);
    const preset = installed.find((workbench) => workbench.id === "benchmark");
    expect(preset).toMatchObject({ error: null });
    expect(installed.find((workbench) => workbench.id === "demo")).toMatchObject({
      revision: wf.revision,
      error: null,
    });
    for (const workbench of [wf, preset!]) {
      const history = await owner.get(`${BASE}/${workbench.id}/history`);
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject({ versions: [{ revision: workbench.revision }] });
    }
    const otherRevision = await owner.post(`${BASE}/demo/rollback`, { revision: preset!.revision });
    expect(otherRevision.status).toBe(404);
    expect((await demoOf(owner)).revision).toBe(wf.revision);
  });

  it("does not treat its own state write as an edit: the revision holds and nothing is staged", async () => {
    const before = await demoOf(owner);
    // Writing state used to leave a `state.json.tmp` behind, which the watcher read as an
    // edit (recompiling the workbench and tearing down the tree that had just written it) and
    // the revision hash read as content.
    await count();
    const after = await demoOf(owner);
    expect(after.revision).toBe(before.revision);
    expect(after.loadedAt).toBe(before.loadedAt);
    const left = (await fs.readdir(dir)).filter((n) => n.includes("tmp"));
    expect(left).toEqual([]);
  });

  it("has three folders of its own, read and written with Node's fs: the Agent reads what the handler wrote, and neither write is an edit", async () => {
    const before = await demoOf(owner);
    const agent = agentDir(t.root, PROJECT, AGENT);
    const expected = {
      dataDir: path.join(agent, "app", "data", "demo"),
      cacheDir: path.join(agent, "app", "cache", "demo"),
      stateDir: workbenchStateDir(t.root, PROJECT, AGENT, "demo"),
    };

    const saved = await owner.post(`${BASE}/demo/api/files`, { title: "A" });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const { at, size, paths } = (await saved.json()) as {
      at: string;
      size: number;
      paths: typeof expected;
    };
    expect(paths).toEqual(expected);
    for (const dir of Object.values(paths)) expect((await fs.stat(dir)).isDirectory()).toBe(true);
    // The state folder sits at a short path of its own, beside no Agent folder.
    expect(paths.stateDir.startsWith(path.join(t.root, "run") + path.sep)).toBe(true);
    // The path the handler names is where the Agent finds its write.
    expect(at).toBe(path.join(expected.dataDir, "decks", "a.json"));
    expect(size).toBe(13);
    expect(await fs.readFile(at, "utf8")).toBe('{"title":"A"}');

    // The Agent writes a second file with its own file tools; the handler reads it.
    await fs.mkdir(path.join(expected.dataDir, "notes"), { recursive: true });
    await fs.writeFile(path.join(expected.dataDir, "notes", "agent.md"), "from the Agent");
    expect(await (await owner.get(`${BASE}/demo/api/files`)).json()).toEqual({
      notes: "from the Agent",
    });

    // Past the watcher's settle time, the same load still serves: no reload, no new version.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = await demoOf(owner);
    expect(after.revision).toBe(before.revision);
    expect(after.loadedAt).toBe(before.loadedAt);
    expect(after.error).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "listens on a local socket in its state folder, and a socket path past the limit is refused naming it",
    async (ctx) => {
      const state = workbenchStateDir(t.root, PROJECT, AGENT, "demo");
      // A temp folder as long as macOS's leaves no room: the limit is the case below.
      if (Buffer.byteLength(path.join(state, "t.sock")) > 103) ctx.skip();
      const res = await owner.get(`${BASE}/demo/api/socket`);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as { at: string; reply: string; tooLong: string };
      expect(body.at).toBe(path.join(state, "t.sock"));
      expect(body.reply).toBe("pong");
      expect(body.tooLong).toMatch(/a Unix socket path holds at most 103/);
    },
  );

  it("an Agent named aux and a workbench named report.v2, made before such names were refused, still open", async () => {
    // A Project of its own, so the shared Project's Agent list stays as the other cases expect.
    const project = "owner-odd";
    const created = await owner.post("/api/projects", { projectId: project, name: "odd" });
    expect(created.status, await created.text()).toBe(201);
    // Made the way the CLI or an older server made them, straight on disk.
    await createAgent({ root: t.root, projectId: project, agentId: "aux" });
    const old = path.join(agentStateDir(t.root, project, "aux"), "workbenches", "report.v2");
    await writeDemo(old);

    const agents = (await (
      await owner.get(`/api/projects/${project}/agents`)
    ).json()) as AgentsResponse;
    expect(agents.agents.map((a) => a.agentId)).toContain("aux");
    expect((await owner.get(`/api/projects/${project}/agents/aux/config`)).status).toBe(200);
    const route = `/api/projects/${project}/agents/aux/workbenches`;
    const [loaded] = await listOf(owner, route);
    expect(loaded).toMatchObject({ id: "report.v2", error: null });
    const res = await owner.get(`${route}/report.v2/api/greet`);
    expect(await res.json()).toMatchObject({ greeting: "hello", path: "/greet" });
  });

  it("takes a new Project named after the data root's own folders, and refuses only projects", async () => {
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    // Projects are folders of projects/ now: the data root's top level takes no id.
    await fs.mkdir(path.join(t.root, "plugins"), { recursive: true });
    for (const projectId of ["app", "run", "plugins"]) {
      expect((await admin.post("/api/projects", { projectId, name: projectId })).status).toBe(201);
    }
    const res = await admin.post("/api/projects", { projectId: "projects", name: "projects" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_project_id" } });
  });

  it("refuses a new Agent under a name Windows reserves", async () => {
    for (const agentId of ["nul", "com1"]) {
      const res = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_agent_id" } });
      await expect(fs.stat(agentDir(t.root, PROJECT, agentId))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it("opens and runs Sessions the SDK's way, inside its own Project only", async () => {
    // Creating a Session builds its model client without making a request. A fixture-owned
    // credential makes this case independent of the developer's provider keys and presets.
    const configured = await owner.put(`/api/projects/${PROJECT}/models`, {
      defaultModel: { provider: "custom", modelId: "workbench-test" },
      models: [
        {
          provider: "custom",
          modelId: "workbench-test",
          clientType: "openai",
          baseUrl: "https://workbench.invalid/v1",
          apiKey: "sk-workbench-test",
          contextWindow: 128000,
        },
      ],
    });
    expect(configured.status).toBe(200);
    const res = await owner.get(`${BASE}/demo/api/open?agent=nobody&session=not-a-session`);
    expect(await res.json()).toEqual({
      opened: "createSession: this Project has no Agent 'nobody'",
      ran: "run: this Project has no Session 'not-a-session'",
      agents: [AGENT],
    });
    const system = (await (await owner.get(`${BASE}/demo/api/open?agent=system_agent`)).json()) as {
      opened: unknown;
    };
    expect(system.opened).toBe("The system Agent owns the system apps and runs no Sessions.");
    expect(t.deps.sessionsRepo.listByAgent(PROJECT, "system_agent")).toEqual([]);
    const own = (await (await owner.get(`${BASE}/demo/api/open`)).json()) as {
      opened: { sessionId: string };
    };
    // Assert the Session the workbench caller receives, including its unattended approval
    // mode, rather than the arguments of an internal service or a missing ambient key.
    expect(own).toMatchObject({
      opened: {
        sessionId: expect.any(String),
        projectId: PROJECT,
        agentId: AGENT,
        provider: "custom",
        modelId: "workbench-test",
        approvalMode: "allow-all",
        source: "workbench",
        archived: true,
      },
    });
    const { sessionId } = own.opened;
    t.deps.sessionSources.delete(sessionId); // The source registry of a fresh process.
    const archived = (await (
      await owner.get(
        `/api/me/archived-sessions?source=workbench&projectId=${PROJECT}&workspace=temp&limit=100`,
      )
    ).json()) as ArchivedSessionsResponse;
    expect(archived.sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionId, source: "workbench" })]),
    );
    const active = (await (
      await owner.get(`/api/projects/${PROJECT}/agents/${AGENT}/sessions?category=active`)
    ).json()) as SessionsResponse;
    expect(active.sessions.map((s: { sessionId: string }) => s.sessionId)).not.toContain(sessionId);
    expect((await owner.patch(`/api/sessions/${sessionId}`, { archived: false })).status).toBe(200);
    const kept = (await (await owner.get(`/api/sessions/${sessionId}`)).json()) as SessionResponse;
    expect(kept.session).toMatchObject({ source: "workbench", archived: false });
  });

  it("opens a Session that only talks with deny-all: its tool calls are denied, while a Session opened without the option runs them", async () => {
    const probe = path.join(t.root, "approval-probe.txt");
    await fs.writeFile(probe, "the probe was read");
    // The model reads the probe once per Session, then answers; a request that does not come
    // from a Session's turn (a title, say) gets plain text.
    const mock = await startMockLLM((n) => {
      const sent = requestText(mock.requests[n - 1]!);
      const mode = /read the probe: ([a-z-]+)/.exec(sent)?.[1];
      if (mode === undefined) return "A title";
      if (sent.includes('"tool_result"')) return "done";
      return { toolUse: { id: `toolu_${mode}`, name: "read_file", input: { file_path: probe } } };
    });
    try {
      const talkModel = "claude-bento-quiet";
      const configured = await owner.put(`/api/projects/${PROJECT}/models`, {
        defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
        models: [MOCK_MODEL_ID, talkModel].map((modelId) => ({
          provider: "custom",
          modelId,
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        })),
      });
      expect(configured.status).toBe(200);
      /** What the model was told the tool call came to, once the Session's turn has ended. */
      const talk = async (mode?: string, model?: string) => {
        const query = new URLSearchParams({
          ...(mode ? { mode } : {}),
          ...(model ? { model } : {}),
        });
        const res = await owner.get(`${BASE}/demo/api/talk?${query}`);
        const { opened } = (await res.json()) as {
          opened: { sessionId: string; approvalMode: string } | string;
        };
        if (typeof opened === "string") return { opened, toolResult: null };
        await waitFor(() => t.deps.manager.statusOf(opened.sessionId) === "idle", 20_000);
        const answered = mock.requests.find((req) => {
          const text = requestText(req);
          return text.includes('"tool_result"') && text.includes(`toolu_${mode ?? "default"}`);
        });
        return {
          opened,
          model: answered?.model,
          toolResult: answered ? requestText(answered) : null,
        };
      };

      const quiet = await talk("deny-all", talkModel);
      expect(quiet.opened).toMatchObject({
        provider: "custom",
        modelId: talkModel,
        approvalMode: "deny-all",
        source: "workbench",
      });
      expect(quiet.model).toBe(talkModel);
      expect(quiet.toolResult).toContain("Tool call denied by user.");
      expect(quiet.toolResult).not.toContain("the probe was read");

      const working = await talk();
      expect(working.opened).toMatchObject({ approvalMode: "allow-all", source: "workbench" });
      expect(working.toolResult).toContain("the probe was read");
      expect(working.toolResult).not.toContain("Tool call denied");

      // Nobody watches a workbench Session: a mode that asks a person is refused, by name.
      expect((await talk("always-ask")).opened).toBe(
        'createSession: approvalMode is "allow-all" or "deny-all", not "always-ask"',
      );
    } finally {
      await mock.close();
    }
  });

  it("hands a handler any body and sends back any content type; JSON stays the default", async () => {
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
    // workbench does not get to set the app's cookies.
    const page = await owner.get(`${BASE}/demo/api/page`);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("set-cookie")).toBeNull();
    expect(await page.text()).toBe("<h1>proxied</h1>");
    // A stream: the first chunk is in the client's hands while the handler is still producing
    // the second — nothing is held back until the end.
    const events = await owner.get(`${BASE}/demo/api/events`);
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const reader = events.body!.getReader();
    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe("data: one\n\n");
    } finally {
      // The producer cannot finish until the consumer has received the first chunk.
      // This proves streaming without a wall-clock race on a busy runner.
      expect((await owner.post(`${BASE}/demo/api/release-events`, {})).status).toBe(200);
    }
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("data: two\n\n");
    expect((await reader.read()).done).toBe(true);
    // A redirect, relative to the api mount.
    const moved = await owner.get(`${BASE}/demo/api/moved`);
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("page");
    // And what every existing workbench does is unchanged: JSON in, JSON out.
    const json = await owner.post(`${BASE}/demo/api/count`, {});
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(await json.json()).toEqual({ count: expect.any(Number) });
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

  it("notices an Agent's FIRST workbench, made with nothing but its file tools", async () => {
    // Each retry owns its app: beforeAll's shared Project retains a created Agent after
    // a failed assertion, otherwise a retry fails with agent_exists before checking discovery.
    const fresh = await createTestApp();
    try {
      const owner = apiClient(fresh.app, (await provisionUser(fresh.app, "owner")).cookie);
      const project = await owner.post("/api/projects", { projectId: PROJECT, name: "wf" });
      expect(project.status, await project.text()).toBe(201);
      // No workbenches/ folder when its list is first read.
      const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: "builder" });
      expect(made.status, await made.text()).toBe(201);
      const base = `/api/projects/${PROJECT}/agents/builder/workbenches`;
      expect(
        ((await (await owner.get(base)).json()) as { workbenches: unknown[] }).workbenches,
      ).toEqual([]);
      const workbenches = path.join(agentStateDir(fresh.root, PROJECT, "builder"), "workbenches");
      await expect(fs.stat(workbenches)).rejects.toMatchObject({ code: "ENOENT" });

      const first = path.join(workbenches, "first");
      await fs.mkdir(path.join(first, "ui"), { recursive: true });
      await fs.writeFile(path.join(first, "package.json"), packageJson());
      await fs.writeFile(path.join(first, "index.ts"), indexSource("first"));
      await fs.writeFile(path.join(first, "ui", "index.html"), "<h1>first</h1>");

      // Nobody lists again: the server has to see the folder appear and load it on its own.
      const statusFile = path.join(first, ".build", "status.json");
      let status: { ok?: boolean } = {};
      // Discovery also runs the real compiler. Give it the suite's disk/compile budget,
      // not an iteration count whose ten seconds raced the macOS runner.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && status.ok === undefined) {
        await new Promise((r) => setTimeout(r, 100));
        status = await fs.readFile(statusFile, "utf8").then(
          (text) => JSON.parse(text) as { ok: boolean },
          () => ({}),
        );
      }
      expect(status).toMatchObject({ ok: true, error: null, tabs: ["board"] });
    } finally {
      await fresh.cleanup();
    }
  });

  it("loads an existing Workflow through the new route without losing state", async () => {
    const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: "legacy" });
    expect(made.status).toBe(201);
    const legacy = path.join(agentDir(t.root, PROJECT, "legacy"), "workflows/demo");
    await writeDemo(legacy);
    for (const file of ["package.json", "index.ts"]) {
      const target = path.join(legacy, file);
      await fs.writeFile(
        target,
        (await fs.readFile(target, "utf8")).replaceAll("Workbench", "Workflow"),
      );
    }
    await fs.writeFile(path.join(legacy, "state.json"), JSON.stringify({ count: 40 }));
    const route = `/api/projects/${PROJECT}/agents/legacy/workbenches`;
    const [converted] = await listOf(owner, route);
    expect(converted).toMatchObject({ id: "demo", error: null });
    expect(await (await owner.post(`${route}/demo/api/count`, {})).json()).toEqual({ count: 41 });
    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a workbench written in JavaScript, naming the rename it needs", async () => {
    // An Agent of its own, so the demo's list stays the demo alone.
    const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: "scripter" });
    expect(made.status, await made.text()).toBe(201);
    const scripted = path.join(agentStateDir(t.root, PROJECT, "scripter"), "workbenches", "demo");
    await writeDemo(scripted);
    await fs.rename(path.join(scripted, "index.ts"), path.join(scripted, "index.mjs"));
    const [refused] = await listOf(owner, `/api/projects/${PROJECT}/agents/scripter/workbenches`);
    expect(refused!.error).toContain(
      "a workbench is written in TypeScript: rename index.mjs to index.ts",
    );
  });
});

describe("editing a workbench", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  /** The case's own Agent's workbenches, and the demo folder in it the case edits. */
  let base: string;
  let dir: string;
  let editors = 0;
  let agentId: string;
  let existingPlugins: PluginTables;
  const logged: string[] = [];

  beforeAll(async () => {
    const log = (line: string) => logged.push(line);
    t = await createTestApp({ durableDatabase: true, log });
    const { cookie } = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, cookie);
    const created = await owner.post("/api/projects", { projectId: PROJECT, name: "wf" });
    expect(created.status, await created.text()).toBe(201);
    existingPlugins = await t.deps.projectConfigService.getPluginTables(PROJECT);
    const tables = [existingPlugins.all, ...Object.values(existingPlugins.machines)];
    expect(tables.every((table) => !("@penguinharness/agent-state-git" in table))).toBe(true);
    // Agents created after this cold boot inherit the existing Project's history configuration.
    t = await restartTestApp(t, { log });
    owner = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  // A plain Agent per case, so each has a demo of its own to break. The Agents stay until the
  // app goes: a loaded workbench's folder is watched, and a watched folder can refuse removal
  // on Windows.
  beforeEach(async () => {
    editors += 1;
    agentId = `editor_${editors}`;
    const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId });
    expect(made.status, await made.text()).toBe(201);
    base = `/api/projects/${PROJECT}/agents/${agentId}/workbenches`;
    dir = path.join(agentStateDir(t.root, PROJECT, agentId), "workbenches", "demo");
    await writeDemo(dir);
  });

  const list = () => listOf(owner, base);
  const versions = async (): Promise<WorkbenchVersion[]> =>
    ((await (await owner.get(`${base}/demo/history`)).json()) as { versions: WorkbenchVersion[] })
      .versions;

  it("keeps one loaded instance for concurrent first reads", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => list()));
    expect(results.every(([w]) => w?.error === null)).toBe(true);
    expect(new Set(results.map(([w]) => w!.loadedAt)).size).toBe(1);
    expect((await list())[0]?.loadedAt).toBe(results[0]![0]!.loadedAt);
  });

  it("lists one workbench by id and loads that one alone", async () => {
    const other = path.join(path.dirname(dir), "other");
    await writeDemo(other);
    // Only the HTTP read is under test. A native watcher can separately build a sibling
    // when the fixture's creation events arrive during the requested compile.
    const watcher = vi.spyOn(nodeFs, "watch").mockImplementationOnce(() => {
      throw new Error("Native notifications are unavailable for this query");
    });
    let res: Response;
    try {
      res = await owner.get(`${base}?id=demo`);
    } finally {
      watcher.mockRestore();
    }
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workbenches: WorkbenchInfo[]; enabled: boolean };
    expect(body.workbenches.map((w) => [w.id, w.error])).toEqual([["demo", null]]);
    expect(body.enabled).toBe(true);
    // Never compiled: a load writes its output and its status under `.build/`.
    await expect(fs.stat(path.join(other, ".build"))).rejects.toMatchObject({ code: "ENOENT" });
    const none = (await (await owner.get(`${base}?id=missing`)).json()) as {
      workbenches: WorkbenchInfo[];
    };
    expect(none.workbenches).toEqual([]);
  });

  async function reload(): Promise<WorkbenchInfo> {
    const res = await owner.post(`${base}/demo/reload`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { workbench: WorkbenchInfo }).workbench;
  }

  async function reloadError(): Promise<string> {
    const workbench = await reload();
    // Whatever went wrong, the instance that loaded keeps answering, with its tabs.
    expect(workbench.tabs).toHaveLength(1);
    expect(await (await owner.get(`${base}/demo/api/`)).json()).toMatchObject({
      greeting: "hello",
    });
    return workbench.error ?? "";
  }

  it("a folder file that disappears mid-read is a change, not a failed request", async () => {
    // `walk` lists the files, then each is read: one that goes away in between (an editor's
    // scratch file, the Agent deleting one) used to reject the read and answer 500 although
    // the loaded instance was fine.
    await fs.writeFile(path.join(dir, "notes.md"), "gone in a moment");
    const [listed] = await list();
    expect(listed!.error).toBe(null);
    await fs.rm(path.join(dir, "notes.md"));
    const res = await owner.get(`${base}/demo/api/greet`);
    expect(res.status, await res.text()).toBe(200);
  });

  it("commits each loaded revision once and rolls back to any of them exactly", async () => {
    const [v1] = await list();
    // The first load made the repository beside the Agent State, and put nothing inside it.
    const agent = agentDir(t.root, PROJECT, agentId);
    expect((await fs.stat(path.join(agent, "agent_state.git", "HEAD"))).isFile()).toBe(true);
    const inside = await fs.readdir(path.join(agent, "agent_state"));
    expect(inside.filter((name) => name.startsWith(".git"))).toEqual([]);
    expect((await versions()).map((v) => v.revision)).toEqual([v1!.revision]);

    await fs.writeFile(path.join(dir, "index.ts"), indexSource("bonjour"));
    await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>demo v2</h1>");
    await fs.writeFile(path.join(dir, "ui", "extra.html"), "<p>new in v2</p>");
    await fs.writeFile(path.join(dir, "state.json"), '{"count":5}');
    const v2 = await reload();
    expect(v2.revision).not.toBe(v1!.revision);
    expect(v2.uiRev).not.toBe(v1!.uiRev);
    const gitdir = path.join(agent, "agent_state.git");
    const [latest, initial] = await git.log({ fs: nodeFs, gitdir, depth: 2 });
    expect(latest!.commit.parent).toContain(initial!.oid);
    expect(latest!.commit.message).toContain("workbench demo");
    const { blob } = await git.readBlob({
      fs: nodeFs,
      gitdir,
      oid: latest!.oid,
      filepath: "workbenches/demo/ui/index.html",
    });
    expect(Buffer.from(blob).toString("utf8")).toBe("<h1>demo v2</h1>");
    expect(await t.deps.projectConfigService.getPluginTables(PROJECT)).toEqual(existingPlugins);
    expect(
      (await (await owner.get(`${base}/demo/api/`)).json()) as { greeting: string },
    ).toMatchObject({
      greeting: "bonjour",
    });
    // Loading the same files again records nothing.
    await reload();
    expect((await versions()).map((v) => v.revision)).toEqual([v2.revision, v1!.revision]);

    const back = await owner.post(`${base}/demo/rollback`, { revision: v1!.revision });
    expect(back.status).toBe(200);
    expect(((await back.json()) as { workbench: WorkbenchInfo }).workbench.revision).toBe(
      v1!.revision,
    );
    expect(await (await owner.get(`${base}/demo/ui/index.html`)).text()).toBe("<h1>demo v1</h1>");
    // Exactly that version: the page added since is gone, the workbench's state is not.
    await expect(fs.stat(path.join(dir, "ui", "extra.html"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(path.join(dir, "state.json"), "utf8")).toBe('{"count":5}');
    // Only the serving revision keeps its emitted code.
    expect((await fs.readdir(path.join(dir, ".build"))).sort()).toEqual(
      [v1!.revision, "status.json"].sort(),
    );
    expect(
      (await (await owner.get(`${base}/demo/api/`)).json()) as { greeting: string },
    ).toMatchObject({
      greeting: "hello",
    });
    // A rollback is a load like any other: the newest version, in a commit of its own.
    const after = await versions();
    expect(after.map((v) => v.revision)).toEqual([v1!.revision, v2.revision, v1!.revision]);
    expect(after[0]!.commit).not.toBe(after[2]!.commit);
    expect((await owner.post(`${base}/demo/rollback`, { revision: "000000000000" })).status).toBe(
      404,
    );
  });

  it("a file under a name git refuses loads, is named in the log, and stays out of the versions", async () => {
    await fs.writeFile(path.join(dir, "git~1"), "kept on disk, not in history");

    const [listed] = await list();

    expect(listed!.error).toBe(null);
    expect(logged.some((line) => line.includes("git refuses the name: git~1"))).toBe(true);
    expect((await versions()).map((v) => v.revision)).toEqual([listed!.revision]);
  });

  it("a repository it cannot read never stops a load: the version is not recorded, history is an error", async () => {
    const repo = path.join(agentDir(t.root, PROJECT, agentId), "agent_state.git");
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, "HEAD"), "garbage\n");

    const [listed] = await list();
    expect(listed!.error).toBe(null);
    expect(await (await owner.get(`${base}/demo/api/`)).json()).toMatchObject({
      greeting: "hello",
    });
    expect(
      logged.some((line) =>
        line.includes(`${agentId}/demo@${listed!.revision}: version not recorded`),
      ),
    ).toBe(true);
    const history = await owner.get(`${base}/demo/history`);
    expect(history.status).toBe(500);
    expect(((await history.json()) as { error: { code: string } }).error.code).toBe(
      "workbench_history_unreadable",
    );
  });

  it("keeps the previous instance serving when an edit does not load, and names the problem", async () => {
    const [loaded] = await list();
    await fs.writeFile(
      path.join(dir, "package.json"),
      packageJson([
        {
          ...MANIFEST,
          requires: { host: { iface: "@prismshadow/penguin-server#Workbenches", from: "Host" } },
        },
      ]),
    );
    const res = await owner.post(`${base}/demo/reload`);
    const broken = ((await res.json()) as { workbench: WorkbenchInfo }).workbench;
    // Named before anything runs: the host gave this workbench no types for that interface.
    expect(broken.error).toContain(
      "requires.host '@prismshadow/penguin-server#Workbenches': not among the types this workbench was written against",
    );
    expect(await (await owner.get(`${base}/demo/api/`)).json()).toMatchObject({
      greeting: "hello",
    });
    // Only what loaded is a version.
    expect((await versions()).map((v) => v.revision)).toEqual([loaded!.revision]);
  });

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
      /index\.ts:\d+:\d+ TS2551 Property 'setStat' does not exist on type 'WorkbenchHost'/,
    );
    expect(error).toContain("TS2322");
    // The same words reach the Agent through its files.
    expect(
      JSON.parse(await fs.readFile(path.join(dir, ".build", "status.json"), "utf8")),
    ).toMatchObject({ ok: false, error });
    // Said once, by the author's own file; the server's copy of the same question is left out.
    expect(error).not.toContain("default export");
    expect(error.match(/TS2322/g)).toHaveLength(1);
  });

  it("accepts a null JSON response body", async () => {
    // A JSON body may be null: an optional `unknown` member stays `unknown` in the table.
    await fs.writeFile(
      path.join(dir, "index.ts"),
      indexSource("hello").replace("return { body: { count: n } };", "return { body: null };"),
    );
    const [loaded] = await list();
    expect(loaded!.error).toBeNull();
    const response = await owner.post(`${base}/demo/api/count`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("refuses untyped handler parameters and keeps the previous instance serving", async () => {
    await list();
    // Untyped is refused too: `strict` leaves no implicit any to slip through.
    await fs.writeFile(
      path.join(dir, "index.ts"),
      indexSource("hello").replace(" satisfies WorkbenchPackage", ""),
    );
    expect(await reloadError()).toContain("TS7031");
  });

  it("refuses a required host method removed since authoring and keeps serving", async () => {
    await list();
    // requires: it was written when the host had a method this platform lacks.
    await writtenAgainst(dir, (t) => {
      t.ifaces[HOST_KEY]!.methods["removedSince"] = { params: [], returns: { void: true } };
    });
    const error = await reloadError();
    expect(error).toContain(`Workbench: requires.host '${HOST_KEY}'`);
    expect(error).toContain("removedSince");
  });

  it("refuses an incompatible provided handler and keeps the previous instance serving", async () => {
    await list();
    // provides: the handler it was written against answers with something else.
    await writtenAgainst(dir, (t) => {
      t.ifaces[MAIN_KEY]!.methods["handle"]!.returns = { promise: { data: "string" } };
    });
    const error = await reloadError();
    expect(error).toContain(`Workbench: provides.main '${MAIN_KEY}'`);
    expect(error).toContain("TS2322");
  });

  it("accepts a platform with a host method added since authoring", async () => {
    await list();
    // An addition on the platform's side breaks nothing.
    await writtenAgainst(dir, (t) => {
      delete t.ifaces[HOST_KEY]!.methods["log"];
    });
    expect((await reload()).error).toBeNull();
  });

  it("refuses an unreadable type table and recovers after installing fresh types", async () => {
    await list();
    // A table that cannot be read is a problem, never a pass against the platform's own;
    // deleting the directory is how a workbench takes this harness's types afresh.
    await fs.writeFile(path.join(dir, ".harness", "ifaces.json"), "{");
    expect(await reloadError()).toContain(".harness/ifaces.json cannot be read");
    await fs.rm(path.join(dir, ".harness"), { recursive: true });
    expect((await reload()).error).toBeNull();
  });

  const writeContributions = (contributes: Record<string, unknown[]>) =>
    fs.writeFile(path.join(dir, "package.json"), packageJson([{ ...MANIFEST, contributes }]));

  it("exposes several contributed tabs in order", async () => {
    const stats = {
      ...TAB,
      id: "demo.stats",
      key: "stats",
      title: "Stats",
      renderer: { iframe: { src: "ui/stats.html" } },
    };
    await writeContributions({ "WebModule.sessionTabs": [TAB, stats] });
    const [two] = await list();
    expect(two!.error).toBeNull();
    expect(two!.tabs.map((tab) => tab.key)).toEqual(["board", "stats"]);
  });

  it("refuses a tab pointing outside ui/ and keeps the previous instance serving", async () => {
    await list();
    await writeContributions({
      "WebModule.sessionTabs": [{ ...TAB, renderer: { iframe: { src: "index.ts" } } }],
    });
    expect(await reloadError()).toContain("renderer.iframe.src must be a file under ui/");
  });

  it("refuses a closed contribution slot and keeps the previous instance serving", async () => {
    await list();
    await writeContributions({
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
    expect(await reloadError()).toContain("WebModule.pages");
  });

  it("refuses a malformed tab and keeps the previous instance serving", async () => {
    await list();
    await writeContributions({ "WebModule.sessionTabs": [{ ...TAB, title: 7 }] });
    expect(await reloadError()).toContain("module tree rejected");
  });

  it("carries a tab's icon through as data, though the strip draws no icon", async () => {
    // The icon is the app's icon for installing (the manifest takes the first tab that
    // names one); it rides on the resolved tab as data, whatever the strip shows.
    await list();
    const icon = { kind: "svg", data: '<svg xmlns="http://www.w3.org/2000/svg"/>' };
    await writeContributions({ "WebModule.sessionTabs": [{ ...TAB, icon }] });
    const reloaded = await reload();
    expect(reloaded.error).toBeNull();
    expect(reloaded.tabs[0]).toMatchObject({ key: TAB.key, icon });
  });

  it("carries a tab's declared shortName, blank or absent meaning the title", async () => {
    // The launcher label when the tab installs as its own app: declared it overrides the
    // title for short_name; blank or of another type it means nothing, never an empty label.
    await list();
    await writeContributions({
      "WebModule.sessionTabs": [
        { ...TAB, shortName: "Brd" },
        { ...TAB, id: "demo.stats", key: "stats", title: "Stats", shortName: "  " },
      ],
    });
    const reloaded = await reload();
    expect(reloaded.error).toBeNull();
    const tabs = reloaded.tabs as { key: string; shortName?: string }[];
    expect(tabs.find((t) => t.key === "board")!.shortName).toBe("Brd");
    expect(tabs.find((t) => t.key === "stats")).not.toHaveProperty("shortName");
    // And of another type it is dropped, not carried as a wrong-typed field.
    await writeContributions({ "WebModule.sessionTabs": [{ ...TAB, shortName: 7 }] });
    const typed = await reload();
    expect(typed.error).toBeNull();
    expect(typed.tabs[0]).not.toHaveProperty("shortName");
  });

  it("hints at pages with no tab and clears the hint when a tab is added", async () => {
    // A workbench with no contribution is server-side only — and since this one has pages, the
    // load says that nothing shows them, with the entry to add, in the API and in the status
    // file alike (the Agent that wrote it may have only the file).
    await writeContributions({});
    const [bare] = (await list()) as [WorkbenchInfo];
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
    await writeContributions({ "WebModule.sessionTabs": [TAB] });
    expect(((await reload()) as { hints: string[] }).hints).toEqual([]);
  });

  it("keeps its files at the agent level by default; installed from a plugin it also has a server and a machine level, which every copy shares and no removal takes", async () => {
    const machineHome = path.join(t.root, "machine-home");
    const before = process.env.PENGUIN_MACHINE_HOME;
    process.env.PENGUIN_MACHINE_HOME = machineHome;
    try {
      // Two Agents with the same plugin's workbench, installed before their first load.
      const receipt = JSON.stringify({
        name: "demo",
        plugin: "demo-plugin",
        version: "2026.11.19.1",
        files: [],
      });
      await fs.writeFile(path.join(dir, ".plugin.json"), receipt);
      const twin = `${agentId}_twin`;
      expect((await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: twin })).status).toBe(
        201,
      );
      const twinDir = path.join(agentStateDir(t.root, PROJECT, twin), "workbenches", "demo");
      await writeDemo(twinDir);
      await fs.writeFile(path.join(twinDir, ".plugin.json"), receipt);
      type Levels = Record<"default" | "agent" | "server" | "machine", Record<string, string>>;
      const levelsOf = async (agent: string): Promise<Levels> => {
        const res = await owner.get(
          `/api/projects/${PROJECT}/agents/${agent}/workbenches/demo/api/levels`,
        );
        expect(res.status, await res.clone().text()).toBe(200);
        return (await res.json()) as Levels;
      };
      const mine = await levelsOf(agentId);
      const theirs = await levelsOf(twin);

      const agentLevel = path.join(agentDir(t.root, PROJECT, agentId), "app");
      expect(mine.default).toEqual(mine.agent);
      expect(mine.agent).toEqual({
        dataDir: path.join(agentLevel, "data", "demo"),
        cacheDir: path.join(agentLevel, "cache", "demo"),
        stateDir: workbenchStateDir(t.root, PROJECT, agentId, "demo"),
      });
      expect(mine.server).toEqual(
        sharedWorkbenchDirs(
          serverAppDir(t.root),
          path.join(runDir(t.root), "server"),
          "demo-plugin",
          "demo",
        ),
      );
      expect(mine.machine).toEqual(
        sharedWorkbenchDirs(machineHome, path.join(machineHome, "run"), "demo-plugin", "demo"),
      );
      // The other copy of the app has its own agent level and the same shared ones.
      expect(theirs.agent.dataDir).not.toBe(mine.agent.dataDir);
      expect(theirs.server).toEqual(mine.server);
      expect(theirs.machine).toEqual(mine.machine);
      for (const level of [mine.agent, mine.server, mine.machine]) {
        for (const folder of Object.values(level)) {
          expect((await fs.stat(folder)).isDirectory()).toBe(true);
        }
      }

      // A local socket at the server level, where the path is short enough to hold one.
      const serverSocket = path.join(mine.server.stateDir!, "t.sock");
      if (process.platform !== "win32" && Buffer.byteLength(serverSocket) <= 103) {
        const res = await owner.get(`${base}/demo/api/socket?level=server`);
        expect(await res.json()).toMatchObject({ at: serverSocket, reply: "pong" });
      }

      // Removing one copy takes its agent level and leaves what every copy shares.
      await fs.writeFile(path.join(mine.server.dataDir!, "weights.bin"), "w");
      await fs.writeFile(path.join(mine.machine.dataDir!, "server.bin"), "m");
      expect((await owner.delete(`${base}/demo`)).status).toBe(204);
      await expect(fs.stat(mine.agent.dataDir!)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(mine.server.dataDir!, "weights.bin"), "utf8")).toBe("w");
      expect(await fs.readFile(path.join(mine.machine.dataDir!, "server.bin"), "utf8")).toBe("m");
      expect((await fs.stat(mine.server.stateDir!)).isDirectory()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.PENGUIN_MACHINE_HOME;
      else process.env.PENGUIN_MACHINE_HOME = before;
    }
  });

  it("made in place, it has the agent level only: a shared level is refused, naming the agent level", async () => {
    const res = await owner.get(`${base}/demo/api/levels`);
    expect(res.status, await res.clone().text()).toBe(200);
    const levels = (await res.json()) as Record<string, unknown>;
    expect(levels.default).toEqual(levels.agent);
    for (const shared of ["server", "machine"]) {
      expect(levels[shared]).toMatch(/was made in place: keep its files at the agent level/);
    }
  });

  it("removes the folder and its data on request, and its versions are no longer listed", async () => {
    const app = path.join(agentDir(t.root, PROJECT, agentId), "app");
    // What the workbench and its Agent wrote beside the State, and another workbench's data.
    for (const rel of ["data/demo/decks/a.json", "cache/demo/thumb.png", "data/other/keep.md"]) {
      await fs.mkdir(path.dirname(path.join(app, rel)), { recursive: true });
      await fs.writeFile(path.join(app, rel), "x");
    }
    const state = workbenchStateDir(t.root, PROJECT, agentId, "demo");
    await fs.mkdir(state, { recursive: true });
    await fs.writeFile(path.join(state, "dev.lock"), "x");
    const count = async () => {
      const response = (await (
        await owner.get(`/api/projects/${PROJECT}/agents`)
      ).json()) as AgentsResponse;
      return response.agents.find((a: { agentId: string }) => a.agentId === agentId)
        ?.workbenchCount;
    };
    expect(await count()).toBe(1);
    await list();
    expect((await owner.delete(`${base}/demo`)).status).toBe(204);
    expect(await count()).toBe(0);
    expect(await list()).toEqual([]);
    await expect(fs.stat(dir)).rejects.toThrow();
    // Its data, cache and state went with it, so a workbench made again under this id starts empty.
    await expect(fs.stat(path.join(app, "data", "demo"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(app, "cache", "demo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(state)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(app, "data", "other", "keep.md"), "utf8")).toBe("x");
    expect((await owner.get(`${base}/demo/api/`)).status).toBe(404);
    expect((await owner.delete(`${base}/demo`)).status).toBe(404);
    // The removal is a commit of its own: the history walk stops there.
    expect(await versions()).toEqual([]);
  });
});

describe("an engine a plugin contributes", { timeout: 30_000 }, () => {
  it(
    "writes a load's version, reads the history and a restore, and the member's restore is under their name",
    { skip: liveEngine === null },
    async () => {
      const calls: string[] = [];
      const engine: AgentStateEngine = {
        name: "recording",
        commit: (c) => {
          calls.push("commit");
          return liveEngine!.commit(c);
        },
        readObjects: (at, oids) => {
          calls.push("readObjects");
          return liveEngine!.readObjects(at, oids);
        },
      };
      let cacheDir = "";
      const source: AgentStateEngineSource = (host) => {
        cacheDir = host.cacheDir;
        return engine;
      };
      const module: ModuleDef = {
        manifest: parseManifest({
          name: "RecordingEngine",
          requires: {},
          provides: {},
          contributes: {
            "AgentStateHistoryModule.engines": [{ id: "recording.engine", name: "recording" }],
          },
          children: [],
        }),
        create: () => ({ api: {}, bind: { "recording.engine": source } }),
      };
      const plugins = new PluginHost();
      plugins.use({ specifier: "recording-engine", modules: [module], replaces: [] });
      const logged: string[] = [];
      const t = await createTestApp({ plugins, log: (line) => logged.push(line) });
      try {
        const owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
        expect((await owner.post("/api/projects", { projectId: PROJECT, name: "wf" })).status).toBe(
          201,
        );
        const dir = path.join(agentStateDir(t.root, PROJECT, AGENT), "workbenches", "demo");
        await writeDemo(dir);
        expect(cacheDir).toBe(path.join(t.root, "cache", "recording.engine"));
        await waitFor(() => logged.some((line) => line.includes("recording records Agent State")));

        const demo = await demoOf(owner);
        expect(calls).toEqual(["commit"]);
        await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>demo v2</h1>");
        await owner.post(`${BASE}/demo/reload`);
        expect(
          (await owner.put("/api/me/profile", { displayName: "Ada Lovelace" })).status,
        ).toBeLessThan(300);
        const back = await owner.post(`${BASE}/demo/rollback`, { revision: demo.revision });
        expect(back.status, await back.text()).toBe(200);

        expect(calls).toEqual(["commit", "commit", "readObjects", "commit"]);
        const gitdir = path.join(agentDir(t.root, PROJECT, AGENT), "agent_state.git");
        const tip = await git.resolveRef({ fs: nodeFs, gitdir, ref: "HEAD" });
        const { commit } = await git.readCommit({ fs: nodeFs, gitdir, oid: tip });
        expect(commit.author.name).toBe("Ada Lovelace");
        expect(commit.message).toBe(`workbench demo @${demo.revision}\n`);
      } finally {
        await t.cleanup();
      }
  });
});
