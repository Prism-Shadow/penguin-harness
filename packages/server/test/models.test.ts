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
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_CATALOG,
  catalogEntryFor,
  effectivePricing,
  userText,
} from "@prismshadow/penguin-core";
import type {
  ModelsResponse,
  ModelTestResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
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
      await api.post("/api/projects", { projectId: "alice-preset", name: "Preset project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("credentials are inlined in one file: the apiKey from PUT lands in .project_config.toml (0600), GET returns only a mask", async () => {
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
    // POSIX-only: Windows has no owner-only mode bits (chmod maps to the read-only attribute).
    if (process.platform !== "win32") {
      expect((await stat(cfgFile)).mode & 0o777).toBe(0o600);
    }
    // No more separate .credentials.toml / project_config.toml files.
    await expect(readFile(path.join(projectDir, ".credentials.toml"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(projectDir, "project_config.toml"), "utf8")).rejects.toThrow();
  });

  it("a new Project is preset with every built-in model (provider and model_id as separate fields + catalog info)", async () => {
    const res = await api.get(url());
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.defaultModel).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
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

    const deepseek = pick(body, "deepseek", "deepseek-v4-pro");
    expect(deepseek.vision).toBe(false);
    expect(deepseek.envKey).toBe("DEEPSEEK_API_KEY");
    expect(pick(body, "deepseek", "deepseek-v4-flash").isDefault).toBe(true);

    // OpenRouter gateway model: the upstream id contains `/`, but under column storage it's just a
    // plain string; openai-chat protocol + a preset base URL inlined on the entry (no secret).
    const mimo = pick(body, "openrouter", "xiaomi/mimo-v2.5");
    expect(mimo.clientType).toBe("openai-chat");
    expect(mimo.credential?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(mimo.credential?.apiKeyMasked).toBeUndefined();

    // A catalog row on a promotion is preset at the rate the seller BILLS, not at the list
    // price the catalog records. The cost center prices only against what is written into
    // the Project, so anything else here would report a cost nobody was charged.
    const promoted = catalogEntryFor("tokendance", "glm-5.3-flash")!;
    const billed = effectivePricing(promoted)!;
    expect(pick(body, "tokendance", "glm-5.3-flash").pricing).toEqual({
      cacheRead: billed.cache_read,
      cacheWrite: billed.cache_write,
      output: billed.output,
    });
    expect(billed.output).toBeLessThan(promoted.pricing!.output);
    // An undiscounted row is preset at its list price, unchanged.
    const plain = catalogEntryFor("tokendance", "hy4-preview")!;
    expect(pick(body, "tokendance", "hy4-preview").pricing).toEqual({
      cacheRead: plain.pricing!.cache_read,
      cacheWrite: plain.pricing!.cache_write,
      output: plain.pricing!.output,
    });
  });

  it("masks the env fallback for first-party official entries only, and never leaks the value", async () => {
    const saved = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      openai: process.env.OPENAI_API_KEY,
    };
    const anthropicValue = "sk-ant-test-secret-value-123456";
    const openaiValue = "sk-openai-test-secret-value-789";
    process.env.ANTHROPIC_API_KEY = anthropicValue;
    process.env.OPENAI_API_KEY = openaiValue;
    // Empty counts as absent — it would not authenticate either.
    process.env.DEEPSEEK_API_KEY = "";
    try {
      const put = await api.put(url(), {
        defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        models: [
          // First-party catalog preset, variable set: masked preview.
          { provider: "anthropic", modelId: "claude-sonnet-4-6" },
          // First-party catalog preset, variable empty: no preview.
          { provider: "deepseek", modelId: "deepseek-v4-pro" },
          // Off-catalog id in a vendor group, pure auto-route: still first-party.
          { provider: "anthropic", modelId: "claude-sonnet-4-6-preview" },
          // Vendor group re-pointed at a generic protocol: not first-party.
          { provider: "anthropic", modelId: "claude-via-gateway", clientType: "openai" },
          // Gateway and custom groups never carry a preview, even with OPENAI_API_KEY set.
          {
            provider: "openrouter",
            modelId: "xiaomi/mimo-v2.5",
            clientType: "openai-chat",
            baseUrl: "https://openrouter.ai/api/v1",
          },
          { provider: "custom", modelId: "my-model", clientType: "openai" },
        ],
      });
      expect(put.status).toBe(200);
      // The masked preview follows maskApiKey; the plaintext must never be serialized.
      const text = await put.text();
      expect(text).not.toContain(anthropicValue);
      expect(text).not.toContain(openaiValue);
      const body = JSON.parse(text) as ModelsResponse;
      const masked = `${anthropicValue.slice(0, 4)}…${anthropicValue.slice(-4)}`;
      expect(pick(body, "anthropic", "claude-sonnet-4-6").envKeyMasked).toBe(masked);
      expect(pick(body, "anthropic", "claude-sonnet-4-6-preview").envKeyMasked).toBe(masked);
      expect(pick(body, "deepseek", "deepseek-v4-pro").envKeyMasked).toBeUndefined();
      const rePointed = pick(body, "anthropic", "claude-via-gateway");
      expect(rePointed.envKey).toBe("OPENAI_API_KEY");
      expect(rePointed.envKeyMasked).toBeUndefined();
      const gateway = pick(body, "openrouter", "xiaomi/mimo-v2.5");
      expect(gateway.envKey).toBe("OPENAI_API_KEY");
      expect(gateway.envKeyMasked).toBeUndefined();
      expect(pick(body, "custom", "my-model").envKeyMasked).toBeUndefined();
    } finally {
      for (const [key, value] of [
        ["ANTHROPIC_API_KEY", saved.anthropic],
        ["DEEPSEEK_API_KEY", saved.deepseek],
        ["OPENAI_API_KEY", saved.openai],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("PUT a custom model: the vision flag persists; the openai protocol falls back to OPENAI_API_KEY; provider is required", async () => {
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
    // The request carried the deprecated bare "openai" alias (pre-0.4.2 clients/configs):
    // it is normalized to the canonical "openai-chat" on write and reported canonically.
    expect(mine.clientType).toBe("openai-chat");

    // Off-catalog model without client_type: no env-var fallback; with no vision annotation the field is omitted (default = supported).
    const opaque = pick(body, "custom", "opaque-model");
    expect("vision" in opaque).toBe(false);
    expect(opaque.envKey).toBeUndefined();

    // Listed under one vendor's group but using the openai protocol (a model added at a group header):
    // AgentHub's openai client actually reads OPENAI_API_KEY, so the env fallback reports that, not the vendor's var name.
    expect(pick(body, "anthropic", "claude-via-gateway").envKey).toBe("OPENAI_API_KEY");

    // GET again: vision was persisted (not just echoed from the request body), and the disk
    // stores the canonical client-type spelling.
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(again, "custom", "my-model").vision).toBe(false);
    expect(pick(again, "custom", "my-model").clientType).toBe("openai-chat");
    const toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain('client_type = "openai-chat"');
    expect(toml).not.toContain('"openai"');

    // vision shape check: non-boolean → 400.
    const bad = await api.put(url(), {
      models: [{ provider: "custom", modelId: "my-model", vision: "yes" }],
    });
    expect(bad.status).toBe(400);

    // Missing provider → 400 (refs are always a pair; neither half may be omitted).
    const noProvider = await api.put(url(), { models: [{ modelId: "my-model" }] });
    expect(noProvider.status).toBe(400);
  });

  it('a config stored before the AgentHub 0.4.2 rename (client_type = "openai") keeps working: GET reports the canonical openai-chat', async () => {
    // Simulate an existing user config written by an older harness version: the deprecated
    // bare "openai" spelling on disk. Reading must not error and must report the canonical
    // spelling (normalize-on-read, no disk rewrite needed until the next PUT).
    const cfgFile = path.join(t.root, projectId, ".project_config.toml");
    await writeFile(
      cfgFile,
      [
        "[[models]]",
        'provider = "custom"',
        'model_id = "legacy-openai-model"',
        'client_type = "openai"',
        'base_url = "https://legacy.example/v1"',
      ].join("\n"),
      "utf8",
    );
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    const legacy = pick(body, "custom", "legacy-openai-model");
    expect(legacy.clientType).toBe("openai-chat");
    // The env fallback resolves like any openai-chat entry.
    expect(legacy.envKey).toBe("OPENAI_API_KEY");
  });

  it("a configured model that has since been dropped from the built-in catalog still loads, keeps its data, and stays usable", async () => {
    // Migration guard for catalog removals (the 2026-08-18 inclusionai/ling-3.0-flash:free
    // delisting is the live example): a user who configured the preset before it was removed
    // keeps a row on disk that catalogEntryFor no longer matches. Everything presetModelEntries
    // persisted must survive — only display_name lived solely in the catalog — and the row must
    // stay a normal, selectable entry rather than being pruned, rejected or blanked.
    const cfgFile = path.join(t.root, projectId, ".project_config.toml");
    await writeFile(
      cfgFile,
      [
        "[[models]]",
        'provider = "openrouter"',
        'model_id = "vendor/removed-from-catalog:free"',
        "context_window = 262144",
        'client_type = "openai-chat"',
        'base_url = "https://openrouter.ai/api/v1"',
        'api_key = "sk-still-here"',
        "vision = false",
        "",
        "[models.pricing]",
        'unit = "usd_per_mtok"',
        "cache_read = 0.0",
        "cache_write = 0.0",
        "output = 0.0",
      ].join("\n"),
      "utf8",
    );
    // Sanity: the id really is absent from the built-in catalog, so this exercises the
    // off-catalog path rather than an accidental match.
    expect(
      MODEL_CATALOG.some(
        (m) => m.provider === "openrouter" && m.modelId === "vendor/removed-from-catalog:free",
      ),
    ).toBe(false);

    const body = (await (await api.get(url())).json()) as ModelsResponse;
    const orphan = pick(body, "openrouter", "vendor/removed-from-catalog:free");
    // Everything stored in TOML is read straight back — pricing and context window come from
    // the file, not the catalog, so a $0 free-tier row keeps costing 0 rather than going
    // "unknown".
    expect(orphan.contextWindow).toBe(262144);
    expect(orphan.pricing).toEqual({ cacheRead: 0, cacheWrite: 0, output: 0 });
    expect(orphan.vision).toBe(false);
    expect(orphan.clientType).toBe("openai-chat");
    expect(orphan.envKey).toBe("OPENAI_API_KEY");
    // The credential survives, masked; the base URL is still inlined on the entry.
    expect(orphan.credential?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(orphan.credential?.apiKeyMasked).toBeTruthy();
    // The one real loss: display_name only ever lived in the catalog, so the UI falls back to
    // the raw upstream id.
    expect(orphan.displayName).toBeUndefined();

    // Still a legal default-model target — nothing validates the pair against the catalog.
    const put = await api.put(url(), {
      models: [
        {
          provider: "openrouter",
          modelId: "vendor/removed-from-catalog:free",
          contextWindow: 262144,
          clientType: "openai-chat",
        },
      ],
      defaultModel: { provider: "openrouter", modelId: "vendor/removed-from-catalog:free" },
    });
    expect(put.status).toBe(200);
    const after = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(after, "openrouter", "vendor/removed-from-catalog:free").isDefault).toBe(true);
  });

  it("PUT maxTokens: persisted as max_tokens and read back through GET; omitting it table-wide clears it; 0 / negative / non-numeric 400", async () => {
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

  it("the same model_id can coexist under different providers (paired keys, neither overwrites the other)", async () => {
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

describe("default_project presets", () => {
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

  it("when the seeded admin adopts default_project, the preset models and the default model are filled in (no prior .project_config.toml)", async () => {
    // The default_project shared by admin seeding and the CLI (the dir already exists, so writeInitialConfig is skipped).
    t = await createTestApp();
    const { cookie } = await loginAdmin(t.app);
    const api = apiClient(t.app, cookie);
    const res = await api.get("/api/projects/default_project/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.defaultModel).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    expect(body.models.map(pairKey)).toEqual(catalogPairs);

    // The point of presets is "works out of the box": creating a Session should succeed without passing a model ref.
    const created = await api.post(
      "/api/projects/default_project/agents/default_agent/sessions",
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;
    expect(session.provider).toBe("deepseek");
    expect(session.modelId).toBe("deepseek-v4-flash");
  });

  it("a default_project that already has models configured is left untouched (existing CLI config is not overwritten)", async () => {
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

describe("model-reference rekeying and the connectivity test", () => {
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
      await api.post("/api/projects", { projectId: "carol-rename", name: "Rename project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("renamedFrom migrates the credential and the config; the default / vision model pointers follow the rekey", async () => {
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

  it("a group change is a rekey too: the credential migrates with it; envKey resolves by client, not by group (PRN-021)", async () => {
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

  it("the display name is editable: not persisted when it matches the built-in catalog; provider is always persisted as an entry field", async () => {
    // Preset model: saved as-is → the display name falls back to the built-in catalog, and display_name isn't written to the config file.
    await api.put(url(), {
      models: [
        { provider: "openai", modelId: "gpt-5.5", displayName: "GPT-5.5" },
        { provider: "openai", modelId: "gpt-5.4", displayName: "My GPT" },
      ],
    });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "openai", "gpt-5.5").displayName).toBe("GPT-5.5");
    // Edited one: the display name takes effect per the user's setting.
    expect(pick(body, "openai", "gpt-5.4").displayName).toBe("My GPT");

    // Clean on disk: unchanged preset models don't write display_name; provider is stored as a separate column, no concatenated string.
    const toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).not.toContain('display_name = "GPT-5.5"');
    expect(toml).toContain('display_name = "My GPT"');
    expect(toml).toContain('provider = "openai"');
    expect(toml).not.toContain("openai/gpt-5.5");
  });

  it("a peak/off-peak row is costed at the rate in force, from the one stable price on disk", async () => {
    // Beijing is UTC+8: 2026-08-31 is a Monday, so 01:30Z is 09:30 there (peak) and 12:00Z is
    // 20:00 (off-peak). The number on disk is the same in both cases — that is the point.
    const svc = new ProjectConfigService(t.root);
    const peak = await svc.getPricing(
      projectId,
      "deepseek",
      "deepseek-v4-flash",
      new Date("2026-08-31T01:30:00Z"),
    );
    const off = await svc.getPricing(
      projectId,
      "deepseek",
      "deepseek-v4-flash",
      new Date("2026-08-31T12:00:00Z"),
    );
    const catalogPeak = catalogEntryFor("deepseek", "deepseek-v4-flash")!.pricing!;
    expect(peak!.output).toBe(catalogPeak.output);
    expect(off!.output).toBeCloseTo(catalogPeak.output / 2, 5);

    // Sunday: off-peak all day, including what would be a peak hour on a weekday.
    const weekend = await svc.getPricing(
      projectId,
      "deepseek",
      "deepseek-v4-flash",
      new Date("2026-09-06T01:30:00Z"),
    );
    expect(weekend!.output).toBeCloseTo(catalogPeak.output / 2, 5);
  });

  it("a hand-edited price on a scheduled row is billed as typed, at every hour", async () => {
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    const entries = body.models.map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      ...(m.pricing
        ? {
            pricing:
              m.provider === "deepseek" && m.modelId === "deepseek-v4-flash"
                ? { cacheRead: 1, cacheWrite: 2, output: 3 }
                : {
                    cacheRead: m.pricing.cacheRead,
                    cacheWrite: m.pricing.cacheWrite,
                    output: m.pricing.output,
                  },
          }
        : {}),
    }));
    await api.put(url(), { models: entries });
    const svc = new ProjectConfigService(t.root);
    // Nothing here knows whether 3 is a peak rate, so halving it would invent a discount.
    for (const at of ["2026-08-31T01:30:00Z", "2026-08-31T12:00:00Z"]) {
      const rates = await svc.getPricing(projectId, "deepseek", "deepseek-v4-flash", new Date(at));
      expect(rates, at).toEqual({ cacheRead: 1, cacheWrite: 2, output: 3 });
    }
  });

  it("clearing a preset model's display name sticks: it falls back to the id, not back to the catalog", async () => {
    // Only provider and modelId are required, so an entry sent without a display name is the
    // user having cleared it. Writing nothing would leave the field absent, which reads as
    // "inherit from the catalog" — the deleted name would be handed straight back on reload.
    await api.put(url(), { models: [{ provider: "openai", modelId: "gpt-5.5" }] });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "openai", "gpt-5.5").displayName).toBeUndefined();
    // The empty string is what records the deletion, and it survives a second full-table PUT
    // that likewise carries no name.
    const toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain('display_name = ""');
    await api.put(url(), { models: [{ provider: "openai", modelId: "gpt-5.5" }] });
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(again, "openai", "gpt-5.5").displayName).toBeUndefined();
  });

  it("a cleared name is restorable, and clearing a model the catalog does not name writes nothing", async () => {
    await api.put(url(), { models: [{ provider: "openai", modelId: "gpt-5.5" }] });
    // Naming it again drops the marker rather than leaving both on disk.
    await api.put(url(), {
      models: [{ provider: "openai", modelId: "gpt-5.5", displayName: "Renamed" }],
    });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "openai", "gpt-5.5").displayName).toBe("Renamed");
    let toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).not.toContain('display_name = ""');

    // A model outside the catalog has no name to inherit, so absence already says "no name"
    // and the marker would be noise in the file.
    await api.put(url(), {
      models: [
        { provider: "openai", modelId: "gpt-5.5", displayName: "Renamed" },
        { provider: "custom", modelId: "my-own-model" },
      ],
    });
    toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).not.toContain('display_name = ""');
    const after = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(after, "custom", "my-own-model").displayName).toBeUndefined();
  });

  it("an invalid renamedFrom is 400; rekeying without renamedFrom equals delete-old-then-create-new (the credential does not migrate)", async () => {
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

  it("the connectivity test sends the entry's upstream model_id (the reference pair travels with the request body)", async () => {
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

  it("the connectivity-test request body carries no tools or tool_choice (an empty tool list is omitted entirely, so strict endpoints such as vLLM no longer 400)", async () => {
    // The probe runs with an empty tool list. The wire body must omit `tools` entirely —
    // `tools: []` is rejected by strict OpenAI-compatible servers (vLLM: "tools must not be an
    // empty array") — and must never carry `tool_choice`.
    const bodies: Record<string, unknown>[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
      req.on("end", () => {
        try {
          bodies.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          bodies.push({});
        }
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "test-reject", type: "invalid_request" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await api.post(testUrl(), {
        provider: "custom",
        modelId: "probe-wire-model",
        clientType: "openai",
        apiKey: "sk-test-local",
        baseUrl: `http://127.0.0.1:${port}/v1`,
      });
      expect(res.status).toBe(200);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect("tools" in body).toBe(false);
        expect("tool_choice" in body).toBe(false);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("connectivity test: both a saved model and a **not-yet-saved** custom model can be tested (the LLM layer throws nothing, every outcome converges)", async () => {
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

  it("connectivity test: a model with no credential at all converges to ok:false instead of 500", async () => {
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

  it("connectivity test: clearApiKey does not fall back to the stored key (the current draft is what gets tested)", async () => {
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

describe("models update reaches loaded sessions (invalidation + live unlock)", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  /** Loader call count: how many times the manager (re)built a runtime from the index. */
  let loads: number;

  /** Minimal fake runtime Session (no LLM calls; mirrors vault.test.ts). */
  const fakeRuntimeSession = (sessionId: string): RuntimeSession => ({
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {},
    async *compact() {},
  });

  const insertSession = (sessionId: string, project: string): void => {
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId: project,
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: t.root,
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
  };

  const putModels = (apiKey: string) =>
    api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "m-inv" },
      models: [{ provider: "custom", modelId: "m-inv", apiKey }],
    });

  beforeEach(async () => {
    loads = 0;
    t = await createTestApp({
      loader: {
        load: async (row) => {
          loads++;
          return fakeRuntimeSession(row.sessionId);
        },
      },
    });
    const { cookie } = await provisionUser(t.app, "inv_owner");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "inv_owner-models", name: "invalidation" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("PUT invalidates the Project's cached Session runtimes: the next Task re-resumes with the new key", async () => {
    insertSession("models-sess-1", projectId);
    const idle = () => t.deps.manager.statusOf("models-sess-1") === "idle";

    // First Task builds the runtime (load #1); the second reuses the active-table entry.
    await t.deps.manager.startTask("models-sess-1", [userText("a")]);
    await waitFor(idle);
    await t.deps.manager.startTask("models-sess-1", [userText("b")]);
    await waitFor(idle);
    expect(loads).toBe(1);

    // Key update via the API: the cached runtime is stale, so the next Task re-resumes
    // (the loader re-reads the Project config — the new api_key reaches the next Task).
    expect((await putModels("sk-fresh-key-000111")).status).toBe(200);
    await t.deps.manager.startTask("models-sess-1", [userText("c")]);
    await waitFor(idle);
    expect(loads).toBe(2);

    // Reads don't invalidate: the rebuilt runtime is reused.
    expect((await api.get(`/api/projects/${projectId}/models`)).status).toBe(200);
    await t.deps.manager.startTask("models-sess-1", [userText("d")]);
    await waitFor(idle);
    expect(loads).toBe(2);
  });

  it("PUT publishes credentials_updated to the Project's existing session channels only", async () => {
    insertSession("models-sess-live", projectId);
    insertSession("models-sess-cold", projectId);
    // A session of ANOTHER project must not receive the event.
    const other = (await (
      await api.post("/api/projects", { projectId: "inv_owner-other", name: "other" })
    ).json()) as ProjectCreateResponse;
    insertSession("other-sess", other.project.projectId);

    // Only the "live" session has an open channel (a subscribed tab); "cold" has none.
    const events: ChannelEvent[] = [];
    t.deps.channels.get("models-sess-live").subscribe((e) => events.push(e));
    const otherEvents: ChannelEvent[] = [];
    t.deps.channels.get("other-sess").subscribe((e) => otherEvents.push(e));

    expect((await putModels("sk-live-key-000222")).status).toBe(200);

    const types = events
      .filter((e) => e.event === "server_event")
      .map((e) => (JSON.parse(e.data) as { type: string }).type);
    expect(types).toContain("credentials_updated");
    // Cross-project channels stay silent, and no channel is created for unsubscribed sessions.
    expect(
      otherEvents
        .filter((e) => e.event === "server_event")
        .map((e) => (JSON.parse(e.data) as { type: string }).type),
    ).not.toContain("credentials_updated");
    expect(t.deps.channels.peek("models-sess-cold")).toBeUndefined();
  });

  it("GET/PUT responses expose updatedAt (config file mtime) for the web's auth-dead gate", async () => {
    const before = Date.now() - 60_000;
    const put = await putModels("sk-ts-key-000333");
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as ModelsResponse;
    expect(typeof putBody.updatedAt).toBe("string");
    expect(Date.parse(putBody.updatedAt!)).toBeGreaterThan(before);

    const get = await api.get(`/api/projects/${projectId}/models`);
    const getBody = (await get.json()) as ModelsResponse;
    expect(typeof getBody.updatedAt).toBe("string");
    // Reads don't bump it: still the PUT's write time (same file mtime).
    expect(Date.parse(getBody.updatedAt!)).toBeGreaterThanOrEqual(Date.parse(putBody.updatedAt!));
  });
});
