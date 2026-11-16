/**
 * Switching workbenches on and off: one workbench's own switch (PUT …/workbenches/:id/enabled)
 * and the Agent-wide one (PUT …/workbenches/enabled).
 *
 * A workbench switched off (none of these load it, so none runs the compiler):
 * - Given its own switch off, it is listed with `enabled: false`, its source revision, no tabs,
 *   no hints, no error and no load time, it is never loaded, and the listing's Agent-wide
 *   switch still reads on.
 * - Its pages, the page runtime, the page SDK, its API and a reload answer 409
 *   `workbench_disabled`; its history and export still answer, the export without the switch,
 *   and it can still be removed.
 * - An archive imported over it with `overwrite` writes the new source and leaves it off and
 *   unloaded.
 * - A reinstall of the plugin that installed it leaves it off and unloaded.
 * - A member who is not the owner is refused either switch (403 `owner_required`), a body
 *   without a boolean is 400, an unknown workbench is 404, and none of them changes anything.
 *
 * A loaded workbench (one load shared by the group, and one more each time a switch turns it
 * back on):
 * - Given it follows a Session, when its own switch goes off, the subscription ends at once,
 *   it answers with no tabs and no load time, its API answers 409 and the Project's users hear
 *   `workbench_updated`; when the switch goes back on, it loads and answers again.
 * - When the Agent-wide switch goes off, it is unloaded while its own switch stays on, and a
 *   rollback then restores its files without loading it; when the Agent-wide switch goes back
 *   on, it loads again, and a workbench whose own switch is off stays unloaded.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  ServerEvent,
  WorkbenchesResponse,
  WorkbenchInfo,
  WorkbenchVersion,
} from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { contentTable, writePrefixPackage } from "./plugin-fixtures.js";

const PROJECT = "owner_s-switches";
const HOST_KEY = "@prismshadow/penguin-server#WorkbenchHost";
const MAIN_KEY = "@prismshadow/penguin-server#WorkbenchMain";
const TAB = {
  id: "demo.board",
  key: "board",
  title: "Board",
  renderer: { iframe: { src: "ui/index.html" } },
};

const packageJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "Demo",
    version: "1.0.0",
    type: "module",
    penguin: {
      ...extra,
      modules: [
        {
          name: "Workbench",
          requires: { host: { iface: HOST_KEY, from: "Host" } },
          provides: { main: MAIN_KEY },
          contributes: { "WebModule.sessionTabs": [TAB] },
          children: [],
        },
      ],
    },
  });

/** Opens a Session, follows one, or answers `greeting` (ES2022 only: the DOM types slow every compile). */
const source = (greeting: string) => `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                if (req.path === "/open") return { body: await host.createSession() };
                if (req.path === "/watch") {
                  host.subscribe(req.query["session"] ?? "", () => {});
                  return { body: null };
                }
                return { body: ${JSON.stringify(greeting)} };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

const DEMO_FILES = {
  "package.json": packageJson(),
  "index.ts": source("on"),
  "ui/index.html": "<h1>demo</h1>",
};

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), body);
  }
}

const errorCode = async (res: Response | Promise<Response>): Promise<[number, string]> => {
  const answer = await res;
  return [answer.status, ((await answer.json()) as { error: { code: string } }).error.code];
};

describe("workbench switches", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let ownerId: string;
  let member: ReturnType<typeof apiClient>;
  let agents = 0;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_s");
    ownerId = a.user.userId;
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_s")).cookie);
    const created = await owner.post("/api/projects", { projectId: PROJECT, name: "switches" });
    expect(created.status, await created.text()).toBe(201);
    expect(
      (await owner.post(`/api/projects/${PROJECT}/members`, { userId: "member_s" })).status,
    ).toBe(201);
    // Opening a Session builds its model client without a request: a fixture credential keeps
    // that independent of the developer's keys.
    const models = await owner.put(`/api/projects/${PROJECT}/models`, {
      defaultModel: { provider: "custom", modelId: "switch-test" },
      models: [
        {
          provider: "custom",
          modelId: "switch-test",
          clientType: "openai",
          baseUrl: "https://switches.invalid/v1",
          apiKey: "sk-switch-test",
          contextWindow: 128000,
        },
      ],
    });
    expect(models.status, await models.text()).toBe(200);
    await writePrefixPackage(t.root, "@acme/desk", {
      "package.json": JSON.stringify({ name: "@acme/desk", version: "1.0.0" }),
      "ifaces.json": contentTable("@acme/desk", { workbenches: ["desk"] }),
      // A library workbench carries its dated version in package.json.
      "workbenches/desk/package.json": packageJson({ version: "2026.11.05.1" }),
      "workbenches/desk/index.ts": DEMO_FILES["index.ts"],
      "workbenches/desk/ui/index.html": DEMO_FILES["ui/index.html"],
    });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /** A fresh Agent; answers its workbench routes and the folder its workbenches live in. */
  const newAgent = async () => {
    agents += 1;
    const agentId = `switch_${agents}`;
    const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId });
    expect(made.status, await made.text()).toBe(201);
    return {
      agentId,
      base: `/api/projects/${PROJECT}/agents/${agentId}/workbenches`,
      folders: path.join(agentStateDir(t.root, PROJECT, agentId), "workbenches"),
    };
  };
  const listing = async (base: string): Promise<WorkbenchesResponse> => {
    const res = await owner.get(base);
    expect(res.status).toBe(200);
    return (await res.json()) as WorkbenchesResponse;
  };
  const turn = async (url: string, enabled: boolean) => {
    const res = await owner.put(url, { enabled });
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };
  /** What a workbench that does not run is listed as. */
  const idle = (id: string, enabled: boolean) => ({
    id,
    revision: expect.stringMatching(/^[0-9a-f]{12}$/),
    tabs: [],
    hints: [],
    loadedAt: null,
    error: null,
    enabled,
  });

  describe("a workbench switched off", () => {
    /** An Agent whose `demo` was switched off before anything loaded it. */
    const offDemo = async () => {
      const agent = await newAgent();
      const dir = path.join(agent.folders, "demo");
      await writeFiles(dir, DEMO_FILES);
      const { workbench } = (await turn(`${agent.base}/demo/enabled`, false)) as {
        workbench: WorkbenchInfo;
      };
      expect(workbench).toMatchObject(idle("demo", false));
      return { ...agent, dir };
    };

    it("is listed from its folder with its switch off, and never loaded", async () => {
      const { base, dir } = await offDemo();
      const listed = await listing(base);
      expect(listed.enabled).toBe(true);
      expect(listed.workbenches).toEqual([
        { ...idle("demo", false), name: "Demo", version: "1.0.0", uiRev: expect.any(String) },
      ]);
      // A load emits into `.build/`: there is none.
      await expect(fs.stat(path.join(dir, ".build"))).rejects.toThrow();
    });

    it("refuses every route that serves it with 409, while history, export and removal still work", async () => {
      const { base, dir } = await offDemo();
      for (const res of [
        owner.get(`${base}/demo/ui/index.html`),
        owner.get(`${base}/demo/sdk/ui/runtime.js`),
        owner.get(`${base}/demo/sdk/workbench.js`),
        owner.post(`${base}/demo/api/hello`, {}),
        owner.post(`${base}/demo/reload`),
      ]) {
        expect(await errorCode(res)).toEqual([409, "workbench_disabled"]);
      }
      const history = await owner.get(`${base}/demo/history`);
      expect(history.status).toBe(200);
      expect(((await history.json()) as { versions: WorkbenchVersion[] }).versions).toEqual([]);
      const exported = await owner.get(`${base}/demo/archive`);
      expect(exported.status).toBe(200);
      expect(Object.keys(unzipSync(new Uint8Array(await exported.arrayBuffer()))).sort()).toEqual([
        "demo/index.ts",
        "demo/package.json",
        "demo/ui/index.html",
      ]);
      expect((await owner.delete(`${base}/demo`)).status).toBe(204);
      await expect(fs.stat(dir)).rejects.toThrow();
    });

    it("stays off and unloaded when an archive is imported over it", async () => {
      const { base, dir } = await offDemo();
      const zip = zipSync({
        "demo/package.json": strToU8(packageJson()),
        "demo/index.ts": strToU8(source("imported")),
        "demo/ui/index.html": strToU8("<h1>imported</h1>"),
      });
      const res = await owner.post(`${base}/archive`, {
        dataBase64: Buffer.from(zip).toString("base64"),
        overwrite: true,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      expect(((await res.json()) as { workbench: WorkbenchInfo }).workbench).toMatchObject(
        idle("demo", false),
      );
      expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toBe(source("imported"));
      expect((await listing(base)).workbenches).toEqual([
        expect.objectContaining(idle("demo", false)),
      ]);
      await expect(fs.stat(path.join(dir, ".build"))).rejects.toThrow();
    });

    it("stays off and unloaded when the plugin that installed it is reinstalled", async () => {
      const { agentId, base, folders } = await newAgent();
      const plugins = `/api/projects/${PROJECT}/agents/${agentId}/plugins`;
      expect((await owner.post(plugins, { names: ["desk"] })).status).toBe(201);
      await turn(`${base}/desk/enabled`, false);
      expect((await owner.post(plugins, { names: ["desk"] })).status).toBe(201);
      expect((await listing(base)).workbenches).toEqual([
        expect.objectContaining(idle("desk", false)),
      ]);
      await expect(fs.stat(path.join(folders, "desk", ".build"))).rejects.toThrow();
    });

    it("refuses a member, a body without a boolean and an unknown workbench, and changes nothing", async () => {
      const { base } = await offDemo();
      expect(await errorCode(member.put(`${base}/demo/enabled`, { enabled: true }))).toEqual([
        403,
        "owner_required",
      ]);
      expect(await errorCode(member.put(`${base}/enabled`, { enabled: false }))).toEqual([
        403,
        "owner_required",
      ]);
      expect(await errorCode(owner.put(`${base}/demo/enabled`, { enabled: "yes" }))).toEqual([
        400,
        "bad_request",
      ]);
      expect((await owner.put(`${base}/nope/enabled`, { enabled: false })).status).toBe(404);
      const listed = await listing(base);
      expect(listed.enabled).toBe(true);
      expect(listed.workbenches).toEqual([expect.objectContaining(idle("demo", false))]);
    });
  });

  describe("a loaded workbench", () => {
    let base: string;
    let agentId: string;
    let dir: string;
    /** The handler's answer to `route`. */
    const call = async <T>(route: string): Promise<T> => {
      const res = await owner.post(`${base}/live/api${route}`, {});
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as T;
    };
    const servesTab = (w: WorkbenchInfo) => {
      expect(w).toMatchObject({ id: "live", enabled: true, error: null });
      expect(w.tabs.map((tab) => tab.key)).toEqual(["board"]);
      expect(w.loadedAt).toEqual(expect.any(String));
    };

    // The shared first load runs the compiler.
    beforeAll(async () => {
      let folders: string;
      ({ agentId, base, folders } = await newAgent());
      dir = path.join(folders, "live");
      await writeFiles(dir, DEMO_FILES);
      // Off before anything lists it, so it never loads.
      await writeFiles(path.join(folders, "spare"), DEMO_FILES);
      await turn(`${base}/spare/enabled`, false);
      const [live] = (await listing(base)).workbenches;
      servesTab(live!);
    }, 30_000);

    it("ends its subscriptions and refuses its API when its own switch goes off, and serves again when it goes on", async () => {
      const { sessionId } = await call<{ sessionId: string }>("/open");
      const channel = t.deps.channels.get(sessionId);
      await call(`/watch?session=${sessionId}`);
      expect(channel.subscriberCount).toBe(1);
      const heard: ServerEvent[] = [];
      const stop = t.deps.channels.get(userChannelKey(ownerId)).subscribe((evt) => {
        if (evt.event === "server_event") heard.push(JSON.parse(evt.data) as ServerEvent);
      });
      try {
        const { workbench } = (await turn(`${base}/live/enabled`, false)) as {
          workbench: WorkbenchInfo;
        };
        expect(workbench).toMatchObject(idle("live", false));
        expect(channel.subscriberCount).toBe(0);
        expect(await errorCode(owner.post(`${base}/live/api/hello`, {}))).toEqual([
          409,
          "workbench_disabled",
        ]);
        expect(heard).toContainEqual({
          type: "workbench_updated",
          projectId: PROJECT,
          agentId,
          workbench,
        });
      } finally {
        stop();
      }

      const { workbench } = (await turn(`${base}/live/enabled`, true)) as {
        workbench: WorkbenchInfo;
      };
      servesTab(workbench);
      expect(await call("/hello")).toBe("on");
    });

    it("unloads everything with the Agent-wide switch, keeps a rollback from loading, and loads only the ones switched on again", async () => {
      const versions = (await (await owner.get(`${base}/live/history`)).json()) as {
        versions: WorkbenchVersion[];
      };
      const loaded = versions.versions[0]!.revision;

      const off = (await turn(`${base}/enabled`, false)) as WorkbenchesResponse;
      expect(off.enabled).toBe(false);
      expect(off.workbenches).toEqual([
        expect.objectContaining(idle("live", true)),
        expect.objectContaining(idle("spare", false)),
      ]);
      expect(await errorCode(owner.post(`${base}/live/api/hello`, {}))).toEqual([
        409,
        "workbench_disabled",
      ]);
      expect((await listing(base)).enabled).toBe(false);

      // An edit, then a rollback to the version that loaded: the files come back, nothing loads.
      await fs.writeFile(path.join(dir, "index.ts"), source("edited"));
      const rolled = await owner.post(`${base}/live/rollback`, { revision: loaded });
      expect(rolled.status, await rolled.clone().text()).toBe(200);
      expect(((await rolled.json()) as { workbench: WorkbenchInfo }).workbench).toMatchObject({
        ...idle("live", true),
        revision: loaded,
      });
      expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toBe(source("on"));

      const on = (await turn(`${base}/enabled`, true)) as WorkbenchesResponse;
      expect(on.enabled).toBe(true);
      servesTab(on.workbenches[0]!);
      expect(on.workbenches[1]).toMatchObject(idle("spare", false));
      expect(await call("/hello")).toBe("on");
    });
  });
});
