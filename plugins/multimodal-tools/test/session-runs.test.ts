/**
 * A Session's runs, as Image Studio follows them through the plugin's routes.
 *
 * - A run in flight is listed running; once stopped, it is listed cancelled and has no file.
 * - A completed image run is listed with its file, which the Session's files list and serve.
 * - Another Session's runs are not listed.
 */
import fs from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectAccess, SessionLookup } from "../src/host.js";
import { toolRoutes, type RouteEnv } from "../src/routes.js";
import { Tools } from "../src/tools.js";
import { answer, bindings, modelTable, PNG, scriptedModel, tempRoot } from "./helpers.js";

const PROJECT = "studio";
const IMAGE = { provider: "openai", modelId: "gpt-image-2.5-flare" };
const BASE = `/api/projects/${PROJECT}/multimodal-tools`;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

interface ListedRun {
  id: string;
  operation: string;
  status: string;
  files: { name: string }[];
}

async function setup() {
  const root = await tempRoot();
  roots.push(root);
  // The first brief hangs until it is stopped; the next ones are answered with an image.
  let calls = 0;
  const model = scriptedModel(() =>
    ++calls === 1
      ? { hang: true }
      : answer([{ type: "inline_data.done", mime_type: "image/png", data: PNG }]),
  );
  const sessions: SessionLookup = {
    findById: (id) => (["s-1", "s-2"].includes(id) ? { projectId: PROJECT } : null),
    listByProject: () => [{ sessionId: "s-1" }, { sessionId: "s-2" }],
  };
  const access: ProjectAccess = {
    requireProjectAccess: () => undefined,
    requireProjectOwner: () => undefined,
  };
  const tools = new Tools({
    requests: model,
    bindings: bindings({ t2i: IMAGE }),
    models: modelTable([{ ...IMAGE }]),
    root,
  });
  const app = new Hono<RouteEnv>();
  app.use(async (c, next) => {
    c.set("user", { userId: "u1", isAdmin: false });
    await next();
  });
  // Mounted as the host mounts it, under the Project's id.
  app.route(
    "/api/projects/:projectId/multimodal-tools",
    toolRoutes({ tools: () => tools, access, sessions }),
  );
  const runs = async (sessionId: string) =>
    (
      (await (await app.request(`${BASE}/sessions/${sessionId}/runs`)).json()) as {
        runs: ListedRun[];
      }
    ).runs;
  const post = (path: string, body: unknown) =>
    app.request(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, runs, post };
}

describe("a Session's runs", () => {
  it("lists a run in flight as running, and as cancelled once it is stopped", async () => {
    const { app, runs, post } = await setup();
    const started = await post("/t2i/run", {
      text: "a lighthouse",
      sessionId: "s-1",
      detach: true,
    });
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };
    expect(await runs("s-1")).toMatchObject([{ id, operation: "t2i", status: "running" }]);

    expect((await app.request(`${BASE}/runs/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(await runs("s-1")).toMatchObject([{ id, status: "cancelled", files: [] }]);
  });

  it("lists a completed image run with its file, which the Session's files serve", async () => {
    const { app, runs, post } = await setup();
    await post("/t2i/run", { text: "warm-up", sessionId: "s-2", detach: true });
    const done = await post("/t2i/run", { text: "a lighthouse", sessionId: "s-1" });
    expect(done.status).toBe(200);
    const [listed] = await runs("s-1");
    expect(listed).toMatchObject({ operation: "t2i", status: "completed" });
    const name = listed!.files[0]!.name;
    const file = await app.request(`${BASE}/sessions/s-1/files/${name}`);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
    const [other] = await runs("s-2");
    expect(other?.status).toBe("running");
    await app.request(`${BASE}/runs/${other!.id}`, { method: "DELETE" });
  });
});
