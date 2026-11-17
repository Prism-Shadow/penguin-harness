import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin, provisionUser, type TestApp } from "./helpers.js";
import type {
  Capability,
  CapabilityArtifact,
  CapabilityResult,
  CapabilitySettings,
  SessionCreateResponse,
} from "../src/api/types.js";

const ids = {
  search: "deepseek-search",
  fetch: "deepseek-fetch",
  image: "gpt-image-2.5-flare",
  video: "gemini-omni-1.2-flash",
  tts: "deepseek-tts",
  stt: "deepseek-asr",
} as const;
const bindings = Object.fromEntries(
  Object.entries(ids).map(([key, modelId]) => [key, { provider: "custom", modelId }]),
);
const usage = { cached_tokens: 0, prompt_tokens: 7, thoughts_tokens: null, response_tokens: 3 };
const base = "/api/projects/default_project";
const tools = base + "/capabilities";

describe("project model capabilities", () => {
  let app: TestApp,
    upstream: Server,
    api: ReturnType<typeof apiClient>,
    sessionId: string,
    endpoint: string;
  const received: {
    model: string;
    config: Record<string, unknown>;
    messages: { content_items: { text?: string; data?: string }[] }[];
    auth?: string;
  }[] = [];
  beforeAll(async () => {
    upstream = createServer(async (req, res) => {
      const data = [];
      for await (const chunk of req) data.push(chunk);
      const wire = JSON.parse(Buffer.concat(data).toString());
      received.push({ ...wire, auth: req.headers.authorization });
      if (wire.messages[0].content_items[0].text === "wait") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": waiting\n\n");
        return;
      }
      const input = wire.messages[0].content_items[0].text;
      const key = Object.entries(ids).find(([, model]) => model === wire.model)?.[0];
      const item =
        input === "no image"
          ? { type: "text.done", text: "unavailable" }
          : key === "fetch" || key === "search"
            ? {
                type: "webtool.done",
                webdata: [{ title: "Penguin", url: "https://penguin.ooo/", content: "Page text" }],
              }
            : key === "image" || key === "video" || key === "tts"
              ? {
                  type: "inline_data.done",
                  mime_type:
                    key === "image"
                      ? "image/png"
                      : key === "video"
                        ? "video/mp4"
                        : "audio/l16; rate=16000; channels=1",
                  data: Buffer.from([0, 1, 2, 3]).toString("base64"),
                }
              : { type: "text.done", text: key === "stt" ? "Recorded words" : "Edited words" };
      const events = [
        {
          role: "assistant",
          event_type: "delta",
          content_items: [item],
          usage_metadata: null,
          finish_reason: null,
        },
        {
          role: "assistant",
          event_type: "stop",
          content_items: [],
          usage_metadata: input === "no meter" ? null : usage,
          finish_reason: "stop",
        },
      ];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",
      );
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("listener missing");
    endpoint = "http://127.0.0.1:" + address.port + "/v1";
    app = await createTestApp();
    api = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    const configured = await api.put(base + "/models", {
      defaultModel: { provider: "custom", modelId: "gpt-6.2-sol" },
      providers: { custom: { clientType: "mmsp", baseUrl: endpoint, apiKey: "local-test" } },
      models: ["gpt-6.2-sol", ...Object.values(ids)].map((modelId) => ({
        modelId,
        provider: "custom",
      })),
    });
    expect(configured.status).toBe(200);
    const session = await api.post(base + "/agents/default_agent/sessions", {});
    expect(session.status).toBe(201);
    sessionId = ((await session.json()) as SessionCreateResponse).session.sessionId;
    const saved = await api.patch(tools, {
      bindings,
      voicePolish: { enabled: true, model: { provider: "custom", modelId: "gpt-6.2-sol" } },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
  });
  afterAll(async () => {
    upstream?.closeAllConnections();
    upstream?.close();
    await app?.cleanup();
  });
  it("advertises eligible project models and rejects an incompatible assignment", async () => {
    const settings = (await (await api.get(tools)).json()) as CapabilitySettings;
    expect(settings.bindings).toEqual(bindings);
    expect(settings.candidates.chat).toEqual([{ provider: "custom", modelId: "gpt-6.2-sol" }]);
    expect((await api.patch(tools, { bindings: { stt: bindings.tts } })).status).toBe(400);
    expect(
      (await api.post(tools + "/stt/run", { audio: { data: "bad", mimeType: "audio/wav" } }))
        .status,
    ).toBe(400);
  });
  it("uses project credentials, preserves exact model metering and serves files only to project members", async () => {
    const payloads: Record<Capability, Record<string, unknown>> = {
      search: { text: "penguins", count: 2 },
      fetch: { url: "https://penguin.ooo/" },
      image: { text: "a penguin", resolution: "1K" },
      video: { text: "wave", duration: 5 },
      tts: { text: "Hello", voice: "demo" },
      stt: { audio: { data: "AAEC", mimeType: "audio/wav" } },
    };
    for (const [key, input] of Object.entries(payloads)) {
      const response = await api.post(tools + "/" + key + "/run", { ...input, sessionId });
      expect(response.status, await response.clone().text()).toBe(200);
      const run = (await response.json()) as CapabilityResult;
      expect(run.model).toEqual(bindings[key]);
      expect(run.usage).toEqual(usage);
      expect(run.sessionId).toBe(sessionId);
      expect(run.measurements).toContainEqual({ unit: "request", quantity: 1 });
      if (key === "search" || key === "fetch")
        expect(run.sources?.[0]?.url).toBe("https://penguin.ooo/");
      if (key === "stt") {
        expect(run.text).toBe("Recorded words");
        expect(received.at(-1)?.messages[0]?.content_items[0]?.data).toBe("AAEC");
      }
      if (run.artifacts.length) {
        const file = run.artifacts[0]!;
        const res = await api.get(file.url);
        expect(res.status).toBe(200);
        const bytes = Buffer.from(await res.arrayBuffer());
        if (key === "tts") {
          expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
          expect(bytes.readUInt32LE(24)).toBe(16000);
          expect(run.measurements).toContainEqual({ unit: "audio_second", quantity: 0.000125 });
        } else expect(bytes).toEqual(Buffer.from([0, 1, 2, 3]));
        expect((await app.app.request(file.url)).status).toBe(401);
      }
    }
    const { cookie } = await provisionUser(app.app, "outsider");
    const outsider = apiClient(app.app, cookie);
    expect((await outsider.get(tools + "/artifacts")).status).toBeGreaterThanOrEqual(400);
    expect((await api.get(tools + "/usage?sessionId=not-a-session")).status).toBe(404);
    const artifacts = (await (
      await api.get(tools + "/artifacts?sessionId=" + sessionId)
    ).json()) as { artifacts: CapabilityArtifact[] };
    expect(artifacts.artifacts).toHaveLength(3);
    expect(received.every((x) => x.auth === "Bearer local-test")).toBe(true);
    const edited = await api.post(base + "/voice-polish", {
      text: "um, Recorded words",
      sessionId,
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { text: string }).text).toBe("Edited words");
    const history = (await (await api.get(tools + "/usage?sessionId=" + sessionId)).json()) as {
      runs: CapabilityResult[];
    };
    expect(history.runs).toHaveLength(7);
    expect(JSON.stringify(history)).not.toMatch(/local-test|Edited words|\bcost\b/);
  });
  it("retains provider usage when media is missing and reports only observed units for unmetered calls", async () => {
    const response = await api.post(tools + "/image/run", { text: "no image", sessionId });
    expect(response.status).toBe(502);
    const history = (await (await api.get(tools + "/usage?sessionId=" + sessionId)).json()) as {
      runs: CapabilityResult[];
    };
    expect(history.runs[0]).toMatchObject({
      status: "failed",
      model: bindings.image,
      usage,
      artifacts: [],
      measurements: [{ unit: "request", quantity: 1 }],
    });
    const unmetered = await api.post(tools + "/search/run", { text: "no meter" });
    expect(unmetered.status).toBe(200);
    expect(await unmetered.json()).toMatchObject({
      usage: null,
      measurements: [{ unit: "request", quantity: 1 }],
    });
  });
  it("cancels a background video and keeps the terminal result", async () => {
    const queued = await api.post(tools + "/video/run", { text: "wait", async: true, sessionId });
    expect(queued.status).toBe(202);
    const start = (await queued.json()) as CapabilityResult;
    expect(start.status).toBe("running");
    const cancelled = await api.delete(tools + "/runs/" + start.id);
    expect(((await cancelled.json()) as CapabilityResult).status).toBe("cancelled");
    const status = await api.get(tools + "/runs/" + start.id);
    expect(((await status.json()) as CapabilityResult).artifacts).toEqual([]);
  });
  it("follows a model rekey and clears bindings whose models are subsequently deleted", async () => {
    const original = ["gpt-6.2-sol", ...Object.values(ids)].map((modelId) => ({
      modelId,
      provider: "custom",
    }));
    const options = {
      providers: { custom: { clientType: "mmsp", baseUrl: endpoint, apiKey: "local-test" } },
    };
    const added = {
      provider: "custom",
      modelId: "local-speech",
      clientType: "openai-speech",
      renamedFrom: bindings.tts,
    };
    try {
      expect(
        (
          await api.put(base + "/models", {
            ...options,
            models: [...original.filter((m) => m.modelId !== ids.tts), added],
          })
        ).status,
      ).toBe(200);
      const moved = (await (await api.get(tools)).json()) as CapabilitySettings;
      expect(moved.bindings.tts).toEqual({ provider: added.provider, modelId: added.modelId });
      expect(
        (
          await api.put(base + "/models", {
            ...options,
            models: original.filter((m) => m.modelId !== ids.tts && m.modelId !== "gpt-6.2-sol"),
          })
        ).status,
      ).toBe(200);
      const deleted = (await (await api.get(tools)).json()) as CapabilitySettings;
      expect(deleted.bindings.tts).toBeUndefined();
      expect(deleted.voicePolish).toEqual({ enabled: false, model: null });
    } finally {
      await api.put(base + "/models", {
        ...options,
        models: original,
        defaultModel: { provider: "custom", modelId: "gpt-6.2-sol" },
      });
      await api.patch(tools, {
        bindings,
        voicePolish: { enabled: true, model: { provider: "custom", modelId: "gpt-6.2-sol" } },
      });
    }
  });
});
