import { parseManifest } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../src/plugin/host.js";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, type TestApp } from "./helpers.js";
import type {
  Capability,
  CapabilityArtifact,
  CapabilityResult,
  CapabilitySettings,
  ToolModelSettings,
  ProjectCreateResponse,
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
// A 16 kHz, mono, signed PCM wave with four samples, including its real data chunk.
const wav = Buffer.from(
  "524946462c00000057415645666d74201000000001000100803e0000007d000002001000646174610800000000000100ffff0000",
  "hex",
);
const wavBase64 = wav.toString("base64");
const fixtureProvider = "@tests/media";
const speechProvider = "@tests/speech";
function addFixture(host: PluginHost, specifier: string, name: string, keys: string[]) {
  const manifest = parseManifest({
    name,
    contributes: {
      "ModelCapabilitiesProvider.capabilities": keys.map((key) => ({
        id: name + "." + key,
        key,
        title: { en: key.toUpperCase(), zh: "测试 " + key },
      })),
    },
  });
  host.use({ specifier, modules: [{ manifest, create: () => ({ api: {} }) }], replaces: [] });
}
const bindings = Object.fromEntries(
  Object.entries(ids).map(([key, modelId]) => [key, { provider: "custom", modelId }]),
);
const usage = { cached_tokens: 2, prompt_tokens: 7, thoughts_tokens: 5, response_tokens: 3 };
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
    path?: string;
  }[] = [];
  beforeAll(async () => {
    upstream = createServer(async (req, res) => {
      const data = [];
      for await (const chunk of req) data.push(chunk);
      const wire = JSON.parse(Buffer.concat(data).toString());
      received.push({ ...wire, auth: req.headers.authorization, path: req.url });
      if (wire.messages[0].content_items[0].text === "wait") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": waiting\n\n");
        return;
      }
      const input = wire.messages[0].content_items[0].text;
      if (
        input === "EmptyResponseError" ||
        input === "IncompleteStreamError" ||
        input === "missing usage error"
      ) {
        const error = {
          type: input === "missing usage error" ? "IncompleteStreamError" : input,
          message: "The upstream response ended",
          client: "OpenAIChatClient",
          usage_metadata: input === "missing usage error" ? null : { ...usage, amount: 0.05 },
        };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("data: " + JSON.stringify({ error }) + "\n\ndata: [DONE]\n\n");
        return;
      }
      const key =
        wire.model === "gemini-3.1-flash-image"
          ? "image"
          : Object.entries(ids).find(([, model]) => model === wire.model)?.[0];
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
          usage_metadata: input === "no meter" ? null : { ...usage, amount: 0.02 },
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
    const host = new PluginHost();
    addFixture(host, fixtureProvider, "TestMediaProvider", [...Object.keys(ids), "t2t", "i2t"]);
    addFixture(host, speechProvider, "TestSpeechProvider", ["tts"]);
    app = await createTestApp({ plugins: host });
    await app.deps.projectConfigService.setPluginTables("default_project", {
      all: { [fixtureProvider]: {} },
      machines: {},
    });
    api = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    const configured = await api.put(base + "/models", {
      defaultModel: { provider: "custom", modelId: "gpt-6.2-sol" },
      providers: { custom: { clientType: "mmsp", baseUrl: endpoint, apiKey: "local-test" } },
      models: ["gpt-6.2-sol", ...Object.values(ids)].map((modelId) => ({
        modelId,
        provider: "custom",
        ...(modelId === "gpt-6.2-sol"
          ? { pricing: { cacheRead: 1, cacheWrite: 2, output: 3 } }
          : {}),
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
    expect(settings.dictationFormat).toBe("audio/wav");
    expect(settings.candidates.chat).toEqual([{ provider: "custom", modelId: "gpt-6.2-sol" }]);
    expect((await api.patch(tools, { bindings: { stt: bindings.tts } })).status).toBe(400);
    expect(
      (await api.post(tools + "/stt/run", { audio: { data: "bad", mimeType: "audio/wav" } }))
        .status,
    ).toBe(400);
  });
  // A project with both DeepSeek ASR listings must send dictation, CLI and probe traffic
  // to the selected provider, with that provider's key and native audio endpoint.
  it("transcribes and tests the TokenDance preset with the gateway key", async () => {
    const projectId = "asr_" + crypto.randomUUID().slice(0, 8);
    expect((await api.post("/api/projects", { projectId, name: "Transcription" })).status).toBe(
      201,
    );
    await app.deps.projectConfigService.setPluginTables(projectId, {
      all: { [fixtureProvider]: {} },
      machines: {},
    });
    const project = "/api/projects/" + projectId;
    const models = project + "/models";
    const capabilities = project + "/capabilities";
    const model = { provider: "tokendance", modelId: "deepseek-asr" };
    const official = { provider: "deepseek", modelId: "deepseek-asr" };
    for (const provider of [model.provider, official.provider]) {
      expect(
        (await api.put(models + "/providers/" + provider, { apiKey: provider + "-test-key" }))
          .status,
      ).toBe(200);
    }
    const selected = await api.patch(capabilities + "/tools", { bindings: { s2t: model } });
    expect(selected.status, await selected.clone().text()).toBe(200);
    expect(await selected.json()).toMatchObject({
      bindings: { s2t: model },
      candidates: { s2t: expect.arrayContaining([model, official]) },
      dictationFormat: "audio/wav",
    });
    const audio = { data: wavBase64, mimeType: "audio/wav" };
    const upstream = stubFetch((call) =>
      call.headers.get("authorization") === "Bearer tokendance-test-key"
        ? jsonResponse({ text: "Transcribed", duration_ms: 3200 })
        : jsonResponse({ error: { message: "Invalid TokenDance key" } }, 401),
    );
    try {
      const reply = await api.post(capabilities + "/stt/run", { audio });
      expect(await reply.json()).toMatchObject({
        model,
        text: "Transcribed",
        usage: { prompt_tokens: 4 },
        inputMeter: { unit: "billed_audio_second", quantity: 4 },
      });
      const usageReply = await api.get(capabilities + "/usage");
      const [asr] = (
        (await usageReply.json()) as { runs: { estimatedCost: { minimumUsd: number } }[] }
      ).runs;
      expect(asr!.estimatedCost.minimumUsd).toBeCloseTo(0.0004 / 7, 14);
      const cli = await api.post(capabilities + "/cli", { args: ["stt", "sample.wav"], audio });
      const started = (await cli.json()) as { result: { id: string } };
      expect(started).toMatchObject({ kind: "run", detached: false, result: { model } });
      await expect
        .poll(async () => (await api.get(capabilities + "/runs/" + started.result.id)).json())
        .toMatchObject({ model, text: "Transcribed" });
      const probe = await api.post(models + "/test", model);
      expect(await probe.json()).toMatchObject({ ok: true });
      expect(upstream.calls).toHaveLength(3);
      for (const [index, call] of upstream.calls.entries()) {
        expect(call.url).toBe("https://tokendance.space/gateway/deepseek/v1/tools/asr");
        expect(call.headers.get("authorization")).toBe("Bearer tokendance-test-key");
        const form = await new Response(call.bytes, { headers: call.headers }).formData();
        const file = form.get("file") as File;
        const bytes = Buffer.from(await file.arrayBuffer());
        if (index < 2) expect(bytes).toEqual(wav);
        else expect(bytes.toString("ascii", 0, 4)).toBe("OggS");
      }
      const rejected = await api.post(models + "/test", { ...model, apiKey: "invalid-test-key" });
      expect(await rejected.json()).toMatchObject({
        ok: false,
        message: expect.stringContaining("Invalid TokenDance key"),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects WebM labelled as WAVE before sending the audio to a DeepSeek ASR gateway", async () => {
    const before = received.length;
    const audio = {
      mimeType: "audio/wav",
      data: Buffer.from("1a45dfa3", "hex").toString("base64"),
    };
    const r = await api.post(tools + "/stt/run", { audio });
    expect(r.status).toBe(415);
    expect(await r.json()).toMatchObject({ error: { code: "unsupported_transcription_audio" } });
    expect(received.length).toBe(before);
  });
  it("uses project credentials, preserves exact model metering and serves files only to project members", async () => {
    const payloads: Record<Capability, Record<string, unknown>> = {
      search: { text: "penguins", count: 2 },
      fetch: { url: "https://penguin.ooo/" },
      image: { text: "a penguin", resolution: "1K" },
      video: { text: "wave", duration: 5 },
      tts: { text: "Hello", voice: "demo" },
      stt: { audio: { data: wavBase64, mimeType: "audio/wav" } },
    };
    for (const [key, input] of Object.entries(payloads)) {
      const response = await api.post(tools + "/" + key + "/run", { ...input, sessionId });
      expect(response.status, await response.clone().text()).toBe(200);
      const run = (await response.json()) as CapabilityResult;
      expect(run.model).toEqual(bindings[key]);
      expect(run.usage).toEqual(usage);
      expect(run.sessionId).toBe(sessionId);
      expect(received.at(-1)?.config.session_id).toBe(sessionId);
      expect(run.measurements).toContainEqual({ unit: "request", quantity: 1 });
      if (key === "search" || key === "fetch")
        expect(run.sources?.[0]?.url).toBe("https://penguin.ooo/");
      if (key === "stt") {
        expect(run.text).toBe("Recorded words");
        expect(received.at(-1)?.messages[0]?.content_items[0]?.data).toBe(wavBase64);
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
    expect(received.at(-1)?.config.session_id).toBe(sessionId);
    expect(((await edited.json()) as { text: string }).text).toBe("Edited words");
    const history = (await (await api.get(tools + "/usage?sessionId=" + sessionId)).json()) as {
      runs: CapabilityResult[];
    };
    expect(history.runs).toHaveLength(7);
    expect(history.runs[0]).toMatchObject({
      capability: "voice-polish",
      usage,
      inputMeter: { unit: "token", quantity: 7 },
      estimatedCost: { minimumUsd: 0.00004, maximumUsd: 0.00004 },
    });
    expect(history.runs[0]?.usage).toEqual(usage);
    expect(JSON.stringify(history)).not.toMatch(/local-test|Edited words|\bcost\b/);
  });
  it("sends no MMSP Session ID for standalone tools or transcript editing", async () => {
    const last = received.length;
    expect((await api.post(tools + "/search/run", { text: "standalone query" })).status).toBe(200);
    expect((await api.post(base + "/voice-polish", { text: "standalone draft" })).status).toBe(200);
    const standalone = received.slice(last);
    expect(standalone.map((call) => call.model)).toEqual([ids.search, "gpt-6.2-sol"]);
    for (const call of standalone) expect(call.config).not.toHaveProperty("session_id");
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
  it("keeps four buckets on failed remote MMSP requests, including failed voice polishing", async () => {
    const meter = { unit: "token", quantity: usage.prompt_tokens };
    for (const error of ["EmptyResponseError", "IncompleteStreamError", "missing usage error"]) {
      const reply = await api.post(base + "/voice-polish", { text: error, sessionId });
      expect(reply.status).toBe(502);
      const rows = (await (await api.get(tools + "/usage?sessionId=" + sessionId)).json()) as {
        runs: CapabilityResult[];
      };
      expect(rows.runs[0]).toMatchObject({
        status: "failed",
        capability: "voice-polish",
        measurements: [],
        usage: error === "missing usage error" ? null : usage,
      });
      expect(rows.runs[0]?.inputMeter).toEqual(error === "missing usage error" ? undefined : meter);
      expect(rows.runs[0]?.usage).toEqual(error === "missing usage error" ? null : usage);
      expect(rows.runs[0]).toMatchObject({
        estimatedCost:
          error === "missing usage error" ? null : { minimumUsd: 0.00004, maximumUsd: 0.00004 },
      });
    }
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
  it("shares the eight project bindings with image reading and transcript editing without changing the chat model", async () => {
    const chosen = { provider: "custom", modelId: "gpt-6.2-sol" };
    const read = async () => (await (await api.get(tools + "/tools")).json()) as ToolModelSettings;
    const initial = await read();
    expect(Object.keys(initial.candidates).sort()).toEqual([
      "fetch",
      "i2t",
      "s2t",
      "search",
      "t2i",
      "t2s",
      "t2t",
      "t2v",
    ]);
    expect(initial.bindings.t2t).toEqual(chosen);
    expect(initial.bindings.t2s).toEqual(bindings.tts);
    expect(initial.candidates.i2t).toContainEqual(chosen);
    expect(initial.candidates.t2t).not.toContainEqual(bindings.stt);
    const update = await api.patch(tools + "/tools", { bindings: { i2t: chosen } });
    expect(update.status, await update.clone().text()).toBe(200);
    expect(await (await api.get(base + "/models")).json()).toMatchObject({
      visionModel: chosen,
      defaultModel: chosen,
    });
    const text = await api.post(tools + "/t2t/run", { text: "Rewrite this", sessionId });
    expect(text.status, await text.clone().text()).toBe(200);
    const image = { data: "iVBORw0KGgo=", mimeType: "image/png" };
    const caption = await api.post(tools + "/i2t/run", { image, text: "What is here?", sessionId });
    expect(caption.status, await caption.clone().text()).toBe(200);
    expect((await caption.json()) as CapabilityResult).toMatchObject({
      model: chosen,
      text: "Edited words",
    });
    expect(received.at(-1)).toMatchObject({
      messages: [{ content_items: [{ text: "What is here?" }, { data: image.data }] }],
    });
    const cleared = await api.patch(tools + "/tools", { bindings: { i2t: null, t2t: null } });
    expect(cleared.status).toBe(200);
    expect((await read()).voicePolish.enabled).toBe(false);
    expect((await api.post(tools + "/i2t/run", { image })).status).toBe(409);
    expect(await (await api.get(base + "/models")).json()).not.toHaveProperty("visionModel");
    expect(
      (
        await api.patch(tools + "/tools", {
          bindings: { t2t: chosen },
          voicePolish: { enabled: true },
        })
      ).status,
    ).toBe(200);
  });
  it("keeps one binding per capability per Project, including simultaneous saves", async () => {
    const created = await api.post("/api/projects", {
      projectId: "scope_test",
      name: "Second library",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { project } = (await created.json()) as ProjectCreateResponse;
    await app.deps.projectConfigService.setPluginTables(project.projectId, {
      all: { [fixtureProvider]: {} },
      machines: {},
    });
    const other = "/api/projects/" + project.projectId;
    const otherTools = other + "/capabilities";
    const replacement = { provider: "custom", modelId: "gemini-3.1-flash-image" };
    const models = [...Object.values(bindings), replacement];
    expect(
      (
        await api.put(other + "/models", {
          providers: {
            custom: { clientType: "mmsp", baseUrl: endpoint + "/second", apiKey: "second-project" },
          },
          models,
        })
      ).status,
    ).toBe(200);
    const settings = async (path: string) =>
      (await (await api.get(path)).json()) as CapabilitySettings;
    expect((await settings(otherTools)).bindings).toEqual({});
    const unbound = await api.post(otherTools + "/image/run", { text: "no fallback" });
    expect(unbound.status).toBe(409);
    const writes = await Promise.all(
      Object.entries(bindings).map(([key, ref]) =>
        api.patch(otherTools, { bindings: { [key]: ref } }),
      ),
    );
    expect(writes.every((r) => r.ok)).toBe(true);
    expect((await settings(otherTools)).bindings).toEqual(bindings);
    expect((await api.patch(otherTools, { bindings: { image: replacement } })).status).toBe(200);
    expect((await settings(otherTools)).bindings).toEqual({ ...bindings, image: replacement });
    expect((await settings(tools)).bindings).toEqual(bindings);
    expect((await api.patch(tools, { bindings: { image: replacement } })).status).toBe(400);
    for (const [path, expected, credential, endpointPath] of [
      [tools, ids.image, "local-test", "/v1/stream"],
      [otherTools, replacement.modelId, "second-project", "/v1/second/stream"],
    ] as const) {
      const response = await api.post(path + "/image/run", { text: "an independent image" });
      expect(response.status).toBe(200);
      const run = (await response.json()) as CapabilityResult;
      expect(run.model.modelId).toBe(expected);
      expect(received.at(-1)).toMatchObject({
        model: expected,
        auth: "Bearer " + credential,
        path: endpointPath,
      });
      const otherPath = path === tools ? otherTools : tools;
      expect((await api.get(otherPath + "/runs/" + run.id)).status).toBe(404);
      expect((await api.get(otherPath + "/artifacts/" + run.artifacts[0]!.id)).status).toBe(404);
    }
  });
  it("uses the Project's optional instructions only for voice polishing and restores the built-in prompt", async () => {
    const settings = async (project: string = tools) =>
      (await (await api.get(project + "/tools")).json()) as ToolModelSettings;
    const defaults = (await settings()).voicePolish;
    expect(defaults.prompt).toBe(defaults.defaultPrompt);
    const custom = "Keep the speaker's punctuation.\n保留中英文混排。";
    expect((await api.patch(tools + "/tools", { voicePolish: { prompt: custom } })).status).toBe(
      200,
    );
    expect((await settings()).voicePolish.prompt).toBe(custom);
    expect((await settings("/api/projects/scope_test/capabilities")).voicePolish.prompt).toBe(
      defaults.defaultPrompt,
    );
    const edited = await api.post(base + "/voice-polish", { text: "raw transcript" });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(received.at(-1)?.config).toMatchObject({
      system_prompt: custom,
      thinking_level: "none",
    });
    await api.post(tools + "/t2t/run", { text: "ordinary text" });
    expect(received.at(-1)?.config).not.toHaveProperty("thinking_level");
    expect(received.at(-1)?.config.system_prompt).toBeUndefined();
    expect(
      (await api.patch(tools + "/tools", { voicePolish: { prompt: "x".repeat(8001) } })).status,
    ).toBe(400);
    expect((await settings()).voicePolish.prompt).toBe(custom);
    expect((await api.patch(tools + "/tools", { voicePolish: { prompt: null } })).status).toBe(200);
    expect((await settings()).voicePolish.prompt).toBe(defaults.defaultPrompt);
    await api.post(base + "/voice-polish", { text: "raw transcript" });
    expect(received.at(-1)?.config.system_prompt).toBe(defaults.defaultPrompt);
    await api.patch(tools + "/tools", { voicePolish: { enabled: false } });
    const before = received.length;
    expect((await api.post(base + "/voice-polish", { text: "raw transcript" })).status).toBe(409);
    expect(received).toHaveLength(before);
    await api.patch(tools + "/tools", { voicePolish: { enabled: true } });
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
  it("discovers and runs only this Project's active contributions, retaining history and bindings across disable", async () => {
    const project = app.deps.projectConfigService;
    const configure = (all: Record<string, {}>) =>
      project.setPluginTables("default_project", { all, machines: {} });
    try {
      await configure({ [speechProvider]: {} });
      const partial = (await (await api.get(tools)).json()) as CapabilitySettings;
      expect(partial.available).toEqual([
        { key: "tts", package: speechProvider, title: { en: "TTS", zh: "测试 tts" } },
      ]);
      expect(partial.candidates.tts.length).toBeGreaterThan(0);
      expect(partial.candidates.image).toEqual([]);
      const help = (await (
        await api.post(tools + "/cli", { args: ["--help"], language: "zh" })
      ).json()) as { stdout: string };
      expect(help.stdout).toContain("调用项目插件提供的模型工具");
      expect(help.stdout).toContain("测试 tts");
      expect(help.stdout).not.toContain("image <prompt>");
      const before = received.length;
      expect((await api.post(tools + "/image/run", { text: "hidden" })).status).toBe(409);
      expect(received).toHaveLength(before);
      expect((await api.patch(tools, { bindings: { image: bindings.image } })).status).toBe(409);
      const spoken = await api.post(tools + "/tts/run", { text: "scope proof" });
      expect(spoken.status, await spoken.clone().text()).toBe(200);
      const id = ((await spoken.json()) as CapabilityResult).id;
      await configure({});
      expect(((await (await api.get(tools)).json()) as CapabilitySettings).available).toEqual([]);
      const absent = (await (await api.post(tools + "/cli", { args: ["tts", "none"] })).json()) as {
        exitCode: number;
        stderr: string;
      };
      expect(absent.exitCode).toBe(2);
      expect(absent.stderr).toContain("No enabled plugin");
      expect((await api.get(tools + "/runs/" + id)).status).toBe(200);
      expect((await api.get(tools + "/usage")).status).toBe(200);
      expect((await api.post(tools + "/tts/run", { text: "off" })).status).toBe(409);
      await configure({ [speechProvider]: {} });
      expect(((await (await api.get(tools)).json()) as CapabilitySettings).bindings.tts).toEqual(
        bindings.tts,
      );
    } finally {
      await configure({ [fixtureProvider]: {} });
      received.length = 0;
    }
  });
  it("lets an ordinary member start, inspect and cancel a long command without granting access to other Projects", async () => {
    const { user, cookie } = await provisionUser(app.app, "model_tool_member");
    const member = apiClient(app.app, cookie);
    expect((await member.post(tools + "/cli", { args: ["list"] })).status).toBe(404);
    expect((await api.post(base + "/members", { userId: user.userId })).ok).toBe(true);
    const answer = await member.post(tools + "/cli", {
      args: ["video", "wait", "--detach", "--json"],
      sessionId,
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { result } = (await answer.json()) as { result: CapabilityResult };
    expect(result.status).toBe("running");
    const info = await member.post(tools + "/cli", {
      args: ["status", result.id, "--json"],
      sessionId,
    });
    expect(((await info.json()) as { result: CapabilityResult }).result.status).toBe("running");
    const cancel = await member.post(tools + "/cli", { args: ["cancel", result.id], sessionId });
    expect(((await cancel.json()) as { result: CapabilityResult }).result.status).toBe("cancelled");
    expect((await member.patch(tools, { bindings: { video: bindings.video } })).status).toBe(403);
    received.length = 0;
  });
});
