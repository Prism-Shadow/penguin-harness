/**
 * The shipped multimodal tools plugin, booted from its built package (its bundle and its generated
 * `ifaces.json`) into a server, against a loopback MMSP server.
 *
 * - The server boots it: what its modules require of the host is satisfied, and its seven
 *   bindings are listed under the package, each with the configured models it accepts.
 * - A Session's Agent runs `penguin tools t2i` as a member command: the image comes back as a file
 *   for the terminal, the request is billed to the Session under the plugin's purpose, and the
 *   Web App downloads the same file from the Session's file list.
 * - A tool nobody bound refuses without a request, and a member who is not the owner runs the
 *   commands too.
 * - Transcript editing runs on the Project's default chat model while nothing is bound to text
 *   generation, once an owner turns it on, asking the model for no thinking.
 * - "Test connection" sends a tool model the request its binding names: a recording to a speech
 *   recognizer and a page address to a page reader, without the chat probe's knobs; a chat
 *   model still gets the chat probe.
 * - Once the Session is deleted, the next boot removes its files.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { projectDir, readPluginTable } from "@prismshadow/penguin-core";
import { moduleDefOf, type ModuleClass } from "@prismshadow/penguin-core/kernel";
import type { ToolModelBindingsResponse } from "@prismshadow/penguin-library-model";
import type { PluginCliCommandRunResponse, SessionCreateResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  restartTestApp,
  type TestApp,
} from "./helpers.js";
import { startMmspServer, textReply, type MmspServer } from "./fixtures/mmsp-server.js";

const PACKAGE = "@penguinharness/multimodal-tools";
const PLUGIN_DIR = fileURLToPath(new URL("../../../plugins/multimodal-tools/", import.meta.url));
const PROJECT = "default_project";
const BASE = `/api/projects/${PROJECT}`;
// Ids MMSP's registry lists, so a binding judges them by what they return.
const IMAGE = { provider: "custom", modelId: "gpt-image-2.5-flare" };
const CHAT = { provider: "custom", modelId: "deepseek-v4-pro" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const USAGE = { cached_tokens: 0, prompt_tokens: 12, thoughts_tokens: 0, response_tokens: 4096 };

/** The plugin as the loader hands it to the host: its classes paired with their generated manifests. */
async function shippedPlugin(): Promise<PluginHost> {
  const table = readPluginTable(PLUGIN_DIR);
  if (table === null) throw new Error(`${PLUGIN_DIR} has no ifaces.json: build the plugin first`);
  const entry: string = pathToFileURL(path.join(PLUGIN_DIR, "dist", "index.js")).href;
  const { default: plugin } = (await import(entry)) as { default: { modules: ModuleClass[] } };
  const host = new PluginHost();
  host.use({
    specifier: PACKAGE,
    modules: plugin.modules.map((cls) => moduleDefOf(cls, { manifests: table.manifests })),
    replaces: [],
    ifaces: table.ifaces,
  });
  return host;
}

interface UsageRow {
  session_id: string;
  purpose: string;
  cache_write: number;
  output: number;
}

