/**
 * Model config integration tests: both a fresh Project and the admin-seeded default_project come
 * preloaded with the built-in model catalog (`provider` and `model_id` are **stored as separate
 * columns**; the (provider, model_id) pair is the unique key, ids are never concatenated, and the user
 * only adds an API key); credentials are inlined in the single config file `.project_config.toml`
 * (0600); GET models looks up the catalog by the paired ref to fill in displayName / envKey, taking
 * vision from the TOML annotation and falling back to the catalog default; PUT persists a custom
 * model's vision and an OPENAI_API_KEY fallback for client_type=openai; connectivity-test model refs
 * are given as a pair in the request body.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "@prismshadow/penguin-core";
import type {
  ModelsResponse,
  ModelTestResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Catalog paired refs (config primary key = (provider, model_id)). */
const catalogPairs = MODEL_CATALOG.map((m) => `${m.provider}\0${m.modelId}`);
/** Response row → comparable paired key (test-only comparison, not the storage format). */
const pairKey = (m: { provider: string; modelId: string }): string => `${m.provider}\0${m.modelId}`;
/** Fetch a row by its paired ref. */
const pick = (body: ModelsResponse, provider: string, modelId: string) =>
  body.models.find((m) => m.provider === provider && m.modelId === modelId)!;

describe("models preset & catalog enrichment", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-preset", name: "预置项目" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("credential 内联单文件：PUT 的 apiKey 落 .project_config.toml（0600），GET 只回掩码", async () => {
    const put = await api.put(url(), {
      defaultModel: { provider: "custom", modelId: "m-inline" },
      models: [
        {
          provider: "custom",
          modelId: "m-inline",
          apiKey: "sk-server-inline-1",
          baseUrl: "https://inline.example/v1",
          clientType: "openai",
        },
      ],
    });
    expect(put.status).toBe(200);

    // GET: the masked key and base URL are both visible; plaintext is never sent.
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    const m = pick(body, "custom", "m-inline");
    expect(m.credential?.baseUrl).toBe("https://inline.example/v1");
    expect(m.credential?.apiKeyMasked).toBe("sk-s…ne-1");
    expect(m.credential?.createdAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("sk-server-inline-1");

    // Secrets inlined in the single config file (persisted 0600); provider and model_id are separate columns, no concatenated string.
    const projectDir = path.join(t.root, projectId);
    const cfgFile = path.join(projectDir, ".project_config.toml");
    const cfgRaw = await readFile(cfgFile, "utf8");
    expect(cfgRaw).toContain("sk-server-inline-1");
    expect(cfgRaw).toContain('provider = "custom"');
    expect(cfgRaw).toContain('model_id = "m-inline"');
    expect(cfgRaw).not.toContain("custom/m-inline");
    expect((await stat(cfgFile)).mode & 0o777).toBe(0o600);
    // No more separate .credentials.toml / project_config.toml files.
    await expect(readFile(path.join(projectDir, ".credentials.toml"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(projectDir, "project_config.toml"), "utf8")).rejects.toThrow();
  });

  it("新建 Project 即预置全部内置模型（provider 与 model_id 分列 + 目录信息）", async () => {
    const res = await api.get(url());
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.defaultModel).toEqual({ provider: "deepseek", modelId: "deepseek-v4-pro" });
    expect(body.models.map(pairKey)).toEqual(catalogPairs);

    const sonnet = pick(body, "anthropic", "claude-sonnet-4-6");
    expect(sonnet.isDefault).toBe(false);
    expect(sonnet.displayName).toBe("Claude Sonnet 4.6");
    // Vision: not annotated in TOML (preset vision models aren't persisted), so GET falls back to the catalog annotation.
    expect(sonnet.vision).toBe(true);
    expect(sonnet.envKey).toBe("ANTHROPIC_API_KEY");
    expect(sonnet.contextWindow).toBe(1000000);
    expect(sonnet.pricing).toEqual({ cacheRead: 0.3, cacheWrite: 3.75, output: 15 });
    // Preset models have no credential and no client_type (AgentHub auto-routes by upstream id).
    expect(sonnet.credential).toBeUndefined();
    expect(sonnet.clientType).toBeUndefined();

    const deepseek = pick(body, "deepseek", "deepseek-v4-flash");
    expect(deepseek.vision).toBe(false);
    expect(deepseek.envKey).toBe("DEEPSEEK_API_KEY");
    expect(pick(body, "deepseek", "deepseek-v4-pro").isDefault).toBe(true);

    // OpenRouter gateway model: the upstream id contains `/`, but under column storage it's just a
    // plain string; openai protocol + a preset base URL inlined on the entry (no secret).
    const mimo = pick(body, "openrouter", "xiaomi/mimo-v2.5");
    expect(mimo.clientType).toBe("openai");
    expect(mimo.credential?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(mimo.credential?.apiKeyMasked).toBeUndefined();
  });

  it("PUT 自定义模型：持久化 vision 标注；openai 协议给 OPENAI_API_KEY 兜底；provider 必填", async () => {
    const put = await api.put(url(), {
      defaultModel: { provider: "custom", modelId: "my-model" },
      models: [
        { provider: "custom", modelId: "my-model", clientType: "openai", vision: false },
        { provider: "custom", modelId: "opaque-model" },
        { provider: "anthropic", modelId: "claude-via-gateway", clientType: "openai" },
      ],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;

    const mine = pick(body, "custom", "my-model");
    expect(mine.displayName).toBeUndefined();
    expect(mine.vision).toBe(false);
    expect(mine.envKey).toBe("OPENAI_API_KEY");
    expect(mine.clientType).toBe("openai");

    // Off-catalog model without client_type: no env-var fallback; with no vision annotation the field is omitted (default = supported).
    const opaque = pick(body, "custom", "opaque-model");
    expect("vision" in opaque).toBe(false);
    expect(opaque.envKey).toBeUndefined();

    // Listed under one vendor's group but using the openai protocol (a model added at a group header):
    // AgentHub's openai client actually reads OPENAI_API_KEY, so the env fallback reports that, not the vendor's var name.
    expect(pick(body, "anthropic", "claude-via-gateway").envKey).toBe("OPENAI_API_KEY");

    // GET again: vision was persisted (not just echoed from the request body).
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(again, "custom", "my-model").vision).toBe(false);

    // vision shape check: non-boolean → 400.
    const bad = await api.put(url(), {
      models: [{ provider: "custom", modelId: "my-model", vision: "yes" }],
    });
    expect(bad.status).toBe(400);

    // Missing provider → 400 (refs are always a pair; neither half may be omitted).
    const noProvider = await api.put(url(), { models: [{ modelId: "my-model" }] });
    expect(noProvider.status).toBe(400);
  });

  it("PUT maxTokens：落盘为 max_tokens 并经 GET 回读；整表省略即清除；0/负数/非数字 400", async () => {
    const put = await api.put(url(), {
      models: [
        { provider: "custom", modelId: "local-qwen", clientType: "openai", maxTokens: 8000 },
      ],
    });
    expect(put.status).toBe(200);
    expect(pick((await put.json()) as ModelsResponse, "custom", "local-qwen").maxTokens).toBe(8000);

    // Round-trips through disk (persisted as snake_case on the entry, not just echoed back).
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(again, "custom", "local-qwen").maxTokens).toBe(8000);
    const toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain("max_tokens = 8000");

    // Full-table PUT omitting the field clears the annotation (same replace semantics as vision/contextWindow).
    const cleared = await api.put(url(), {
      models: [{ provider: "custom", modelId: "local-qwen", clientType: "openai" }],
    });
    expect(cleared.status).toBe(200);
    const clearedRow = pick((await cleared.json()) as ModelsResponse, "custom", "local-qwen");
    expect("maxTokens" in clearedRow).toBe(false);
    expect(
      await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8"),
    ).not.toContain("max_tokens");

    // Not a positive integer → 400 with the field-labelled message (nothing written).
    for (const bad of [0, -5, 1.5, "8000"]) {
      const res = await api.put(url(), {
        models: [{ provider: "custom", modelId: "local-qwen", maxTokens: bad }],
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain("models[0].maxTokens");
    }
  });

  it("同名 model_id 可在不同 provider 下并存（成对键，互不覆盖）", async () => {
    const put = await api.put(url(), {
      models: [
        { provider: "moonshot", modelId: "kimi-k2.6", apiKey: "sk-official-aaaa1111" },
        {
          provider: "siliconflow",
          modelId: "kimi-k2.6",
          clientType: "openai",
          apiKey: "sk-gateway-bbbb2222",
        },
      ],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    expect(body.models).toHaveLength(2);
    // The two entries are independent: credential and envKey don't cross over.
    expect(pick(body, "moonshot", "kimi-k2.6").credential?.apiKeyMasked).toBe("sk-o…1111");
    expect(pick(body, "moonshot", "kimi-k2.6").envKey).toBe("MOONSHOT_API_KEY");
    expect(pick(body, "siliconflow", "kimi-k2.6").credential?.apiKeyMasked).toBe("sk-g…2222");
    expect(pick(body, "siliconflow", "kimi-k2.6").envKey).toBe("OPENAI_API_KEY");

    // Round-trips through disk unchanged.
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(again.models.map(pairKey).sort()).toEqual(body.models.map(pairKey).sort());
  });
});

describe("default_project 预置", () => {
  let t: TestApp;
  let prevKey: string | undefined;

  beforeEach(() => {
    // The default model (DeepSeek) uses the OpenAI protocol, whose SDK requires a credential at
    // **construction time** — this case creates a Session, so we stuff in a fake key (no real request is sent). CI has no keys.
    prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key-not-used";
  });
  afterEach(async () => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    await t.cleanup();
  });

  it("种子 admin 纳管 default_project 时补齐预置模型与默认模型（此前无 .project_config.toml）", async () => {
    // The default_project shared by admin seeding and the CLI (the dir already exists, so writeInitialConfig is skipped).
    t = await createTestApp();
    const { cookie } = await loginAdmin(t.app);
    const api = apiClient(t.app, cookie);
    const res = await api.get("/api/projects/default_project/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.defaultModel).toEqual({ provider: "deepseek", modelId: "deepseek-v4-pro" });
    expect(body.models.map(pairKey)).toEqual(catalogPairs);

    // The point of presets is "works out of the box": creating a Session should succeed without passing a model ref.
    const created = await api.post(
      "/api/projects/default_project/agents/default_agent/sessions",
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;
    expect(session.provider).toBe("deepseek");
    expect(session.modelId).toBe("deepseek-v4-pro");
  });

  it("已配置过模型的 default_project 原样保留（不覆盖 CLI 既有配置）", async () => {
    // First have the "CLI" write a config with a single custom model, then admin seeding adopts it.
    t = await createTestApp({
      beforeSeed: async (root) => {
        await new ProjectConfigService(root).writeRaw("default_project", {
          default_model: { provider: "custom", model_id: "cli-model" },
          models: [{ provider: "custom", model_id: "cli-model", context_window: 1234 }],
        });
      },
    });
    const { cookie } = await loginAdmin(t.app);
    const api = apiClient(t.app, cookie);
    const body = (await (
      await api.get("/api/projects/default_project/models")
    ).json()) as ModelsResponse;
    expect(body.defaultModel).toEqual({ provider: "custom", modelId: "cli-model" });
    expect(body.models.map(pairKey)).toEqual(["custom\0cli-model"]);
    expect(body.models[0]!.contextWindow).toBe(1234);
  });
});

describe("模型引用改键与连通性测试", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;
  const testUrl = () => `${url()}/test`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "carol");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "carol-rename", name: "改名项目" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("renamedFrom 迁移 credential 与配置，默认/视觉模型指针跟随改键", async () => {
    await api.put(url(), {
      defaultModel: { provider: "custom", modelId: "old-id" },
      visionModel: { provider: "custom", modelId: "old-id" },
      models: [
        {
          provider: "custom",
          modelId: "old-id",
          contextWindow: 4096,
          apiKey: "sk-secret-abcd1234",
        },
      ],
    });

    const put = await api.put(url(), {
      models: [
        {
          provider: "custom",
          modelId: "new-id",
          renamedFrom: { provider: "custom", modelId: "old-id" },
          contextWindow: 4096,
        },
      ],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    expect(body.models.map(pairKey)).toEqual(["custom\0new-id"]);
    // The credential migrates with the key change (masked value visible), and the pointer follows the new ref.
    expect(body.models[0]!.credential?.apiKeyMasked).toBe("sk-s…1234");
    expect(body.defaultModel).toEqual({ provider: "custom", modelId: "new-id" });
    expect(body.visionModel).toEqual({ provider: "custom", modelId: "new-id" });
    // Round-trips through disk unchanged (not just echoed).
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(again.models[0]!.credential?.apiKeyMasked).toBe("sk-s…1234");
    expect(again.defaultModel).toEqual({ provider: "custom", modelId: "new-id" });
  });

  it("分组变更也是改键：credential 随迁；envKey 按 client 解析、不随分组（PRN-021）", async () => {
    // Move the preset DeepSeek model to another group (changing provider is a key change; the paired renamedFrom migrates it).
    const put = await api.put(url(), {
      models: [
        {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          apiKey: "sk-secret-abcd1234",
          vision: false,
        },
      ],
    });
    expect(put.status).toBe(200);
    expect(pick((await put.json()) as ModelsResponse, "deepseek", "deepseek-v4-pro").envKey).toBe(
      "DEEPSEEK_API_KEY",
    );

    const put2 = await api.put(url(), {
      models: [
        {
          provider: "custom",
          modelId: "deepseek-v4-pro",
          renamedFrom: { provider: "deepseek", modelId: "deepseek-v4-pro" },
          vision: false,
        },
      ],
    });
    expect(put2.status).toBe(200);
    const moved = ((await put2.json()) as ModelsResponse).models[0]!;
    expect(moved.provider).toBe("custom");
    expect(moved.modelId).toBe("deepseek-v4-pro");
    expect(moved.credential?.apiKeyMasked).toBe("sk-s…1234");
    // The env fallback follows client resolution — with no client_type on the entry,
    // AgentHub still routes by id to the DeepSeek client (reading DEEPSEEK_API_KEY), regardless of group membership.
    expect(moved.envKey).toBe("DEEPSEEK_API_KEY");
  });

  it("展示名可编辑：与内置目录一致时不落盘；provider 恒作为条目字段落盘", async () => {
    // Preset model: saved as-is → the display name falls back to the built-in catalog, and display_name isn't written to the config file.
    await api.put(url(), {
      models: [
        { provider: "openai", modelId: "gpt-5.5", displayName: "GPT-5.5" },
        { provider: "openai", modelId: "gpt-5.4", displayName: "我的 GPT" },
      ],
    });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "openai", "gpt-5.5").displayName).toBe("GPT-5.5");
    // Edited one: the display name takes effect per the user's setting.
    expect(pick(body, "openai", "gpt-5.4").displayName).toBe("我的 GPT");

    // Clean on disk: unchanged preset models don't write display_name; provider is stored as a separate column, no concatenated string.
    const toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).not.toContain('display_name = "GPT-5.5"');
    expect(toml).toContain('display_name = "我的 GPT"');
    expect(toml).toContain('provider = "openai"');
    expect(toml).not.toContain("openai/gpt-5.5");
  });

  it("renamedFrom 非法值 400；不带 renamedFrom 改键等于删旧建新（credential 不迁移）", async () => {
    await api.put(url(), {
      models: [{ provider: "custom", modelId: "m-a", apiKey: "sk-secret-abcd1234" }],
    });
    // Invalid shape: renamedFrom must be a { provider, modelId } pair object; a string is always 400.
    const bad = await api.put(url(), {
      models: [{ provider: "custom", modelId: "m-b", renamedFrom: "custom/m-a" }],
    });
    expect(bad.status).toBe(400);
    // Giving only half a ref (missing provider) is also 400 — neither half of a ref may be omitted.
    const half = await api.put(url(), {
      models: [{ provider: "custom", modelId: "m-b", renamedFrom: { modelId: "m-a" } }],
    });
    expect(half.status).toBe(400);

    const plain = await api.put(url(), { models: [{ provider: "custom", modelId: "m-b" }] });
    const body = (await plain.json()) as ModelsResponse;
    expect(body.models.map(pairKey)).toEqual(["custom\0m-b"]);
    expect(body.models[0]!.credential).toBeUndefined();
  });

  it("连通性测试发的是条目的上游 model_id（引用成对随请求体）", async () => {
    // Local openai-compatible endpoint: records the model field from the request body, then always rejects with 401 (never hits the network).
    const seenModels: string[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
      req.on("end", () => {
        try {
          seenModels.push((JSON.parse(raw) as { model?: string }).model ?? "");
        } catch {
          seenModels.push("");
        }
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "test-reject", type: "invalid_request" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await api.put(url(), {
        models: [
          {
            provider: "custom",
            modelId: "actual-upstream-model",
            clientType: "openai",
            apiKey: "sk-test-local",
            baseUrl: `http://127.0.0.1:${port}/v1`,
          },
        ],
      });
      const res = await api.post(testUrl(), {
        provider: "custom",
        modelId: "actual-upstream-model",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ModelTestResponse;
      expect(body.ok).toBe(false);
      // What's sent is exactly the entry's model_id (under column storage it's the upstream id itself, no concatenated string).
      expect(seenModels).toContain("actual-upstream-model");
      expect(seenModels).not.toContain("custom/actual-upstream-model");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("连通性测试：已保存的模型与**尚未保存**的自定义模型都可测（LLM 层不抛异常，一律收敛）", async () => {
    await api.put(url(), {
      models: [{ provider: "openai", modelId: "gpt-5.5", apiKey: "sk-invalid-key-for-test" }],
    });
    const saved = await api.post(testUrl(), { provider: "openai", modelId: "gpt-5.5" });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as ModelTestResponse;
    expect(savedBody.ok).toBe(false);
    expect(typeof savedBody.message).toBe("string");

    // "Test before save" for adding a custom model: the model isn't in the config, so all params come from the request body.
    const unsaved = await api.post(testUrl(), {
      provider: "custom",
      modelId: "my-new-model",
      apiKey: "sk-invalid",
      baseUrl: "https://example.invalid/v1",
      clientType: "openai",
    });
    expect(unsaved.status).toBe(200);
    const unsavedBody = (await unsaved.json()) as ModelTestResponse;
    expect(unsavedBody.ok).toBe(false);
    expect(typeof unsavedBody.message).toBe("string");
  }, 40_000);

  it("连通性测试：模型完全没有 credential 时收敛为 ok:false，而非 500", async () => {
    // A model using the OpenAI protocol: the provider SDK throws at **client construction** because
    // the key is missing — if that construction were outside the try it would bubble up as a 500. Clear the env-var key so there's nowhere to get one (no real network request).
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await api.put(url(), {
        models: [{ provider: "custom", modelId: "no-key-openai", clientType: "openai" }],
      });
      const res = await api.post(testUrl(), { provider: "custom", modelId: "no-key-openai" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ModelTestResponse;
      expect(body.ok).toBe(false);
      expect(typeof body.message).toBe("string");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("连通性测试：clearApiKey 时不回落已存 key（照当前草稿测）", async () => {
    // A key is already saved, but the test request carries clearApiKey — the server must **not** use
    // the saved key. Clear the env var so "don't use the saved key" == no credential at all, so construction synchronously throws missing-credential (no network request, deterministic).
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await api.put(url(), {
        models: [
          {
            provider: "custom",
            modelId: "has-key-openai",
            clientType: "openai",
            apiKey: "sk-saved-key",
          },
        ],
      });
      // Without clearApiKey: use the saved key and construction succeeds (would hit the real network; its result isn't asserted here).
      // With clearApiKey: don't fall back to the saved key → no credential → synchronously resolves to "missing credential".
      const cleared = await api.post(testUrl(), {
        provider: "custom",
        modelId: "has-key-openai",
        clearApiKey: true,
      });
      expect(cleared.status).toBe(200);
      const body = (await cleared.json()) as ModelTestResponse;
      expect(body.ok).toBe(false);
      // Missing-credential is thrown synchronously at construction (message contains "credentials"); if the saved key were still used, it wouldn't be this message.
      expect(body.message ?? "").toMatch(/credential/i);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});
