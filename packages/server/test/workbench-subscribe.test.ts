/**
 * A workbench's handler following a Session live (`WorkbenchHost.subscribe`): the real app, the
 * real SessionManager running a core Session against the loopback model (live-session.ts).
 *
 * - Given a run it subscribed to before starting, the handler receives exactly the records the
 *   cookie door's AMSP stream writes, task_begin through task_end, in order, partial deltas
 *   included; a listener that throws on every record is logged once and stops nothing.
 * - A Session of another Project is refused like every other host call.
 * - Unsubscribing twice is harmless and ends only that subscription.
 * - A reload ends every subscription of the tree it replaces, forgotten ones included.
 * - A workbench whose `.harness/` was written before `subscribe` existed still loads.
 * - A subscription whose Session sits idle with nothing published through the hub's idle window
 *   ends by itself; one on a running Session, or on a channel still publishing, is kept.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentDir } from "@prismshadow/penguin-core";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import { readAmsp } from "@prismshadow/amsp";
import type { AmspRecord } from "@prismshadow/amsp";
import type { WorkbenchInfo, WorkbenchRecord } from "../src/api/types.js";
import { Channel } from "../src/runtime/channel.js";
import { IDLE_RELEASE_MS, WorkbenchSubscriptions } from "../src/workbenches/subscribe.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM } from "./live-session.js";
import type { MockLLM } from "./live-session.js";

const P = "default_project";
const A = "default_agent";
const BASE = `/api/projects/${P}/agents/${A}/workbenches`;
const HOST_KEY = "@prismshadow/penguin-server#WorkbenchHost";
const MAIN_KEY = "@prismshadow/penguin-server#WorkbenchMain";
const RECORD_KEY = "@prismshadow/penguin-server#WorkbenchRecord";

const PACKAGE = JSON.stringify({
  name: "Follow",
  version: "1.0.0",
  type: "module",
  penguin: {
    modules: [
      {
        name: "Workbench",
        requires: { host: { iface: HOST_KEY, from: "Host" } },
        provides: { main: MAIN_KEY },
        contributes: {},
        children: [],
      },
    ],
  },
});

// Only ES2022 APIs: loading the DOM declarations would slow every compile of the fixture.
const FOLLOW = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage, WorkbenchRecord, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        const seen: WorkbenchRecord[] = [];
        let stop = (): void => {};
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                const id = req.query["session"] ?? "";
                if (req.path === "/open") return { body: await host.createSession() };
                if (req.path === "/follow") {
                  // A listener that fails on every record, beside the one that keeps them.
                  host.subscribe(id, () => {
                    throw new Error("listener failed");
                  });
                  stop = host.subscribe(id, (record) => {
                    seen.push(record);
                  });
                  return { body: await host.run(id, [{ text: "Say hello" }]) };
                }
                if (req.path === "/watch") {
                  stop = host.subscribe(id, () => {});
                  return { body: null };
                }
                if (req.path === "/stop") {
                  stop();
                  stop();
                  return { body: null };
                }
                if (req.path === "/try") {
                  // Subscribes and keeps nothing: the answer is what the call threw, if anything.
                  try {
                    host.subscribe(id, () => {});
                    return { body: "subscribed" };
                  } catch (err) {
                    return { body: (err as Error).message };
                  }
                }
                return { body: seen };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

/** A handler that never heard of `subscribe`. */
const PLAIN = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create() {
        return { api: { main: { async handle() { return { body: "plain" }; } } } };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

/** What a record is called in assertions: its payload type, or `session_meta`. */
const kindOf = (r: AmspRecord | WorkbenchRecord): string =>
  r.type === "session_meta" ? "session_meta" : String((r.payload as { type?: string }).type);

describe("WorkbenchHost.subscribe", { timeout: 30_000 }, () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let mock: MockLLM;
  const lines: string[] = [];

  const writeWorkbench = async (id: string, source: string) => {
    const dir = path.join(agentDir(t.root, P, A), "workbenches", id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), PACKAGE);
    await fs.writeFile(path.join(dir, "index.ts"), source);
    return dir;
  };
  const reload = async (id: string): Promise<WorkbenchInfo> => {
    const res = await admin.post(`${BASE}/${id}/reload`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { workbench: WorkbenchInfo }).workbench;
  };
  /** A request to the `follow` workbench's handler. */
  const call = async <T>(route: string, sessionId = ""): Promise<T> => {
    const res = await admin.post(`${BASE}/follow/api${route}?session=${sessionId}`, {});
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as T;
  };

  beforeAll(async () => {
    mock = await startMockLLM();
    t = await createTestApp({ titles: { maybeGenerate: () => {} }, log: (l) => lines.push(l) });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const models = await admin.put(`/api/projects/${P}/models`, {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [
        {
          provider: "custom",
          modelId: MOCK_MODEL_ID,
          clientType: "ant-messages",
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
      ],
    });
    expect(models.status, await models.text()).toBe(200);
    await writeWorkbench("follow", FOLLOW);
    expect((await reload("follow")).error).toBeNull();
  }, 30_000);
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  it("hands the handler exactly what the cookie door streams, task_begin to task_end, in order", async () => {
    const { sessionId } = await call<{ sessionId: string }>("/open");
    const stream = readAmsp((await admin.get(`/api/sessions/${sessionId}/amsp`)).body!);
    // The first beat is written once the stream listens.
    expect((await stream.next()).value).toEqual({ kind: "control", control: { kind: "ping" } });
    await call("/follow", sessionId);
    const streamed: AmspRecord[] = [];
    for (;;) {
      const next = await stream.next();
      if (next.done) throw new Error("the stream ended first");
      if (next.value.kind !== "record") continue;
      streamed.push(next.value.record);
      if (next.value.record.origin === undefined && kindOf(next.value.record) === "task_end") break;
    }
    await stream.return(undefined);

    let seen: WorkbenchRecord[] = [];
    for (let i = 0; i < 100 && seen.length < streamed.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 20));
      seen = await call<WorkbenchRecord[]>("/seen");
    }
    expect(seen.slice(0, streamed.length)).toEqual(streamed);
    const kinds = streamed.map(kindOf);
    expect(kinds).toContain("task_begin");
    expect(kinds.some((k) => k.startsWith("partial_"))).toBe(true);
    expect(kinds.at(-1)).toBe("task_end");
    expect(kinds.indexOf("task_begin")).toBeLessThan(kinds.indexOf("request_begin"));
    // The listener that threw on every record was logged once, and the other one got them all.
    expect(lines.filter((l) => l.includes("the listener failed: listener failed"))).toHaveLength(1);
  });

  it("refuses a Session of another Project like every other host call", async () => {
    const foreign = uniqueSessionId();
    adoptSession(t.deps, fakeSession(foreign), { projectId: "elsewhere" });
    expect(await call("/try", foreign)).toBe(`subscribe: this Project has no Session '${foreign}'`);
  });

  it("unsubscribing twice is harmless and ends only that subscription", async () => {
    const { sessionId } = await call<{ sessionId: string }>("/open");
    const channel = t.deps.channels.get(sessionId);
    await call("/watch", sessionId);
    await call("/watch", sessionId);
    expect(channel.subscriberCount).toBe(2);
    await call("/stop");
    expect(channel.subscriberCount).toBe(1);
    await call("/stop");
    expect(channel.subscriberCount).toBe(1);
  });

  it("a reload ends every subscription of the tree it replaces, forgotten ones included", async () => {
    const { sessionId } = await call<{ sessionId: string }>("/open");
    const channel = t.deps.channels.get(sessionId);
    await call("/watch", sessionId);
    expect(await call("/try", sessionId)).toBe("subscribed");
    expect(channel.subscriberCount).toBe(2);
    expect((await reload("follow")).error).toBeNull();
    expect(channel.subscriberCount).toBe(0);
  });

  it("still loads a workbench whose .harness/ was written before subscribe existed", async () => {
    const dir = await writeWorkbench("plain", PLAIN);
    expect((await reload("plain")).error).toBeNull();
    // Turn the types its first load wrote into the ones a harness without subscribe wrote.
    const tableFile = path.join(dir, ".harness", "ifaces.json");
    const table = JSON.parse(await fs.readFile(tableFile, "utf8")) as IfaceTable;
    expect(table.ifaces[HOST_KEY]!.methods).toHaveProperty("subscribe");
    delete table.ifaces[HOST_KEY]!.methods["subscribe"];
    delete table.types[RECORD_KEY];
    await fs.writeFile(tableFile, JSON.stringify(table));
    const typesFile = path.join(dir, ".harness", "plugin.d.ts");
    const types = (await fs.readFile(typesFile, "utf8"))
      .replace(/^.*\bsubscribe: .*\n/m, "")
      .replace(/^export type WorkbenchRecord = .*\n/m, "");
    expect(types).not.toContain("WorkbenchRecord");
    await fs.writeFile(typesFile, types);

    expect((await reload("plain")).error).toBeNull();
    expect(await (await admin.get(`${BASE}/plain/api/`)).json()).toBe("plain");
  });
});

describe("WorkbenchSubscriptions", () => {
  it("ends a subscription whose Session sat idle and silent through the idle window, never a running or publishing one", () => {
    let now = 0;
    let status = "running";
    const lines: string[] = [];
    const channel = new Channel();
    const subscriptions = new WorkbenchSubscriptions({
      channels: { get: () => channel },
      statusOf: () => status,
      now: () => now,
      log: (l) => lines.push(l),
    });
    subscriptions.subscribe("s", () => {});
    now += IDLE_RELEASE_MS;
    subscriptions.sweep();
    expect(channel.subscriberCount).toBe(1);
    status = "idle";
    // Anything the channel publishes counts, a server event included.
    channel.publish({ type: "task_state", state: "idle" }, "server_event");
    now += IDLE_RELEASE_MS - 1;
    subscriptions.sweep();
    expect(channel.subscriberCount).toBe(1);
    now += 1;
    subscriptions.sweep();
    expect(channel.subscriberCount).toBe(0);
    expect(lines).toHaveLength(1);
    subscriptions.close();
  });
});