describe("the shipped multimodal tools plugin", () => {
  let t: TestApp;
  let mmsp: MmspServer;
  let admin: ReturnType<typeof apiClient>;
  let sessionId: string;
  const usage = (): UsageRow[] =>
    t.deps.db
      .prepare(
        "SELECT session_id, purpose, cache_write, output FROM usage_records WHERE purpose IS NOT NULL ORDER BY id",
      )
      .all() as unknown as UsageRow[];
  const run = async (client: ReturnType<typeof apiClient>, args: string[], session?: string) => {
    const res = await client.post("/api/cli/commands/run", {
      package: PACKAGE,
      prog: "penguin",
      args,
      language: "en",
      projectId: PROJECT,
      ...(session !== undefined ? { sessionId: session } : {}),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as PluginCliCommandRunResponse;
  };

  beforeAll(async () => {
    mmsp = await startMmspServer((request) => {
      if (request.model === IMAGE.modelId) {
        return {
          events: [
            {
              role: "assistant",
              event_type: "delta",
              content_items: [
                { type: "inline_data.done", mime_type: "image/png", data: PNG.toString("base64") },
              ],
              usage_metadata: null,
              finish_reason: null,
            },
            {
              role: "assistant",
              event_type: "stop",
              content_items: [],
              usage_metadata: USAGE,
              finish_reason: "stop",
            },
          ],
        };
      }
      return textReply(`Edited: ${request.messages[0]?.content_items[0]?.text ?? ""}`, USAGE);
    });
    t = await createTestApp({ plugins: await shippedPlugin(), durableDatabase: true });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const configured = await admin.put(`${BASE}/models`, {
      providers: { custom: { clientType: "mmsp", baseUrl: mmsp.baseUrl, apiKey: "sk-test" } },
      models: [IMAGE, CHAT],
      defaultModel: CHAT,
    });
    expect(configured.status, await configured.clone().text()).toBe(200);
    const created = await admin.post(`${BASE}/agents/default_agent/sessions`, {});
    expect(created.status).toBe(201);
    sessionId = ((await created.json()) as SessionCreateResponse).session.sessionId;
  });

  afterAll(async () => {
    await mmsp?.close();
    await t?.cleanup();
  });

  it("boots with its seven bindings, each offering the models that can serve it", async () => {
    const { bindings } = (await (
      await admin.get(`${BASE}/models/tool-bindings`)
    ).json()) as ToolModelBindingsResponse;
    const ours = bindings.filter((b) => b.package === PACKAGE);
    expect(ours.map((b) => b.key)).toEqual(["t2t", "search", "fetch", "t2i", "t2v", "t2s", "s2t"]);
    expect(ours.find((b) => b.key === "t2i")?.candidates).toEqual([IMAGE]);
    expect(ours.find((b) => b.key === "t2t")?.candidates).toEqual([CHAT]);
  });

  it("generates an image for a Session's Agent, billed to the Session and kept with it", async () => {
    expect(
      (await admin.patch(`${BASE}/models/tool-bindings`, { key: "t2i", model: IMAGE })).status,
    ).toBe(200);
    const result = await run(admin, ["tools", "t2i", "a penguin reading", "--json"], sessionId);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(Buffer.from(result.files![0]!.data, "base64")).toEqual(PNG);
    const record = JSON.parse(result.stdout) as {
      status: string;
      files: { name: string; url: string }[];
    };
    expect(record.status).toBe("completed");
    expect(mmsp.requests.at(-1)?.model).toBe(IMAGE.modelId);
    expect(usage().at(-1)).toEqual({
      session_id: sessionId,
      purpose: `${PACKAGE}:t2i`,
      cache_write: 12,
      output: 4096,
    });
    const listed = (await (
      await admin.get(`${BASE}/multimodal-tools/sessions/${sessionId}/files`)
    ).json()) as { files: { name: string; mimeType: string }[] };
    expect(listed.files).toMatchObject([{ name: record.files[0]!.name, mimeType: "image/png" }]);
    const download = await admin.get(record.files[0]!.url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG);
  });

  it("refuses a tool nobody bound without a request, and lets a member run the commands", async () => {
    const before = mmsp.requests.length;
    const unbound = await run(admin, ["tools", "t2v", "a kite"], sessionId);
    expect(unbound.exitCode).toBe(1);
    expect(unbound.stderr).toContain("No model is bound to Video generation");
    expect(mmsp.requests.length).toBe(before);
    const { cookie } = await provisionUser(t.app, "member_m");
    expect((await admin.post(`${BASE}/members`, { userId: "member_m" })).status).toBe(201);
    const listed = await run(apiClient(t.app, cookie), ["tools", "list", "--json"]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout)).toContainEqual(
      expect.objectContaining({ operation: "t2i", via: "binding", model: IMAGE }),
    );
  });

  it("edits a dictated draft on the default chat model once an owner turns editing on, asking for no thinking", async () => {
    const settings = `${BASE}/multimodal-tools/voice-polish/settings`;
    // Nothing is bound to speech recognition, so editing waits for an owner to turn it on; the
    // model it would run on is the default chat model, nothing being bound to text generation.
    expect(await (await admin.get(settings)).json()).toMatchObject({ enabled: false, model: CHAT });
    const on = await admin.patch(settings, { enabled: true });
    expect(on.status, await on.clone().text()).toBe(200);
    expect(await on.json()).toMatchObject({ enabled: true, model: CHAT });
    const edited = await admin.post(`${BASE}/multimodal-tools/voice-polish`, {
      text: "um so the plan",
      sessionId,
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(await edited.json()).toEqual({ text: "Edited: um so the plan", model: CHAT });
    expect(mmsp.requests.at(-1)?.config).toMatchObject({ thinking_level: "none" });
    expect(mmsp.requests.at(-1)?.config.system_prompt).toEqual(
      expect.stringContaining("speech-recognition transcript"),
    );
    expect(usage().at(-1)?.purpose).toBe(`${PACKAGE}:polish`);
  });

  it("tests a tool model with a request it takes, and a chat model with the chat probe", async () => {
    const test = async (modelId: string) => {
      const res = await admin.post(`${BASE}/models/test`, { provider: "custom", modelId });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
      return mmsp.requests.at(-1)!;
    };
    // Drafts: the rows are not saved, and follow the group's connection.
    const recognizer = await test("deepseek-asr");
    expect(recognizer.model).toBe("deepseek-asr");
    const [audio] = recognizer.messages[0]!.content_items as {
      type: string;
      mime_type?: string;
      data?: string;
    }[];
    expect(audio).toMatchObject({ type: "inline_data.done", mime_type: "audio/wav" });
    expect(Buffer.from(audio!.data!, "base64").toString("ascii", 0, 4)).toBe("RIFF");
    expect(recognizer.config).not.toHaveProperty("max_tokens");
    expect(recognizer.config).not.toHaveProperty("thinking_level");

    const reader = await test("deepseek-fetch");
    expect(reader.messages).toHaveLength(1);
    const [page] = reader.messages[0]!.content_items;
    expect(page?.type).toBe("text.done");
    expect(new URL(page!.text!).protocol).toBe("https:");

    const chat = await test(CHAT.modelId);
    expect(chat.messages.at(-1)?.content_items.map((item) => item.type)).toEqual(["text.done"]);
    expect(chat.config).toHaveProperty("max_tokens");
  });

  it("saves only the verified Gemini route and sends the recording through its Interactions client", async () => {
    const projectId = "dictation_project";
    const base = `/api/projects/${projectId}`;
    expect((await admin.post("/api/projects", { projectId })).status).toBe(201);
    const modelId = "gemini-4-argon";
    const direct = { provider: "studio", modelId };
    const proxy = { provider: "relay", modelId };
    const origin = "https://generativelanguage.googleapis.com";
    const configured = await admin.put(`${base}/models`, {
      providers: {
        studio: { clientType: "google-official", baseUrl: origin, apiKey: "test-key" },
        relay: { clientType: "google-official", baseUrl: "https://unlisted.invalid" },
      },
      models: [direct, proxy],
      defaultModel: direct,
    });
    expect(configured.status, await configured.clone().text()).toBe(200);
    const bindings = `${base}/models/tool-bindings`;
    const offered = (await (await admin.get(bindings)).json()) as ToolModelBindingsResponse;
    expect(offered.bindings.find(({ key }) => key === "s2t")?.candidates).toEqual([direct]);
    const refused = await admin.patch(bindings, { key: "s2t", model: proxy });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "model_not_accepted" } });
    expect((await admin.patch(bindings, { key: "s2t", model: direct })).status).toBe(200);
    expect((await t.deps.projectConfigService.getToolModels(projectId)).s2t).toEqual(direct);

    const audio = readFileSync(path.join(PLUGIN_DIR, "assets", "test-speech.wav")).toString(
      "base64",
    );
    const transcript = "Houston, Tranquility Base here.";
    // Intercept only the transport. The real plugin and MMSP client encode the recording.
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const request = new Request(url, options);
      expect(new URL(request.url).origin).toBe(origin);
      expect(new URL(request.url).pathname).toMatch(/\/interactions$/);
      expect(await request.json()).toMatchObject({
        model: modelId,
        input: [
          {
            type: "user_input",
            content: [
              { type: "audio", data: audio },
              { type: "text", text: expect.stringContaining("original language") },
            ],
          },
        ],
      });
      const events = [
        { event_type: "step.delta", index: 0, delta: { type: "text", text: transcript } },
        { event_type: "interaction.completed", interaction: { status: "completed" } },
      ];
      return new Response(
        events
          .map((event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(""),
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    });
    try {
      const result = await admin.post(`${base}/multimodal-tools/s2t/run`, {
        audio: { data: audio, mimeType: "audio/wav" },
      });
      expect(result.status, await result.clone().text()).toBe(200);
      expect(await result.json()).toMatchObject({ status: "completed", text: transcript });
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      upstream.mockRestore();
    }
  });

  it("removes a deleted Session's files at the next boot", async () => {
    const dir = path.join(projectDir(t.root, PROJECT), ".multimodal-tools", "sessions", sessionId);
    expect(existsSync(dir)).toBe(true);
    expect((await admin.delete(`/api/sessions/${sessionId}`)).status).toBe(204);
    t = await restartTestApp(t, { plugins: await shippedPlugin() });
    await expect.poll(() => existsSync(dir)).toBe(false);
  });
});
