/**
 * Reading a reply aloud from the Web App, through the plugin's routes, against a scripted speech
 * model and a data root on disk.
 *
 * - The first press speaks the reply with the Project's speech model, as this plugin's
 *   `read-aloud` request of the Session; the audio plays from the route it answers.
 * - Pressing again in the Session plays the stored audio and asks the model nothing, whoever
 *   listens; two presses at once share one request.
 * - Another reply, another Session or another voice model is spoken anew.
 * - A synthesis that fails keeps nothing: the next press asks the model again.
 * - With no speech model bound, or no Session named, nothing is sent.
 * - The audio goes with its Session at the next sweep.
 */
import fs from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectAccess, SessionLookup } from "../src/host.js";
import { toolRoutes, type RouteEnv } from "../src/routes.js";
import { ToolStore } from "../src/store.js";
import { Tools } from "../src/tools.js";
import {
  answer,
  bindings,
  modelTable,
  scriptedModel,
  tempRoot,
  WAV,
  type Reply,
} from "./helpers.js";

const PROJECT = "research";
const SPEECH = { provider: "google", modelId: "gemini-3.8-flash-tts" };
const OTHER_VOICE = { provider: "openai", modelId: "gpt-voice-mini" };
const BASE = `/api/projects/${PROJECT}/multimodal-tools`;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

const speech: Reply = answer([{ type: "inline_data.done", mime_type: "audio/wav", data: WAV }]);

/** The plugin's routes mounted as the host mounts them, for whoever `user()` names. */
async function setup(reply: (text: string) => Reply, bound: Record<string, typeof SPEECH>) {
  const root = await tempRoot();
  roots.push(root);
  const model = scriptedModel((r) => {
    const item = r.request.messages[0]?.content_items[0];
    return reply(item?.type === "text.done" ? item.text : "");
  });
  const live = new Set(["s-1", "s-2"]);
  const sessions: SessionLookup = {
    findById: (id) => (live.has(id) ? { projectId: PROJECT } : null),
    listByProject: () => [...live].map((sessionId) => ({ sessionId })),
  };
  const access: ProjectAccess = {
    requireProjectAccess: () => undefined,
    requireProjectOwner: () => undefined,
  };
  const tools = new Tools({
    requests: model,
    bindings: bindings(bound),
    models: modelTable([{ ...SPEECH }, { ...OTHER_VOICE }]),
    root,
  });
  let userId = "owner";
  const app = new Hono<RouteEnv>();
  app.use(async (c, next) => {
    c.set("user", { userId, isAdmin: false });
    await next();
  });
  // Mounted as the host mounts it, under the Project's id.
  app.route(
    "/api/projects/:projectId/multimodal-tools",
    toolRoutes({ tools: () => tools, access, sessions }),
  );
  const read = (body: unknown, signal?: AbortSignal) =>
    app.request(`${BASE}/read-aloud`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    });
  return {
    root,
    model,
    app,
    read,
    live,
    as: (id: string) => void (userId = id),
  };
}

describe("reading a reply aloud", () => {
  it("speaks a reply once per Session and plays the stored audio after that, whoever listens", async () => {
    const { model, app, read, as } = await setup(() => speech, { t2s: SPEECH });
    const first = await read({ sessionId: "s-1", text: "The build is green." });
    expect(first.status).toBe(200);
    const spoken = (await first.json()) as { url: string; mimeType: string; model: typeof SPEECH };
    expect(spoken).toMatchObject({ mimeType: "audio/wav", model: SPEECH });
    expect(model.received).toHaveLength(1);
    expect(model.received[0]!.scope).toEqual({
      projectId: PROJECT,
      sessionId: "s-1",
      purpose: "@penguinharness/multimodal-tools:read-aloud",
    });
    expect(model.received[0]!.model).toEqual(SPEECH);

    const audio = await app.request(spoken.url);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(WAV);

    as("member");
    const again = (await (
      await read({ sessionId: "s-1", text: "The build is green." })
    ).json()) as {
      url: string;
    };
    expect(again.url).toBe(spoken.url);
    expect(model.received).toHaveLength(1);
  });

  it("shares one request between two presses at once", async () => {
    const { model, read } = await setup(() => speech, { t2s: SPEECH });
    const body = { sessionId: "s-1", text: "Two tabs, one reply." };
    const [a, b] = await Promise.all([read(body), read(body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(((await a.json()) as { url: string }).url).toBe(
      ((await b.json()) as { url: string }).url,
    );
    expect(model.received).toHaveLength(1);
  });

  it("speaks anew for another reply, another Session or another voice model", async () => {
    const bound = { t2s: SPEECH };
    const { model, read } = await setup(() => speech, bound);
    const urls = new Set<string>();
    for (const body of [
      { sessionId: "s-1", text: "First reply." },
      { sessionId: "s-1", text: "Second reply." },
      { sessionId: "s-2", text: "First reply." },
    ]) {
      urls.add(((await (await read(body)).json()) as { url: string }).url);
    }
    bound.t2s = OTHER_VOICE;
    urls.add(
      ((await (await read({ sessionId: "s-1", text: "First reply." })).json()) as { url: string })
        .url,
    );
    expect(urls.size).toBe(4);
    expect(model.received.map((r) => r.model)).toEqual([SPEECH, SPEECH, SPEECH, OTHER_VOICE]);
  });

  it("keeps nothing from a failed synthesis, so the next press asks again", async () => {
    let calls = 0;
    const { model, read } = await setup(
      () => (++calls === 1 ? answer([{ type: "text.done", text: "no audio" }]) : speech),
      { t2s: SPEECH },
    );
    const body = { sessionId: "s-1", text: "Try me twice." };
    const failed = await read(body);
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("missing_media");
    expect((await read(body)).status).toBe(200);
    expect(model.received).toHaveLength(2);
  });

  it("sends nothing without a speech model or without a Session", async () => {
    const unbound = await setup(() => speech, {});
    const refused = await unbound.read({ sessionId: "s-1", text: "Hello." });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "model_unbound",
    );
    const bound = await setup(() => speech, { t2s: SPEECH });
    expect((await bound.read({ text: "Hello." })).status).toBe(400);
    expect((await bound.read({ sessionId: "s-9", text: "Hello." })).status).toBe(404);
    expect(unbound.model.received).toHaveLength(0);
    expect(bound.model.received).toHaveLength(0);
  });

  it("goes with its Session at the next sweep", async () => {
    const { root, app, read, live } = await setup(() => speech, { t2s: SPEECH });
    const { url } = (await (await read({ sessionId: "s-1", text: "Short-lived." })).json()) as {
      url: string;
    };
    live.delete("s-1");
    await new ToolStore(root).sweep((_, sessionId) => live.has(sessionId), new Set());
    live.add("s-1");
    expect((await app.request(url)).status).toBe(404);
  });
});
