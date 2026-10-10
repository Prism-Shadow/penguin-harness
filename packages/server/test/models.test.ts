/**
 * A Project's model configuration: the built-in catalog as presets, one config file holding the
 * credentials, the groups' connections, rekeying, pricing fields, the connectivity test, the two
 * preset syncs, and what a save does to loaded Sessions.
 *
 * - A new Project, and default_project when the seeded admin adopts it, is preset with every
 *   built-in model (provider and model_id stored as separate fields, the pair the key), the
 *   default model, and each built-in group's endpoint and protocol in `[providers.<id>]`, so a
 *   Session opens with no model ref; a preset row stores a protocol or endpoint only where it
 *   differs from its group's table; a default_project table the file already holds is kept and
 *   the backfilled rows follow it; a default_project the CLI already configured is left alone.
 * - The file is the only truth: a Session on a preset is built with its group table's endpoint,
 *   protocol and key; with the table cleared a probe goes where the client's defaults send it,
 *   and GET reports the missing values as none — the catalog never fills them back in.
 * - Credentials live inline in `.project_config.toml` (0600) and GET shows only a mask; the env
 *   fallback is reported and masked only where the entry is allowed one, never leaking a value.
 * - GET labels a row with the catalog's display name and reports the env key; a pre-rename
 *   `client_type = "openai"` reads as openai-chat; a file written before MMSP's names and group
 *   connections is rewritten once on its first read into the shape a new Project is written in
 *   (OpenCode Go's and Penguin Go's included), then served from the cache; a model the catalog
 *   dropped still loads and stays usable; one model_id under two providers is two rows.
 * - PUT persists a custom model's vision flag and max_tokens (clearing and rejecting bad values),
 *   falls back to OPENAI_API_KEY for the openai protocol, requires a provider, refuses an id a
 *   vendor group cannot route when the request introduces it (unless its group names a
 *   protocol), refuses a hand-added model in a group that takes none (OpenRouter, TokenDance and
 *   SiliconFlow take them, stored bare), and stores or clears a discount.
 * - Group connections (`[providers.<id>]`): GET reports each group's masked key and every row's
 *   effective connection with its sources; a PUT `providers` change or the group route sets and
 *   clears per field and keeps the rest, a cleared field reading as none; the group route is
 *   owner-only and refuses an id no group could carry; a group base URL that is not an absolute
 *   http(s) URL is refused on both routes (a blank one clears); any group takes a protocol, and
 *   a row's own still wins; a group key leaves a row's own key in place, and the connectivity test uses
 *   the row's key, else the group's, on the group's endpoint; a group key reaches only the rows
 *   on its endpoint's origin (never Atria, never a row re-pointed at another host); a
 *   user-defined group's table goes with its last row.
 * - "Add new models" adds only the missing, non-retired presets with their promotions, each
 *   stored against its group's table field by field (a field the table holds is followed, one it
 *   lacks is written on the row, a group with neither rows nor table gets the catalog's), and
 *   moves nothing else; "Restore defaults" puts built-in rows and built-in group tables back to
 *   the catalog's shape, keeping keys (a key every keyed row of a group shares moves to the
 *   group), the user's own rows and groups, a self-hosted group's server (vLLM's base URL),
 *   Penguin Go's promotions, and the references that still name a valid row.
 * - renamedFrom (and a group change) migrates the credential, the config and the default and
 *   vision pointers; without it a rekey is delete-then-create; an invalid one is 400. A
 *   ModelScope settings save is serialized with a group credential write.
 * - The display name is persisted only when it differs from the catalog's; an absent one
 *   inherits, an empty one clears, and a cleared one is restorable.
 * - A scheduled row answers both rates from its one price on disk; a hand-edited price and a
 *   promotion apply in both tiers.
 * - The connectivity test sends the entry's upstream model_id, no tools, works for saved and
 *   draft models, converges to ok:false with no credential, tests the draft (clearApiKey) rather
 *   than the stored key, and refuses a keyless gateway row or a Penguin Go probe without reaching
 *   for vendor environment keys or the network (a relay row with no endpoint anywhere included).
 * - A PUT invalidates the Project's cached Session runtimes (reads do not), tells the Project's
 *   open Session channels only, and GET/PUT report the file's updatedAt.
 *
 * One app per describe; every case works in a Project of its own.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODEL_CATALOG,
  PENGUIN_GO_BASE_URL,
  catalogEntryFor,
  catalogGroupConnection,
  presetModelEntries,
  presetPromotions,
  presetProviderTable,
  providerInfo,
  renderProjectConfigToml,
  userText,
} from "@prismshadow/penguin-core";
import type {
  ErrorBody,
  ModelsResponse,
  ModelTestResponse,
  ModelVisionDetectResponse,
  PresetSyncResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { fakeSession, sessionRow } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

/** Preset paired refs (config primary key = (provider, model_id)): retired catalog rows are not presets. */
const catalogPairs = MODEL_CATALOG.filter((m) => m.retired !== true).map(
  (m) => `${m.provider}\0${m.modelId}`,
);
/** Response row → comparable paired key (test-only comparison, not the storage format). */
const pairKey = (m: { provider: string; modelId: string }): string => `${m.provider}\0${m.modelId}`;
/** Fetch a row by its paired ref. */
const pick = (body: ModelsResponse, provider: string, modelId: string) =>
  body.models.find((m) => m.provider === provider && m.modelId === modelId)!;

/**
 * Writes rows straight into a Project's config file, as a table saved before a rule existed
 * would hold them: rows a built-in group no longer takes from a PUT (see "model_not_addable")
 * are only ever reached this way. Beside them, the built-in groups' tables a new Project is
 * written with — so the file carries a `[providers]` table, as every file this release writes
 * does, and the one-time connection migration leaves it alone.
 */
async function storeRows(
  root: string,
  projectId: string,
  rows: Array<{ provider: string; modelId: string; clientType?: string }>,
): Promise<void> {
  await writeFile(
    path.join(root, projectId, ".project_config.toml"),
    renderProjectConfigToml({
      providers: presetProviderTable(),
      models: rows.map((r) => ({
        provider: r.provider,
        model_id: r.modelId,
        ...(r.clientType !== undefined ? { client_type: r.clientType } : {}),
      })),
    }),
    "utf8",
  );
}

describe("models preset & catalog enrichment", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await api.post("/api/projects", {
        projectId: `alice-preset_${projects}`,
        name: "Preset project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
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

  it("a new Project's file carries every built-in model and each built-in group's endpoint and protocol, and every preset runs on what the file says", async () => {
    const res = await api.get(url());
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.defaultModel).toEqual({
      provider: "deepseek",
      modelId: "deepseek-flash",
    });
    expect(body.models.map(pairKey)).toEqual(catalogPairs);
    // A retired catalog row is kept only for the Projects that already carry it, so a new
    // Project gets none of them.
    const retired = MODEL_CATALOG.filter((m) => m.retired === true).map(pairKey);
    expect(retired.length).toBeGreaterThan(0);
    expect(body.models.map(pairKey).filter((key) => retired.includes(key))).toEqual([]);

    // The catalog's group connections are written into the file once, as `[providers.<id>]`
    // tables: the gateways', vLLM's protocol, Penguin Go's relay. The first-party vendors and
    // custom get none — their rows run on the client's defaults, or carry their own.
    const toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    for (const id of Object.keys(presetProviderTable())) {
      expect(toml, id).toContain(`[providers.${id}]`);
    }
    for (const [id, connection] of Object.entries(body.providers)) {
      const catalog = catalogGroupConnection(id)!;
      expect(connection, id).toEqual({
        ...(catalog.base_url !== undefined ? { baseUrl: catalog.base_url } : {}),
        ...(catalog.client_type !== undefined ? { clientType: catalog.client_type } : {}),
      });
    }
    for (const id of ["deepseek", "anthropic", "openai", "custom"]) {
      expect(body.providers[id], id).toBeUndefined();
    }

    // Every row reads its context window, list price and vision flag off the file — `false`
    // written where the catalog says so, nothing (= supported) elsewhere — and is labelled with
    // its catalog name. It carries no secret.
    for (const row of body.models) {
      const entry = catalogEntryFor(row.provider, row.modelId)!;
      const key = `${row.provider}/${row.modelId}`;
      expect(row.displayName, key).toBe(entry.displayName);
      expect(row.contextWindow, key).toBe(entry.contextWindow);
      expect(row.vision, key).toBe(entry.supportsVision ? undefined : false);
      expect(row.credential?.apiKeyMasked, key).toBeUndefined();
    }

    // A gateway preset stores nothing of its own and follows its group's table.
    expect(pick(body, "openrouter", "anthropic/claude-opus-4.8")).toMatchObject({
      effective: {
        baseUrl: catalogGroupConnection("openrouter")!.base_url,
        baseUrlSource: "provider",
        clientType: catalogGroupConnection("openrouter")!.client_type,
        clientTypeSource: "provider",
      },
    });
    expect(pick(body, "openrouter", "anthropic/claude-opus-4.8").clientType).toBeUndefined();
    // A row that speaks another protocol than its group, or on another path, stores exactly
    // that difference: OpenCode Go's Messages rows their protocol and endpoint, its Chat
    // Completions rows their protocol on the group's endpoint, Penguin Go's rows their protocol
    // on the relay's.
    const messagesRow = pick(body, "opencode-go", "qwen3.8-max");
    expect(messagesRow.clientType).toBe("ant-messages");
    expect(messagesRow.effective).toMatchObject({
      baseUrl: catalogEntryFor("opencode-go", "qwen3.8-max")!.baseUrl,
      baseUrlSource: "model",
      clientTypeSource: "model",
    });
    expect(pick(body, "opencode-go", "glm-5.3").effective).toMatchObject({
      baseUrlSource: "provider",
      clientType: "openai-chat",
      clientTypeSource: "model",
    });
    expect(pick(body, "penguin-go", "gemini-3.8-flash").effective).toMatchObject({
      baseUrl: PENGUIN_GO_BASE_URL,
      baseUrlSource: "provider",
      clientType: "google-genai",
      clientTypeSource: "model",
    });
    // Custom's Atria carries its own host and protocol; no group of its table reaches it.
    expect(pick(body, "custom", "Atria-Dawn-Preview").effective).toMatchObject({
      baseUrl: catalogEntryFor("custom", "Atria-Dawn-Preview")!.baseUrl,
      baseUrlSource: "model",
      clientTypeSource: "model",
    });
    // Like every gateway's rows, neither OpenCode Go row falls back to its client's
    // environment variable — that holds the user's vendor key, and the gateway is not the
    // vendor.
    expect(messagesRow.envKey).toBeUndefined();
    expect(pick(body, "opencode-go", "glm-5.3").envKey).toBeUndefined();

    // A vendor's own row stores nothing and goes to the client's defaults: MMSP routes it by
    // the family its upstream id begins with, and it falls back to its client's variable.
    const sonnet = pick(body, "anthropic", "claude-sonnet-4-6");
    expect(sonnet.isDefault).toBe(false);
    expect(sonnet.envKey).toBe("ANTHROPIC_API_KEY");
    expect(sonnet.credential).toBeUndefined();
    expect(sonnet.clientType).toBeUndefined();
    expect(sonnet.effective).toMatchObject({ baseUrlSource: "none", clientTypeSource: "none" });
    expect(pick(body, "deepseek", "deepseek-v4-pro").envKey).toBe("DEEPSEEK_API_KEY");
    expect(pick(body, "deepseek", "deepseek-flash").isDefault).toBe(true);

    // A catalog row on a promotion is preset at its LIST price like every other row, and the
    // promotion is seeded beside it in web.db: the rows reporting a discount are exactly the
    // catalog's flat promotions.
    const promoted = catalogEntryFor("tokendance", "glm-5.3-flash")!;
    expect(pick(body, "tokendance", "glm-5.3-flash")).toMatchObject({
      pricing: {
        cacheRead: promoted.pricing!.cache_read,
        cacheWrite: promoted.pricing!.cache_write,
        output: promoted.pricing!.output,
      },
      discount: promoted.discount,
    });
    expect(
      body.models
        .filter((m) => m.discount !== undefined)
        .map((m) => ({ provider: m.provider, modelId: m.modelId, discount: m.discount })),
    ).toEqual(presetPromotions());
    // An undiscounted row is preset at its list price, unchanged, and reports no discount.
    const plain = catalogEntryFor("tokendance", "hy4-preview")!;
    expect(pick(body, "tokendance", "hy4-preview").pricing).toEqual({
      cacheRead: plain.pricing!.cache_read,
      cacheWrite: plain.pricing!.cache_write,
      output: plain.pricing!.output,
    });
    expect(pick(body, "tokendance", "hy4-preview")).not.toHaveProperty("discount");
  });

  it("reports and masks the env fallback only where the entry is allowed one (the vendor's own endpoint, or the relay's own variable), and never leaks a value", async () => {
    const saved = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      penguin: process.env.PENGUIN_GO_API_KEY,
    };
    const anthropicValue = "sk-ant-test-secret-value-123456";
    const openaiValue = "sk-openai-test-secret-value-789";
    process.env.ANTHROPIC_API_KEY = anthropicValue;
    process.env.OPENAI_API_KEY = openaiValue;
    process.env.PENGUIN_GO_API_KEY = "sk-penguin-test-secret-value-456";
    // Empty counts as absent — it would not authenticate either.
    process.env.DEEPSEEK_API_KEY = "";
    // Two vendor-group rows no PUT may add any more, stored as a table from before would hold them.
    await storeRows(t.root, projectId, [
      { provider: "anthropic", modelId: "claude-sonnet-4-6-preview" },
      { provider: "anthropic", modelId: "claude-via-gateway", clientType: "openai" },
    ]);
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
          // Vendor group on a generic protocol with no base URL: the OpenAI client talks to
          // api.openai.com, so the OpenAI key may back it — whatever the group is called — but
          // it is not shown as configured: the id's family names another client.
          { provider: "anthropic", modelId: "claude-via-gateway", clientType: "openai" },
          // A gateway row carries the gateway's endpoint: no fallback at all, so no envKey
          // and no preview, even with OPENAI_API_KEY set.
          {
            provider: "openrouter",
            modelId: "xiaomi/mimo-v2.5",
            clientType: "openai-chat",
            baseUrl: "https://openrouter.ai/api/v1",
          },
          // Custom rows are judged by their endpoint: none → the vendor's own (a fallback, but
          // not a preview — see modelEnvPreviewKey); a private server → nothing.
          { provider: "custom", modelId: "my-model", clientType: "openai" },
          {
            provider: "custom",
            modelId: "my-local",
            clientType: "openai",
            baseUrl: "http://127.0.0.1:8000/v1",
          },
          // A vLLM preset as seeded: no base URL, the vLLM adapter pinned. It falls back to
          // OPENAI_API_KEY under the rule, but showing the mask would list a self-hosted id in
          // the chat picker as configured and send the OpenAI key to api.openai.com.
          { provider: "vllm", modelId: "Qwen/Qwen3.8-27B", clientType: "openai-chat-vllm-adapter" },
          // Both protocols in the relay group resolve the same provider-scoped key.
          {
            provider: "penguin-go",
            modelId: "gemini-3.8-flash",
            clientType: "google-genai",
            baseUrl: PENGUIN_GO_BASE_URL,
          },
          {
            provider: "penguin-go",
            modelId: "deepseek-flash",
            clientType: "deepseek-official",
            baseUrl: PENGUIN_GO_BASE_URL,
          },
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
      expect(gateway.envKey).toBeUndefined();
      expect(gateway.envKeyMasked).toBeUndefined();
      expect(pick(body, "custom", "my-model").envKey).toBe("OPENAI_API_KEY");
      expect(pick(body, "custom", "my-model").envKeyMasked).toBeUndefined();
      expect(pick(body, "custom", "my-local").envKey).toBeUndefined();
      expect(pick(body, "custom", "my-local").envKeyMasked).toBeUndefined();
      const vllm = pick(body, "vllm", "Qwen/Qwen3.8-27B");
      expect(vllm.envKey).toBe("OPENAI_API_KEY");
      expect(vllm.envKeyMasked).toBeUndefined();
      const penguinMasked = "sk-p…-456";
      expect(pick(body, "penguin-go", "gemini-3.8-flash").envKey).toBe("PENGUIN_GO_API_KEY");
      expect(pick(body, "penguin-go", "gemini-3.8-flash").envKeyMasked).toBe(penguinMasked);
      expect(pick(body, "penguin-go", "deepseek-flash").envKey).toBe("PENGUIN_GO_API_KEY");
      expect(pick(body, "penguin-go", "deepseek-flash").envKeyMasked).toBe(penguinMasked);
    } finally {
      for (const [key, value] of [
        ["ANTHROPIC_API_KEY", saved.anthropic],
        ["DEEPSEEK_API_KEY", saved.deepseek],
        ["OPENAI_API_KEY", saved.openai],
        ["PENGUIN_GO_API_KEY", saved.penguin],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("a padded modelId is normalized once at the boundary: stored as the preset spelling, no padded near-duplicate row", async () => {
    // The service's gates judge the trimmed id (unaddableModel / unroutableVendorModel
    // trim) while the dedup and the stored model_id compare it verbatim — a padded
    // spelling of a preset passes the gates and lands as an unroutable near-duplicate
    // of the catalog row. The route's parse layer is the single ingestion point.
    const put = await api.put(url(), {
      models: [{ provider: "deepseek", modelId: " deepseek-flash " }],
    });
    expect(put.status).toBe(200);

    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "deepseek", "deepseek-flash")).toBeDefined();
    expect(body.models.some((m) => m.modelId !== m.modelId.trim())).toBe(false);
  });

  it("two spellings of one id (padded and plain) are one reference after normalization: the padded duplicate is a 400", async () => {
    const put = await api.put(url(), {
      models: [
        { provider: "deepseek", modelId: "deepseek-flash" },
        { provider: "deepseek", modelId: " deepseek-flash " },
      ],
    });
    expect(put.status).toBe(400);
  });

  it("PUT a custom model: the vision flag persists; the openai protocol falls back to OPENAI_API_KEY; provider is required", async () => {
    // A vendor-group row on the openai protocol, as a group header's add once wrote it.
    await storeRows(t.root, projectId, [
      { provider: "anthropic", modelId: "claude-via-gateway", clientType: "openai" },
    ]);
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
    // MMSP's openai-chat client actually reads OPENAI_API_KEY, so the env fallback reports that, not the vendor's var name.
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

  it("PUT refuses an id a vendor group cannot route when the request introduces it, and carries a stored one through", async () => {
    const cfgFile = path.join(t.root, projectId, ".project_config.toml");
    // A row in the shape a vendor-group add used to produce: no client_type, and an id of no
    // family MMSP knows, so it fails at request time with its `No client for model` sentence.
    // Rows like this exist in configs written before the rule below.
    await writeFile(
      cfgFile,
      ["[[models]]", 'provider = "deepseek"', 'model_id = "qwen/qwen3.8-flash-next"'].join("\n"),
      "utf8",
    );

    // Already stored: the whole-table PUT writes it back untouched. The models page sends the
    // entire table on every save, so refusing it here would make one legacy row block every
    // later edit of every other row.
    const kept = await api.put(url(), {
      models: [
        { provider: "deepseek", modelId: "qwen/qwen3.8-flash-next", contextWindow: 65536 },
        { provider: "custom", modelId: "mine", clientType: "openai-chat" },
      ],
    });
    expect(kept.status).toBe(200);
    const keptBody = (await kept.json()) as ModelsResponse;
    expect(pick(keptBody, "deepseek", "qwen/qwen3.8-flash-next").contextWindow).toBe(65536);

    // New in this request: refused, by a code the frontend can localize and a message naming
    // the entry and the way out.
    const added = await api.put(url(), {
      models: [
        { provider: "deepseek", modelId: "qwen/qwen3.8-flash-next" },
        { provider: "deepseek", modelId: "another-fine-tune" },
      ],
    });
    expect(added.status).toBe(400);
    const error = ((await added.json()) as ErrorBody).error;
    expect(error.code).toBe("model_not_routable");
    expect(error.message).toContain("another-fine-tune");
    expect(error.message).toContain("custom group");

    // A changed id is a different entry, so the rename is judged like a new one.
    const renamed = await api.put(url(), {
      models: [
        {
          provider: "deepseek",
          modelId: "qwen/qwen3.8-flash-next-preview",
          renamedFrom: { provider: "deepseek", modelId: "qwen/qwen3.8-flash-next" },
        },
      ],
    });
    expect(renamed.status).toBe(400);
    expect(((await renamed.json()) as ErrorBody).error.code).toBe("model_not_routable");

    // So is moving a model into a vendor group: the group is the half of the key that changed.
    const moved = await api.put(url(), {
      models: [
        { provider: "deepseek", modelId: "qwen/qwen3.8-flash-next" },
        {
          provider: "deepseek",
          modelId: "mine",
          renamedFrom: { provider: "custom", modelId: "mine" },
        },
      ],
    });
    expect(moved.status).toBe(400);

    // Nothing above was written: the stored table is still the one the accepted PUT left.
    const stored = (await (await api.get(url())).json()) as ModelsResponse;
    const expected = ["custom\0mine", "deepseek\0qwen/qwen3.8-flash-next"];
    expect(stored.models.map(pairKey).sort()).toEqual(expected.sort());

    // The same id is accepted wherever the group answers the protocol question itself.
    const custom = await api.put(url(), {
      models: [
        { provider: "deepseek", modelId: "qwen/qwen3.8-flash-next" },
        {
          provider: "custom",
          modelId: "qwen/qwen3.8-flash-next",
          clientType: "openai-chat",
          baseUrl: "https://gateway.example/v1",
        },
      ],
    });
    expect(custom.status).toBe(200);
  });

  it("PUT refuses a hand-added model where the group takes none and keeps every stored one; OpenRouter, TokenDance and SiliconFlow take one bare", async () => {
    // A row a user added to a gateway group while every gateway still took them.
    await storeRows(t.root, projectId, [
      { provider: "fireworks", modelId: "acme/legacy-pick", clientType: "openai-chat" },
      { provider: "custom", modelId: "mine", clientType: "openai-chat" },
    ]);
    const legacy = {
      provider: "fireworks",
      modelId: "acme/legacy-pick",
      clientType: "openai-chat",
    };
    const mine = { provider: "custom", modelId: "mine", clientType: "openai-chat" };

    // New in this request, in two gateways that carry their presets only and in a vendor
    // group — the last one an id the vendor's client would route, so it is this rule and not
    // routing that answers.
    for (const entry of [
      { provider: "fireworks", modelId: "acme/new-pick", clientType: "openai-chat" },
      { provider: "qwen-pay-as-you-go", modelId: "acme/new-pick", clientType: "openai-chat" },
      { provider: "deepseek", modelId: "deepseek-v4-my-tune" },
    ]) {
      const res = await api.put(url(), { models: [legacy, mine, entry] });
      expect(res.status, entry.provider).toBe(400);
      const error = ((await res.json()) as ErrorBody).error;
      expect(error.code, entry.provider).toBe("model_not_addable");
      expect(error.message).toContain(entry.modelId);
      expect(error.message).toContain("custom group");
    }

    // Moving a row in from another group is adding it to this one.
    const moved = await api.put(url(), {
      models: [
        legacy,
        {
          provider: "fireworks",
          modelId: "mine",
          clientType: "openai-chat",
          renamedFrom: { provider: "custom", modelId: "mine" },
        },
      ],
    });
    expect(moved.status).toBe(400);
    expect(((await moved.json()) as ErrorBody).error.code).toBe("model_not_addable");

    // Nothing above was written.
    const before = (await (await api.get(url())).json()) as ModelsResponse;
    expect(before.models.map(pairKey).sort()).toEqual(
      ["custom\0mine", "fireworks\0acme/legacy-pick"].sort(),
    );

    // The stored row keeps working: edited in place, then renamed inside its own group.
    const edited = await api.put(url(), { models: [{ ...legacy, contextWindow: 65536 }, mine] });
    expect(edited.status).toBe(200);
    const renamed = await api.put(url(), {
      models: [
        {
          provider: "fireworks",
          modelId: "acme/renamed-pick",
          clientType: "openai-chat",
          renamedFrom: { provider: "fireworks", modelId: "acme/legacy-pick" },
        },
        mine,
      ],
    });
    expect(renamed.status).toBe(200);
    const after = (await renamed.json()) as ModelsResponse;
    expect(after.models.map(pairKey).sort()).toEqual(
      ["custom\0mine", "fireworks\0acme/renamed-pick"].sort(),
    );

    // A group's own preset is welcome back, and custom, vLLM, the three open gateways and
    // user-defined groups take anything.
    const open = await api.put(url(), {
      models: [
        { provider: "fireworks", modelId: "acme/renamed-pick", clientType: "openai-chat" },
        mine,
        { provider: "deepseek", modelId: "deepseek-v4-pro" },
        {
          provider: "vllm",
          modelId: "my-served-model",
          clientType: "openai-chat-vllm-adapter",
          baseUrl: "http://127.0.0.1:8000/v1",
        },
        { provider: "my-own-group", modelId: "anything", clientType: "openai-chat" },
        { provider: "openrouter", modelId: "acme/new-pick" },
        { provider: "tokendance", modelId: "acme/new-pick" },
        { provider: "siliconflow", modelId: "acme/new-pick" },
      ],
    });
    expect(open.status).toBe(200);
    // A model added to one of the open gateways is stored as sent — no endpoint and no
    // protocol of its own — and runs on the gateway's, through its group's table.
    const body = (await open.json()) as ModelsResponse;
    for (const provider of ["openrouter", "tokendance", "siliconflow"]) {
      const row = pick(body, provider, "acme/new-pick");
      expect(row.clientType, provider).toBeUndefined();
      expect(row.credential, provider).toBeUndefined();
      expect(row.effective, provider).toMatchObject({
        baseUrl: body.providers[provider]!.baseUrl,
        baseUrlSource: "provider",
        clientType: body.providers[provider]!.clientType,
        clientTypeSource: "provider",
      });
    }
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
    // Its own endpoint, so no environment fallback is reported for it.
    expect(legacy.envKey).toBeUndefined();
  });

  it("a file from before MMSP's names and group connections is rewritten once, on its first read, into the shape a new Project is written in — no model changes where its requests go", async () => {
    // A Project written before MMSP 0.5.0 and before `[providers.<id>]`: the old router's
    // per-generation names (which MMSP refuses at client construction), every preset row
    // carrying its own copy of its protocol and endpoint, and a group key copied onto each row
    // of the group. The service's reader rewrites the file the moment it reads it, so every
    // consumer of the table — this GET, a Session's credential resolution, the scheduler —
    // sees the new shape. The catalog is not consulted: what moves is what the rows share.
    const legacyName: Record<string, string> = {
      "google-genai": "gemini-3.8",
      "deepseek-official": "deepseek-v4",
    };
    const oldRows = (provider: string, key: (i: number) => string) =>
      MODEL_CATALOG.filter((m) => m.provider === provider && m.retired !== true).flatMap((m, i) => [
        "[[models]]",
        `provider = "${provider}"`,
        `model_id = "${m.modelId}"`,
        `client_type = "${legacyName[m.clientType!] ?? m.clientType}"`,
        `base_url = "${m.baseUrl}"`,
        `api_key = "${key(i)}"`,
        `created_at = "2026-09-30T10:${String(i).padStart(2, "0")}:00.000Z"`,
        "",
      ]);
    const tokendance = catalogGroupConnection("tokendance")!;
    const cfgFile = path.join(t.root, projectId, ".project_config.toml");
    await writeFile(
      cfgFile,
      [
        'name = "Legacy"',
        ...oldRows("opencode-go", () => "oc-shared-key-0001"),
        ...oldRows("penguin-go", () => "pg-shared-key-0002"),
        // Two models keyed to two accounts: no key is the group's.
        ...["glm-5.3", "glm-5.3-flash"].flatMap((modelId, i) => [
          "[[models]]",
          'provider = "tokendance"',
          `model_id = "${modelId}"`,
          `client_type = "${tokendance.client_type}"`,
          `base_url = "${tokendance.base_url}"`,
          `api_key = "td-own-key-000${i}"`,
          "",
        ]),
      ].join("\n"),
      "utf8",
    );
    const body = (await (await api.get(url())).json()) as ModelsResponse;

    // OpenCode Go: the Chat Completions endpoint most rows share moves to the group; the
    // Messages rows keep theirs (another path on the same host), every row keeps its own
    // protocol, and the shared key — which reaches every row — is the group's, stamped with
    // the latest write. Penguin Go: the relay every row shares moves to the group, each row
    // keeps its protocol (renamed to MMSP's name), the key is the group's. Exactly what a new
    // Project's file holds for those rows, plus the key.
    const init = new Map(
      presetModelEntries().map((m) => [pairKey({ provider: m.provider, modelId: m.model_id }), m]),
    );
    for (const [provider, keyMask] of [
      ["opencode-go", "oc-s…0001"],
      ["penguin-go", "pg-s…0002"],
    ] as const) {
      const rows = body.models.filter((m) => m.provider === provider);
      expect(body.providers[provider], provider).toEqual({
        baseUrl: catalogGroupConnection(provider)!.base_url,
        apiKeyMasked: keyMask,
        createdAt: `2026-09-30T10:${String(rows.length - 1).padStart(2, "0")}:00.000Z`,
      });
      for (const row of rows) {
        const seeded = init.get(pairKey(row))!;
        const key = pairKey(row);
        expect(row.clientType, key).toBe(seeded.client_type);
        expect(row.credential, key).toEqual(
          seeded.base_url !== undefined ? { baseUrl: seeded.base_url } : undefined,
        );
        expect(row.effective, key).toMatchObject({
          apiKeySource: "provider",
          apiKeyMasked: keyMask,
        });
      }
    }
    // TokenDance: the endpoint and protocol both rows carried are the group's; the two keys
    // stay where they were, each row on its own account.
    expect(body.providers.tokendance).toEqual({
      baseUrl: tokendance.base_url,
      clientType: tokendance.client_type,
    });
    expect(pick(body, "tokendance", "glm-5.3").credential).toEqual({
      apiKeyMasked: "td-o…0000",
    });
    expect(pick(body, "tokendance", "glm-5.3-flash").credential).toEqual({
      apiKeyMasked: "td-o…0001",
    });

    const rewritten = await readFile(cfgFile, "utf8");
    expect(rewritten.match(/oc-shared-key-0001/g)).toHaveLength(1);
    expect(rewritten.match(/pg-shared-key-0002/g)).toHaveLength(1);
    expect(rewritten).not.toMatch(/gemini-3\.8"|deepseek-v4"/);
    expect(rewritten).toContain('name = "Legacy"');
    // The rewritten file is what later reads serve, and they leave it alone.
    const { mtimeMs } = await stat(cfgFile);
    await api.get(url());
    expect((await stat(cfgFile)).mtimeMs).toBe(mtimeMs);
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
        "[providers]",
        "",
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
    // It still carries the gateway's endpoint, so it gets no environment fallback.
    expect(orphan.envKey).toBeUndefined();
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
    // The gateway's copy was added by hand, before gateways stopped taking such rows.
    await storeRows(t.root, projectId, [
      { provider: "siliconflow", modelId: "kimi-k2.6", clientType: "openai" },
    ]);
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
    // Saved without a base URL of its own, the gateway's row runs on its group's endpoint —
    // the gateway's, not the vendor's — so no vendor variable backs it.
    expect(pick(body, "siliconflow", "kimi-k2.6").envKey).toBeUndefined();
    expect(pick(body, "siliconflow", "kimi-k2.6").effective.baseUrlSource).toBe("provider");

    // Round-trips through disk unchanged.
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(again.models.map(pairKey).sort()).toEqual(body.models.map(pairKey).sort());
  });
});

describe("default_project presets", () => {
  let t: TestApp;
  let prevKey: string | undefined;

  beforeEach(() => {
    // The default model routes to MMSP's DeepSeek client, which requires a credential at
    // **construction time** — this case creates a Session, so we stuff in a fake key (no real request is sent). CI has no keys.
    prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key-not-used";
  });
  afterEach(async () => {
    if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevKey;
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
    expect(body.defaultModel).toEqual({
      provider: "deepseek",
      modelId: "deepseek-flash",
    });
    expect(body.models.map(pairKey)).toEqual(catalogPairs);
    // The built-in groups' tables come with them, as in a new Project.
    expect(Object.keys(body.providers).sort()).toEqual(Object.keys(presetProviderTable()).sort());
    // Presets backfilled here bring their promotions too, seeded once the Project row exists.
    expect(body.models.filter((m) => m.discount !== undefined)).toHaveLength(
      presetPromotions().length,
    );

    // The point of presets is "works out of the box": creating a Session should succeed without passing a model ref.
    const created = await api.post(
      "/api/projects/default_project/agents/default_agent/sessions",
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;
    expect(session.provider).toBe("deepseek");
    expect(session.modelId).toBe("deepseek-flash");
  });

  it("a default_project with a group table but no models keeps the table, and the backfilled models of that group follow it", async () => {
    t = await createTestApp({
      beforeSeed: async (root) => {
        await wire(ProjectConfigService, { paths: { root } }).writeRaw("default_project", {
          providers: {
            openrouter: { base_url: "https://or-proxy.example/v1", api_key: "sk-or-cli-0018" },
          },
          models: [],
        });
      },
    });
    const { cookie } = await loginAdmin(t.app);
    const api = apiClient(t.app, cookie);
    const body = (await (
      await api.get("/api/projects/default_project/models")
    ).json()) as ModelsResponse;
    expect(body.models.map(pairKey)).toEqual(catalogPairs);
    // The table the file held is kept as it was: the catalog's protocol is not added to it.
    expect(body.providers.openrouter).toEqual({
      baseUrl: "https://or-proxy.example/v1",
      apiKeyMasked: "sk-o…0018",
    });
    // Its models follow its endpoint and carry the protocol it lacks; other groups get theirs.
    for (const row of body.models.filter((m) => m.provider === "openrouter")) {
      expect(row.credential, row.modelId).toBeUndefined();
      expect(row.clientType, row.modelId).toBe(catalogGroupConnection("openrouter")!.client_type);
      expect(row.effective.baseUrl, row.modelId).toBe("https://or-proxy.example/v1");
    }
    expect(body.providers.tokendance).toBeDefined();
  });

  it("a default_project that already has models configured is left untouched (existing CLI config is not overwritten)", async () => {
    // First have the "CLI" write a config with a single custom model, then admin seeding adopts it.
    t = await createTestApp({
      beforeSeed: async (root) => {
        await wire(ProjectConfigService, { paths: { root } }).writeRaw("default_project", {
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

describe("the file is the only truth: the catalog seeds a Project and is never a fallback", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;

  beforeAll(async () => {
    // Titles stay off, so the model is asked for the Task alone.
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    api = apiClient(t.app, (await provisionUser(t.app, "ivy")).cookie);
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await api.post("/api/projects", { projectId: `ivy-truth_${projects}`, name: "Truth" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  it("a Session on an OpenRouter preset of a new Project is built with its group table's endpoint, protocol and key", async () => {
    const table = catalogGroupConnection("openrouter")!;
    expect(
      (await api.put(`${url()}/providers/openrouter`, { apiKey: "sk-or-session-0015" })).status,
    ).toBe(200);
    const network = stubFetch(() =>
      jsonResponse({ error: { message: "Incorrect API key provided." } }, 401),
    );
    const created = await api.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      provider: "openrouter",
      modelId: "anthropic/claude-opus-4.8",
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;
    const posted = await api.post(`/api/sessions/${session.sessionId}/tasks`, {
      input: [{ type: "text", text: "hello" }],
    });
    expect(posted.status).toBe(202);
    // The table's protocol is the Responses API, on the table's endpoint, with the group key.
    const toModel = () => network.calls.filter((c) => c.url.includes("/responses"));
    await waitFor(() => toModel().length > 0, 20_000);
    for (const call of toModel()) {
      expect(call.url).toBe(`${table.base_url}/responses`);
      expect(call.headers.get("authorization")).toBe("Bearer sk-or-session-0015");
    }
    await waitFor(() => t.deps.manager.statusOf(session.sessionId) !== "running", 20_000);
  });

  it("with OpenRouter's table cleared, a probe of its preset goes where the client's defaults send it — the catalog's gateway does not come back", async () => {
    await api.put(`${url()}/providers/openrouter`, { baseUrl: null, clientType: null });
    const network = stubFetch(() =>
      jsonResponse({ error: { message: "Incorrect API key provided." } }, 401),
    );
    const probe = {
      provider: "openrouter",
      modelId: "anthropic/claude-opus-4.8",
      apiKey: "sk-or-row-0016",
    };
    // No protocol anywhere in the file: MMSP has no family for this id, and nothing is sent.
    const unrouted = (await (await api.post(`${url()}/test`, probe)).json()) as ModelTestResponse;
    expect(unrouted.ok).toBe(false);
    expect(network.calls).toEqual([]);
    // A protocol of its own and still no endpoint: the client's own default host.
    const routed = (await (
      await api.post(`${url()}/test`, { ...probe, clientType: "openai-chat" })
    ).json()) as ModelTestResponse;
    expect(routed.ok).toBe(false);
    expect(network.calls.length).toBeGreaterThan(0);
    for (const call of network.calls) {
      expect(call.url.startsWith("https://api.openai.com/")).toBe(true);
    }
  });

  it("GET reports a value the file lacks as none, wherever the catalog would have put the preset", async () => {
    const svc = t.deps.projectConfigService;
    await svc.writeRaw(projectId, {
      ...(await svc.readRaw(projectId)),
      providers: {},
      models: [{ provider: "openrouter", model_id: "anthropic/claude-opus-4.8" }],
    });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(body.providers).toEqual({});
    expect(pick(body, "openrouter", "anthropic/claude-opus-4.8").effective).toEqual({
      baseUrlSource: "none",
      clientTypeSource: "none",
      apiKeySource: "none",
    });
  });
});

describe("model-reference rekeying and the connectivity test", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;
  const testUrl = () => `${url()}/test`;

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "carol");
    api = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await api.post("/api/projects", {
        projectId: `carol-rename_${projects}`,
        name: "Rename project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
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
    // The env fallback follows client resolution — with no client_type on the entry, MMSP
    // still routes the `deepseek-` id to the DeepSeek client (reading DEEPSEEK_API_KEY),
    // regardless of group membership.
    expect(moved.envKey).toBe("DEEPSEEK_API_KEY");
  });

  it("serializes a ModelScope settings save with a group credential write", async () => {
    const svc = wire(ProjectConfigService, { paths: { root: t.root } });
    const raceProject = "modelscope-save-refresh-race";
    await svc.writeRaw(raceProject, {
      providers: { modelscope: { api_key: "old-access" } },
      models: [
        {
          provider: "modelscope",
          model_id: "Qwen/Qwen3.8-27B",
          client_type: "openai-chat-vllm-adapter",
        },
      ],
    });

    const readRaw = svc.readRaw.bind(svc);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    let announceRead!: () => void;
    const readStarted = new Promise<void>((resolve) => (announceRead = resolve));
    let firstRead = true;
    svc.readRaw = async (id: string) => {
      const raw = await readRaw(id);
      if (firstRead) {
        firstRead = false;
        announceRead();
        await readGate;
      }
      return raw;
    };

    const save = svc.updateModels(raceProject, {
      models: [
        {
          provider: "modelscope",
          modelId: "Qwen/Qwen3.8-27B",
          clientType: "openai-chat-vllm-adapter",
        },
      ],
    });
    await readStarted;
    let credentialWriteSettled = false;
    const credentialWrite = svc
      .setGroupApiKey(raceProject, "modelscope", "new-access")
      .finally(() => {
        credentialWriteSettled = true;
      });
    await Promise.resolve();
    expect(credentialWriteSettled).toBe(false);

    releaseRead();
    await Promise.all([save, credentialWrite]);
    // The save, read before the key was written, did not put the old group key back.
    const stored = await readRaw(raceProject);
    expect((stored.providers as Record<string, Record<string, unknown>>).modelscope?.api_key).toBe(
      "new-access",
    );
    expect(JSON.stringify(stored)).not.toContain("refreshToken");
    expect(JSON.stringify(stored)).not.toContain("accessTokenExpiresAt");
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

  it("a scheduled row answers with both of its rates, from the one stable price on disk", async () => {
    // No clock is passed and none is wanted: which tier a given request ran in is decided from
    // that record's own timestamp when the usage is aggregated, so the price lookup's whole job
    // is to say what the two tiers are. The number on disk is the peak one either way.
    const svc = wire(ProjectConfigService, { paths: { root: t.root } });
    const rates = await svc.getPricing(projectId, "deepseek", "deepseek-flash");
    const catalogPeak = catalogEntryFor("deepseek", "deepseek-flash")!.pricing!;
    expect(rates!.peak.output).toBe(catalogPeak.output);
    expect(rates!.offPeak.output).toBeCloseTo(catalogPeak.output / 2, 5);
    expect(rates!.peak.cacheRead).toBe(catalogPeak.cache_read);
    expect(rates!.offPeak.cacheRead).toBeCloseTo(catalogPeak.cache_read / 2, 6);
  });

  it("a hand-edited price on a scheduled row is billed as typed, in both tiers", async () => {
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    const entries = body.models.map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      ...(m.pricing
        ? {
            pricing:
              m.provider === "deepseek" && m.modelId === "deepseek-flash"
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
    const svc = wire(ProjectConfigService, { paths: { root: t.root } });
    // Nothing here knows whether 3 is a peak rate, so halving it would invent a discount: the
    // two tiers collapse to the typed number and the split costs a row and changes nothing.
    const typed = { cacheRead: 1, cacheWrite: 2, output: 3 };
    expect(await svc.getPricing(projectId, "deepseek", "deepseek-flash")).toEqual({
      peak: typed,
      offPeak: typed,
    });
  });

  it("a stored promotion takes its fraction off the list price on disk, multiplied with a scheduled row's off-peak tier", async () => {
    const svc = t.deps.projectConfigService;
    const off = (v: number, fraction: number): number => Math.round(v * (1 - fraction) * 1e6) / 1e6;
    // Seeded with the Project: TokenDance's glm-5.3-flash is on 10% off.
    const list = catalogEntryFor("tokendance", "glm-5.3-flash")!.pricing!;
    const promoted = {
      cacheRead: off(list.cache_read, 0.1),
      cacheWrite: off(list.cache_write, 0.1),
      output: off(list.output, 0.1),
    };
    expect(await svc.getPricing(projectId, "tokendance", "glm-5.3-flash")).toEqual({
      peak: promoted,
      offPeak: promoted,
    });

    // A scheduled row still at the catalog's peak price, with a promotion of its own: peak bills
    // the promotion alone, off-peak the half-price tier with the promotion taken off it too.
    const peak = catalogEntryFor("deepseek", "deepseek-v4-flash")!.pricing!;
    await svc.updateModels(projectId, {
      models: [
        {
          provider: "deepseek",
          modelId: "deepseek-v4-flash",
          pricing: {
            cacheRead: peak.cache_read,
            cacheWrite: peak.cache_write,
            output: peak.output,
          },
          discount: 0.2,
        },
      ],
    });
    const rates = (await svc.getPricing(projectId, "deepseek", "deepseek-v4-flash"))!;
    expect(rates.peak.output).toBe(off(peak.output, 0.2));
    expect(rates.offPeak.output).toBe(off(off(peak.output, 0.5), 0.2));
  });

  it("PUT discount: a declared one is stored and null clears it; an omitted one survives only on an unrenamed row at an unchanged price", async () => {
    const price = { cacheRead: 0.1, cacheWrite: 1, output: 4 };
    const row = (modelId: string, extra: Record<string, unknown> = {}) => ({
      provider: "custom",
      modelId,
      pricing: price,
      ...extra,
    });
    const stored = () =>
      t.deps.db
        .prepare(
          "SELECT model_id, discount FROM model_promotions WHERE project_id = ? ORDER BY model_id",
        )
        .all(projectId);

    const declared = await api.put(url(), {
      models: ["kept", "repriced", "renamed", "cleared", "dropped"].map((id) =>
        row(id, { discount: 0.2 }),
      ),
    });
    expect(declared.status).toBe(200);
    expect(
      ((await declared.json()) as ModelsResponse).models.map((m) => [m.modelId, m.discount]),
    ).toEqual([
      ["kept", 0.2],
      ["repriced", 0.2],
      ["renamed", 0.2],
      ["cleared", 0.2],
      ["dropped", 0.2],
    ]);

    const next = await api.put(url(), {
      models: [
        row("kept"),
        row("repriced", { pricing: { ...price, output: 5 } }),
        row("renamed-to", { renamedFrom: { provider: "custom", modelId: "renamed" } }),
        row("cleared", { discount: null }),
      ],
    });
    expect(next.status).toBe(200);
    expect(
      ((await next.json()) as ModelsResponse).models.map((m) => [m.modelId, m.discount]),
    ).toEqual([
      ["kept", 0.2],
      ["repriced", undefined],
      ["renamed-to", undefined],
      ["cleared", undefined],
    ]);
    // The dropped row's promotion went with it rather than lingering unseen.
    expect(stored()).toEqual([{ model_id: "kept", discount: 0.2 }]);

    // Out of range or not a number: 400 before anything is written, so neither the file nor
    // the table moves — not even for the valid row beside it, whose new price would otherwise
    // have cleared its promotion.
    const cfgFile = path.join(t.root, projectId, ".project_config.toml");
    const before = await readFile(cfgFile, "utf8");
    for (const bad of [0, 1, -0.2, 1.5, "0.2"]) {
      const res = await api.put(url(), {
        models: [
          row("kept", { pricing: { ...price, output: 9 } }),
          row("other", { discount: bad }),
        ],
      });
      expect(res.status, String(bad)).toBe(400);
    }
    expect(await readFile(cfgFile, "utf8")).toBe(before);
    expect(stored()).toEqual([{ model_id: "kept", discount: 0.2 }]);
  });

  it("an absent display name inherits the catalog's; only an empty one clears it", async () => {
    // Two different requests, and reading them as one is how a client that simply has no name
    // for a model — one built from the catalog, which stores no name of its own — destroys the
    // name of every model it sends.
    const cfgFile = path.join(t.root, projectId, ".project_config.toml");
    await api.put(url(), { models: [{ provider: "openai", modelId: "gpt-5.5" }] });
    const inherited = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(inherited, "openai", "gpt-5.5").displayName).toBe("GPT-5.5");
    expect(await readFile(cfgFile, "utf8")).not.toContain("display_name");

    // Cleared: the empty string records the deletion, so the name does not come back on the
    // next load, and the GET reports it as an empty name rather than as no name — the whole
    // table comes back on the next PUT, where "no name" would ask for the catalog's again.
    await api.put(url(), {
      models: [{ provider: "openai", modelId: "gpt-5.5", displayName: "" }],
    });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "openai", "gpt-5.5").displayName).toBe("");
    expect(await readFile(cfgFile, "utf8")).toContain('display_name = ""');
    // And it survives that round trip, exactly as the page performs it.
    await api.put(url(), {
      models: [{ provider: "openai", modelId: "gpt-5.5", displayName: "" }],
    });
    const again = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(again, "openai", "gpt-5.5").displayName).toBe("");
  });

  it("a cleared name is restorable, and clearing a model the catalog does not name writes nothing", async () => {
    await api.put(url(), {
      models: [{ provider: "openai", modelId: "gpt-5.5", displayName: "" }],
    });
    // Naming it again drops the marker rather than leaving both on disk.
    await api.put(url(), {
      models: [{ provider: "openai", modelId: "gpt-5.5", displayName: "Renamed" }],
    });
    const body = (await (await api.get(url())).json()) as ModelsResponse;
    expect(pick(body, "openai", "gpt-5.5").displayName).toBe("Renamed");
    let toml = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).not.toContain('display_name = ""');

    // A model outside the catalog has no name to inherit, so absence already says "no name"
    // and the marker would be noise in the file — an explicitly empty one included.
    await api.put(url(), {
      models: [
        { provider: "openai", modelId: "gpt-5.5", displayName: "Renamed" },
        { provider: "custom", modelId: "my-own-model", displayName: "" },
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
    // Both endpoints refuse the key they are handed.
    const network = stubFetch(() =>
      jsonResponse(
        { error: { message: "Incorrect API key provided.", code: "invalid_api_key" } },
        401,
      ),
    );
    try {
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
      // Each probe went to its own model's endpoint, with its own key.
      const keyAt = (host: string) =>
        network.calls.find((c) => c.url.startsWith(host))?.headers.get("authorization");
      expect(keyAt("https://api.openai.com/")).toBe("Bearer sk-invalid-key-for-test");
      expect(keyAt("https://example.invalid/v1")).toBe("Bearer sk-invalid");
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it("the connectivity test and the group speed test refuse a keyless gateway row without touching the environment", async () => {
    // The #786 review's finding: a keyless gateway row handed the library no key, and its
    // generic client read OPENAI_API_KEY / ANTHROPIC_API_KEY itself — one speed test on a
    // gateway group sent the user's vendor keys to the gateway once per model. Both paths run
    // through testModel; both must refuse before any request leaves the process.
    const saved = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
    process.env.OPENAI_API_KEY = "vendor-openai-must-not-cross";
    process.env.ANTHROPIC_API_KEY = "vendor-anthropic-must-not-cross";
    const network = stubFetch(() => {
      throw new Error("no request may leave the process for a refused probe");
    });
    try {
      // A gateway preset: the group's endpoint, no key. Both OpenAI-protocol gateways and the
      // Messages-protocol custom preset (Atria — the path that carried the Anthropic key in the
      // #786 finding) are refused, and the refusal is the harness's own sentence, never the
      // SDK's text with a vendor variable in it.
      for (const [provider, modelId] of [
        ["tokendance", "glm-5.3"],
        ["openrouter", "openai/gpt-5.5"],
        ["custom", "Atria-Dawn-Preview"],
      ] as const) {
        expect(catalogEntryFor(provider, modelId)).toBeDefined();
        for (const speed of [false, true]) {
          const res = await api.post(testUrl(), { provider, modelId, speed });
          expect(res.status).toBe(200);
          const body = (await res.json()) as ModelTestResponse;
          expect(body.ok).toBe(false);
          expect(body.message).toMatch(/has no API key/);
          expect(body.message).toMatch(/set the API key on the model entry/);
          expect(body.message).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|must-not-cross/);
        }
      }
      // A not-yet-saved custom row pointed at a private server: same refusal.
      const draft = await api.post(testUrl(), {
        provider: "custom",
        modelId: "draft-model",
        clientType: "openai-chat",
        baseUrl: "http://127.0.0.1:9/v1",
      });
      expect(((await draft.json()) as ModelTestResponse).message).toMatch(/has no API key/);
      // The vision probe shares the rule.
      const vision = await api.post(`${url()}/detect-vision`, {
        provider: "tokendance",
        modelId: "glm-5.3",
      });
      expect((await vision.json()) as ModelVisionDetectResponse).toMatchObject({
        outcome: "failed",
        message: expect.stringMatching(/has no API key/) as string,
      });
      expect(network.calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      for (const [key, value] of [
        ["OPENAI_API_KEY", saved.openai],
        ["ANTHROPIC_API_KEY", saved.anthropic],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("Penguin Go probes never substitute vendor environment keys", async () => {
    const saved = {
      gemini: process.env.GEMINI_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      penguin: process.env.PENGUIN_GO_API_KEY,
    };
    process.env.GEMINI_API_KEY = "vendor-gemini-must-not-cross";
    process.env.OPENAI_API_KEY = "vendor-openai-must-not-cross";
    delete process.env.PENGUIN_GO_API_KEY;
    try {
      for (const modelId of ["gemini-3.8-flash", "deepseek-flash"]) {
        const tested = await api.post(testUrl(), { provider: "penguin-go", modelId });
        expect(tested.status).toBe(200);
        expect((await tested.json()) as ModelTestResponse).toMatchObject({
          ok: false,
          message: expect.stringMatching(/has no API key.*PENGUIN_GO_API_KEY/) as string,
        });

        const vision = await api.post(`${url()}/detect-vision`, {
          provider: "penguin-go",
          modelId,
        });
        expect(vision.status).toBe(200);
        expect((await vision.json()) as ModelVisionDetectResponse).toMatchObject({
          outcome: "failed",
          message: expect.stringMatching(/has no API key.*PENGUIN_GO_API_KEY/) as string,
        });
      }

      // A relay row with no endpoint anywhere — a model only the platform knows, tried without
      // one, in a group whose table sets none — is refused before its key goes anywhere.
      process.env.PENGUIN_GO_API_KEY = "penguin-go-key-without-endpoint";
      expect((await api.put(`${url()}/providers/penguin-go`, { baseUrl: null })).status).toBe(200);
      const noEndpoint = await api.post(testUrl(), {
        provider: "penguin-go",
        modelId: "gemini-platform-only",
        clientType: "google-genai",
        baseUrl: null,
      });
      expect((await noEndpoint.json()) as ModelTestResponse).toMatchObject({
        ok: false,
        message: expect.stringMatching(/has no base URL/) as string,
      });
    } finally {
      for (const [key, value] of [
        ["GEMINI_API_KEY", saved.gemini],
        ["OPENAI_API_KEY", saved.openai],
        ["PENGUIN_GO_API_KEY", saved.penguin],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
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

describe("group connections ([providers.<id>])", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;
  const groupUrl = (provider: string) => `${url()}/providers/${provider}`;
  const cfgFile = () => path.join(t.root, projectId, ".project_config.toml");

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "erin")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "frank")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await api.post("/api/projects", { projectId: `erin-groups_${projects}`, name: "Groups" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect((await api.post(`/api/projects/${projectId}/members`, { userId: "frank" })).status).toBe(
      201,
    );
  });

  it("GET reports each group's stored connection, masked, and every row's effective connection with where each value came from", async () => {
    const group = await api.put(groupUrl("openrouter"), {
      baseUrl: "https://proxy.example/openrouter/v1",
      clientType: "openai-chat",
      apiKey: "sk-or-group-0001",
    });
    expect(group.status).toBe(200);
    await api.put(url(), {
      models: [
        { provider: "openrouter", modelId: "xiaomi/mimo-v2.5" },
        {
          provider: "openrouter",
          modelId: "openai/gpt-5.5",
          clientType: "openai-responses",
          apiKey: "sk-or-row-0002",
        },
        { provider: "custom", modelId: "bare-custom" },
      ],
    });
    const res = await api.get(url());
    const text = await res.text();
    expect(text).not.toContain("sk-or-group-0001");
    expect(text).not.toContain("sk-or-row-0002");
    const body = JSON.parse(text) as ModelsResponse;
    expect(body.providers.openrouter).toEqual({
      baseUrl: "https://proxy.example/openrouter/v1",
      clientType: "openai-chat",
      apiKeyMasked: "sk-o…0001",
      createdAt: expect.any(String) as string,
    });
    // A row with nothing of its own follows its group on every field.
    expect(pick(body, "openrouter", "xiaomi/mimo-v2.5").effective).toEqual({
      baseUrl: "https://proxy.example/openrouter/v1",
      baseUrlSource: "provider",
      clientType: "openai-chat",
      clientTypeSource: "provider",
      apiKeySource: "provider",
      apiKeyMasked: "sk-o…0001",
    });
    // A row's own values win field by field; the rest still comes from the group.
    const own = pick(body, "openrouter", "openai/gpt-5.5");
    expect(own.clientType).toBe("openai-responses");
    expect(own.credential?.apiKeyMasked).toBe("sk-o…0002");
    expect(own.effective).toMatchObject({
      baseUrlSource: "provider",
      clientType: "openai-responses",
      clientTypeSource: "model",
      apiKeySource: "model",
      apiKeyMasked: "sk-o…0002",
    });
    // A group with nothing set, a row with nothing of its own and no catalog entry: nothing.
    expect(pick(body, "custom", "bare-custom").effective).toEqual({
      baseUrlSource: "none",
      clientTypeSource: "none",
      apiKeySource: "none",
    });
  });

  it("a group key reaches only the models on its endpoint: custom's local-server key never reaches Atria, nor does OpenRouter's reach a model re-pointed at another host", async () => {
    const preset = (await (await api.get(url())).json()) as ModelsResponse;
    const atria = pick(preset, "custom", "Atria-Dawn-Preview");
    expect(
      (
        await api.put(groupUrl("custom"), {
          baseUrl: "http://127.0.0.1:11434/v1",
          clientType: "openai-chat",
          apiKey: "sk-ollama-0003",
        })
      ).status,
    ).toBe(200);
    await api.put(groupUrl("openrouter"), { apiKey: "sk-or-group-0004" });
    const saved = await api.put(url(), {
      models: [
        // Atria as a new Project stores it: its own host and protocol on the row.
        {
          provider: "custom",
          modelId: atria.modelId,
          clientType: atria.clientType,
          baseUrl: atria.credential?.baseUrl,
        },
        { provider: "custom", modelId: "qwen3.8-27b-local" },
        { provider: "openrouter", modelId: "anthropic/claude-opus-4.8" },
        {
          provider: "openrouter",
          modelId: "openai/gpt-5.5",
          baseUrl: "https://proxy.example/v1",
        },
        {
          provider: "openrouter",
          modelId: "xiaomi/mimo-v2.5",
          baseUrl: "https://openrouter.ai/api/v2",
        },
      ],
    });
    const body = (await saved.json()) as ModelsResponse;
    expect(pick(body, "custom", "qwen3.8-27b-local").effective).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      baseUrlSource: "provider",
      clientType: "openai-chat",
      clientTypeSource: "provider",
      apiKeySource: "provider",
      apiKeyMasked: "sk-o…0003",
    });
    // Atria runs on its own host and protocol, and is lent no key: it needs its own.
    expect(pick(body, "custom", "Atria-Dawn-Preview").effective).toEqual({
      baseUrl: atria.credential?.baseUrl,
      baseUrlSource: "model",
      clientType: atria.clientType,
      clientTypeSource: "model",
      apiKeySource: "none",
    });
    // OpenRouter's key goes with its endpoint: to a model on it, or on another path of its
    // host, and not to one sent elsewhere.
    expect(pick(body, "openrouter", "anthropic/claude-opus-4.8").effective.apiKeySource).toBe(
      "provider",
    );
    expect(pick(body, "openrouter", "xiaomi/mimo-v2.5").effective.apiKeySource).toBe("provider");
    expect(pick(body, "openrouter", "openai/gpt-5.5").effective).toMatchObject({
      baseUrl: "https://proxy.example/v1",
      baseUrlSource: "model",
      apiKeySource: "none",
    });
  });

  it("a PUT carrying providers sets and clears per field and keeps what it omits; a cleared field is the client's default, never the catalog's; an id no group could carry is refused before anything is written", async () => {
    const models = [{ provider: "tokendance", modelId: "glm-5.3" }];
    const catalog = catalogGroupConnection("tokendance")!;
    const set = await api.put(url(), {
      providers: {
        tokendance: { apiKey: "td-group-key-0001", baseUrl: "https://td-proxy.example/v1" },
      },
      models,
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as ModelsResponse).providers.tokendance).toMatchObject({
      apiKeyMasked: "td-g…0001",
      baseUrl: "https://td-proxy.example/v1",
      clientType: catalog.client_type,
    });

    // Cleared field by field; what nobody mentioned stays, and a PUT with no providers at all
    // leaves every group as it was. With the base URL cleared, the row has none: the client's
    // own default endpoint, not the gateway the catalog names.
    await api.put(url(), { providers: { tokendance: { baseUrl: null } }, models });
    const kept = (await (await api.put(url(), { models })).json()) as ModelsResponse;
    expect(kept.providers.tokendance).toEqual({
      clientType: catalog.client_type,
      apiKeyMasked: "td-g…0001",
      createdAt: expect.any(String) as string,
    });
    expect(pick(kept, "tokendance", "glm-5.3").effective).toEqual({
      baseUrlSource: "none",
      clientType: catalog.client_type,
      clientTypeSource: "provider",
      apiKeySource: "provider",
      apiKeyMasked: "td-g…0001",
    });

    const before = await readFile(cfgFile(), "utf8");
    const invalid = await api.put(url(), { providers: { "Not A Group!": {} }, models });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as ErrorBody).error.code).toBe("invalid_provider");
    expect(await readFile(cfgFile(), "utf8")).toBe(before);

    // A group emptied of every field has no table at all.
    const cleared = (await (
      await api.put(url(), {
        providers: { tokendance: { clearApiKey: true, clientType: null } },
        models,
      })
    ).json()) as ModelsResponse;
    expect(cleared.providers.tokendance).toBeUndefined();
    expect(await readFile(cfgFile(), "utf8")).not.toContain("[providers.tokendance]");
    expect(pick(cleared, "tokendance", "glm-5.3").effective).toEqual({
      baseUrlSource: "none",
      clientTypeSource: "none",
      apiKeySource: "none",
    });
  });

  it("the group route is the owner's: a member is refused and an id no group could carry is invalid_provider, nothing written; any group takes a protocol, and a model's own protocol still wins", async () => {
    const before = await readFile(cfgFile(), "utf8");
    expect((await member.put(groupUrl("tokendance"), { apiKey: "td-member-0001" })).status).toBe(
      403,
    );
    const invalid = await api.put(groupUrl("Not_A_Group"), { apiKey: "sk-x-0001" });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as ErrorBody).error.code).toBe("invalid_provider");
    for (const body of [{ apiKey: "" }, { baseUrl: 42 }, { clientType: ["openai-chat"] }]) {
      expect((await api.put(groupUrl("tokendance"), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await readFile(cfgFile(), "utf8")).toBe(before);

    // Penguin Go's models each store their protocol: a group protocol is taken and changes
    // none of them.
    const fixed = await api.put(groupUrl("penguin-go"), { clientType: "openai-chat" });
    expect(fixed.status).toBe(200);
    const body = (await fixed.json()) as ModelsResponse;
    expect(body.providers["penguin-go"]?.clientType).toBe("openai-chat");
    for (const row of body.models.filter((m) => m.provider === "penguin-go")) {
      expect(row.effective.clientType, row.modelId).toBe(row.clientType);
      expect(row.effective.clientTypeSource, row.modelId).toBe("model");
    }

    // Clearing a protocol leaves the group's endpoint and key its own.
    const cleared = await api.put(groupUrl("penguin-go"), {
      clientType: null,
      baseUrl: "https://relay-proxy.example/api",
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as ModelsResponse).providers["penguin-go"]).toEqual({
      baseUrl: "https://relay-proxy.example/api",
    });
  });

  it("a group base URL that is not an absolute http(s) URL is a 400 on both write routes and writes nothing; a valid one is stored and a blank one clears it", async () => {
    const models = [{ provider: "vllm", modelId: "qwen3.8-27b-local" }];
    expect((await api.put(url(), { models })).status).toBe(200);
    const before = await readFile(cfgFile(), "utf8");
    for (const baseUrl of ["not-a-url", "lab.example/v1", "ftp://lab.example/v1"]) {
      const viaGroup = await api.put(groupUrl("vllm"), { baseUrl });
      expect(viaGroup.status, baseUrl).toBe(400);
      const groupError = ((await viaGroup.json()) as ErrorBody).error;
      expect(groupError.code, baseUrl).toBe("bad_request");
      expect(groupError.message, baseUrl).toContain("baseUrl");
      const viaTable = await api.put(url(), { providers: { vllm: { baseUrl } }, models });
      expect(viaTable.status, baseUrl).toBe(400);
      expect(((await viaTable.json()) as ErrorBody).error.code, baseUrl).toBe("bad_request");
    }
    expect(await readFile(cfgFile(), "utf8")).toBe(before);

    const viaGroup = await api.put(groupUrl("vllm"), { baseUrl: " http://10.0.0.5:8000/v1 " });
    expect(viaGroup.status).toBe(200);
    expect(((await viaGroup.json()) as ModelsResponse).providers.vllm?.baseUrl).toBe(
      "http://10.0.0.5:8000/v1",
    );
    const viaTable = await api.put(url(), {
      providers: { vllm: { baseUrl: "https://gpu.example/v1" } },
      models,
    });
    expect(viaTable.status).toBe(200);
    const stored = (await viaTable.json()) as ModelsResponse;
    expect(stored.providers.vllm?.baseUrl).toBe("https://gpu.example/v1");
    expect(pick(stored, "vllm", "qwen3.8-27b-local").effective).toMatchObject({
      baseUrl: "https://gpu.example/v1",
      baseUrlSource: "provider",
    });

    // Blank is not a URL to check: it clears, on either route.
    const clearedByGroup = await api.put(groupUrl("vllm"), { baseUrl: "  " });
    expect(clearedByGroup.status).toBe(200);
    expect(((await clearedByGroup.json()) as ModelsResponse).providers.vllm?.baseUrl).toBe(
      undefined,
    );
    await api.put(groupUrl("vllm"), { baseUrl: "https://gpu.example/v1" });
    const clearedByTable = await api.put(url(), { providers: { vllm: { baseUrl: "" } }, models });
    expect(clearedByTable.status).toBe(200);
    expect(((await clearedByTable.json()) as ModelsResponse).providers.vllm?.baseUrl).toBe(
      undefined,
    );
  });

  it("a group key leaves a model's own key in place, and the connectivity test runs each model on its own key, else the group's, at the group's endpoint", async () => {
    const network = stubFetch(() =>
      jsonResponse({ error: { message: "Incorrect API key provided." } }, 401),
    );
    await api.put(url(), {
      providers: { "my-lab": { baseUrl: "https://lab.example/v1", clientType: "openai-chat" } },
      models: [
        { provider: "my-lab", modelId: "lab-follow" },
        { provider: "my-lab", modelId: "lab-own", apiKey: "sk-own-row-0003" },
      ],
    });
    const keyed = await api.put(groupUrl("my-lab"), { apiKey: "sk-lab-group-0004" });
    expect(keyed.status).toBe(200);
    const body = (await keyed.json()) as ModelsResponse;
    expect(pick(body, "my-lab", "lab-own").credential?.apiKeyMasked).toBe("sk-o…0003");
    expect(pick(body, "my-lab", "lab-follow").effective.apiKeySource).toBe("provider");

    for (const [modelId, key] of [
      ["lab-follow", "sk-lab-group-0004"],
      ["lab-own", "sk-own-row-0003"],
    ] as const) {
      network.calls.length = 0;
      const tested = await api.post(`${url()}/test`, { provider: "my-lab", modelId });
      expect(((await tested.json()) as ModelTestResponse).ok, modelId).toBe(false);
      expect(network.calls.length, modelId).toBeGreaterThan(0);
      for (const call of network.calls) {
        expect(call.url.startsWith("https://lab.example/v1/"), modelId).toBe(true);
        expect(call.headers.get("authorization"), modelId).toBe(`Bearer ${key}`);
      }
    }
  });

  it("a user-defined group's connection goes with its last row; a built-in group keeps its key with no rows", async () => {
    await api.put(groupUrl("tokendance"), { apiKey: "td-group-key-0005" });
    await api.put(url(), {
      providers: { "my-lab": { baseUrl: "https://lab.example/v1", apiKey: "sk-lab-0006" } },
      models: [
        { provider: "my-lab", modelId: "lab-one", clientType: "openai-chat" },
        { provider: "custom", modelId: "keep-me" },
      ],
    });
    const deleted = (await (
      await api.put(url(), { models: [{ provider: "custom", modelId: "keep-me" }] })
    ).json()) as ModelsResponse;
    expect(deleted.providers["my-lab"]).toBeUndefined();
    expect(deleted.providers.tokendance?.apiKeyMasked).toBe("td-g…0005");
    expect(deleted.models.some((m) => m.provider === "tokendance")).toBe(false);
    expect(await readFile(cfgFile(), "utf8")).not.toContain("sk-lab-0006");
  });

  it("a vendor group whose connection names a protocol routes a renamed model by it", async () => {
    // Renaming inside a vendor group is writing a new id there, judged for routability: an id
    // of no vendor family has no client until the group itself names one.
    const renamed = {
      models: [
        {
          provider: "deepseek",
          modelId: "house-tune",
          renamedFrom: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        },
      ],
    };
    const refused = await api.put(url(), renamed);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as ErrorBody).error.code).toBe("model_not_routable");
    const routed = await api.put(url(), {
      ...renamed,
      providers: {
        deepseek: { baseUrl: "https://proxy.example/deepseek/v1", clientType: "openai-chat" },
      },
    });
    expect(routed.status).toBe(200);
    expect(
      pick((await routed.json()) as ModelsResponse, "deepseek", "house-tune").effective,
    ).toMatchObject({ clientType: "openai-chat", clientTypeSource: "provider" });
  });
});

describe("preset sync: add new models / restore defaults", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models`;
  const sync = (mode: unknown, as = api) => as.post(`${url()}/sync-presets`, { mode });
  const cfgFile = () => path.join(t.root, projectId, ".project_config.toml");
  /** The table as the models page sends it back unchanged: each row with what it stores. */
  const asEntries = (body: ModelsResponse) =>
    body.models.map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
      ...(m.clientType !== undefined ? { clientType: m.clientType } : {}),
      ...(m.vision === false ? { vision: false } : {}),
      ...(m.pricing !== undefined ? { pricing: m.pricing } : {}),
    }));
  const isPair =
    (provider: string, modelId: string) => (m: { provider: string; modelId: string }) =>
      m.provider === provider && m.modelId === modelId;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "gina")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "hank")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await api.post("/api/projects", { projectId: `gina-sync_${projects}`, name: "Sync" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  it("adding new models brings back only the presets the table lacks, with their promotions, and moves nothing else", async () => {
    const promoted = catalogEntryFor("tokendance", "glm-5.3-flash")!;
    const preset = (await (await api.get(url())).json()) as ModelsResponse;
    // The user dropped a promoted preset, retyped a price, and keyed a group.
    const edited = asEntries(preset)
      .filter((m) => !isPair("tokendance", "glm-5.3-flash")(m))
      .map((m) =>
        isPair("deepseek", "deepseek-flash")(m)
          ? { ...m, pricing: { cacheRead: 1, cacheWrite: 2, output: 3 } }
          : m,
      );
    expect((await api.put(url(), { models: edited })).status).toBe(200);
    await api.put(`${url()}/providers/tokendance`, { apiKey: "td-group-key-0007" });

    const res = await sync("add");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PresetSyncResponse;
    expect(body).toMatchObject({ added: 1, restored: 0 });
    // Back at the end of the table, as a new Project has it, with its promotion.
    expect(body.models.at(-1)).toMatchObject({
      provider: "tokendance",
      modelId: "glm-5.3-flash",
      discount: promoted.discount,
    });
    // The table is the presets again — no retired row among them — and nothing else moved.
    expect(body.models.map(pairKey).sort()).toEqual([...catalogPairs].sort());
    expect(pick(body, "deepseek", "deepseek-flash").pricing).toEqual({
      cacheRead: 1,
      cacheWrite: 2,
      output: 3,
    });
    expect(body.providers.tokendance?.apiKeyMasked).toBe("td-g…0007");
    expect(body.defaultModel).toEqual(preset.defaultModel);

    // Nothing left to add: nothing is written.
    const { mtimeMs } = await stat(cfgFile());
    expect(await (await sync("add")).json()).toMatchObject({ added: 0, restored: 0 });
    expect((await stat(cfgFile())).mtimeMs).toBe(mtimeMs);
  });

  it("an added model is stored against its group's table field by field: a field the table holds is followed, one it lacks is written out, and a group the file never had gets the catalog's table", async () => {
    const preset = (await (await api.get(url())).json()) as ModelsResponse;
    const without =
      (provider: string, modelIds?: string[]) => (m: { provider: string; modelId: string }) =>
        !(m.provider === provider && (modelIds === undefined || modelIds.includes(m.modelId)));
    const kept = asEntries(preset)
      // OpenRouter, pointed at a proxy: one preset dropped.
      .filter(without("openrouter", ["anthropic/claude-opus-4.8"]))
      // OpenCode Go, on its catalog endpoint: a Messages preset dropped.
      .filter(without("opencode-go", ["qwen3.8-max"]))
      // TokenDance, its base URL cleared: one preset dropped.
      .filter(without("tokendance", ["glm-5.3"]))
      // Fireworks, its table cleared but its models kept: one preset dropped.
      .filter(without("fireworks", ["accounts/fireworks/models/glm-5p3"]))
      // SiliconFlow: every model and the table gone.
      .filter(without("siliconflow"));
    const put = await api.put(url(), {
      models: kept,
      providers: {
        openrouter: { baseUrl: "https://or-proxy.example/v1", apiKey: "sk-or-0011" },
        tokendance: { baseUrl: null },
        fireworks: { baseUrl: null, clientType: null },
        siliconflow: { baseUrl: null, clientType: null },
      },
    });
    expect(put.status).toBe(200);
    const before = (await put.json()) as ModelsResponse;
    expect(before.providers.fireworks).toBeUndefined();
    expect(before.providers.siliconflow).toBeUndefined();

    const body = (await (await sync("add")).json()) as PresetSyncResponse;
    const siliconflowPresets = MODEL_CATALOG.filter(
      (m) => m.provider === "siliconflow" && m.retired !== true,
    ).length;
    expect(body.added).toBe(4 + siliconflowPresets);

    // A table holding the field: the added row stores only what its catalog row has apart
    // from the catalog's group value — so it follows the user's proxy, and a Messages row
    // keeps its own path and protocol as at init.
    const opus = pick(body, "openrouter", "anthropic/claude-opus-4.8");
    expect(opus.clientType).toBeUndefined();
    expect(opus.credential).toBeUndefined();
    expect(opus.effective).toMatchObject({
      baseUrl: "https://or-proxy.example/v1",
      baseUrlSource: "provider",
      apiKeySource: "provider",
    });
    const messages = pick(body, "opencode-go", "qwen3.8-max");
    expect(messages.clientType).toBe("ant-messages");
    expect(messages.credential?.baseUrl).toBe(
      catalogEntryFor("opencode-go", "qwen3.8-max")!.baseUrl,
    );
    // A table lacking the field: the row carries the catalog's value itself, so it never
    // falls to the client's default endpoint with the group's key.
    const glm = pick(body, "tokendance", "glm-5.3");
    expect(glm.credential?.baseUrl).toBe(catalogGroupConnection("tokendance")!.base_url);
    expect(glm.clientType).toBeUndefined();
    expect(glm.effective.clientTypeSource).toBe("provider");
    // A group with models but no table gets none: the added row carries both values.
    const fireworks = pick(body, "fireworks", "accounts/fireworks/models/glm-5p3");
    expect(fireworks.clientType).toBe(catalogGroupConnection("fireworks")!.client_type);
    expect(fireworks.credential?.baseUrl).toBe(catalogGroupConnection("fireworks")!.base_url);
    expect(body.providers.fireworks).toBeUndefined();
    // A group with neither: the catalog's table, and its rows follow it.
    expect(body.providers.siliconflow).toEqual({
      baseUrl: catalogGroupConnection("siliconflow")!.base_url,
      clientType: catalogGroupConnection("siliconflow")!.client_type,
    });
    for (const row of body.models.filter((m) => m.provider === "siliconflow")) {
      expect(row.clientType, row.modelId).toBeUndefined();
      expect(row.credential, row.modelId).toBeUndefined();
    }

    // Nothing that was there moved: every other group table and every kept row.
    for (const id of Object.keys(before.providers)) {
      expect(body.providers[id], id).toEqual(before.providers[id]);
    }
    for (const row of before.models) {
      expect(pick(body, row.provider, row.modelId), pairKey(row)).toEqual(row);
    }
  });

  it("restoring defaults puts built-in rows and groups back to the catalog, and keeps keys, the user's own models and groups, and Penguin Go's promotions", async () => {
    const preset = (await (await api.get(url())).json()) as ModelsResponse;
    const pro = catalogEntryFor("deepseek", "deepseek-v4-pro")!;
    const promoted = catalogEntryFor("tokendance", "glm-5.3-flash")!;
    expect(pro.supportsVision).toBe(false);
    const edited = asEntries(preset)
      .filter((m) => !isPair("moonshot", "kimi-k2.6")(m))
      .map((m) => {
        if (isPair("deepseek", "deepseek-v4-pro")(m)) {
          // Every fact retyped, an endpoint and a protocol of its own, its own key, and
          // marked as taking images so it can serve as the vision model.
          return {
            ...m,
            displayName: "My Pro",
            contextWindow: 4096,
            pricing: { cacheRead: 1, cacheWrite: 2, output: 3 },
            maxTokens: 1000,
            fastMode: true,
            vision: true,
            clientType: "openai-chat",
            baseUrl: "https://proxy.example/deepseek",
            apiKey: "sk-ds-own-0008",
          };
        }
        if (isPair("tokendance", "glm-5.3-flash")(m)) return { ...m, discount: 0.33 };
        if (isPair("penguin-go", "gemini-3.8-flash")(m)) {
          // Its protocol dropped: it would run on whatever the id's family routes to.
          const { clientType: _clientType, ...rest } = m;
          return { ...rest, discount: 0.42 };
        }
        // Its own endpoint dropped: it would run on the group's Chat Completions path.
        if (isPair("opencode-go", "qwen3.8-max")(m)) return { ...m, baseUrl: null };
        return m;
      });
    const put = await api.put(url(), {
      visionModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      models: [
        ...edited,
        {
          provider: "custom",
          modelId: "my-own",
          clientType: "openai-chat",
          baseUrl: "https://mine.example/v1",
          apiKey: "sk-mine-key-0009",
          pricing: { cacheRead: 0.1, cacheWrite: 0.2, output: 0.3 },
          discount: 0.3,
        },
        { provider: "my-lab", modelId: "lab-one" },
      ],
      providers: {
        "my-lab": { baseUrl: "https://lab.example/v1", clientType: "openai-chat" },
        custom: { baseUrl: "https://custom-proxy.example/v1" },
        tokendance: { baseUrl: "https://td-proxy.example/v1", apiKey: "td-group-key-0010" },
        openrouter: { clientType: "openai-chat" },
        // A value the catalog does not set, and a table the catalog does.
        moonshot: { baseUrl: "https://proxy.example/moonshot/v1" },
        vllm: { clientType: null },
      },
    });
    expect(put.status).toBe(200);
    // A default that names no row any more (a hand edit, say).
    const svc = t.deps.projectConfigService;
    await svc.writeRaw(projectId, {
      ...(await svc.readRaw(projectId)),
      default_model: { provider: "custom", model_id: "gone" },
    });

    const res = await sync("restore");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PresetSyncResponse;
    // Three rows reset (the others already matched the catalog), one deleted preset back.
    expect(body).toMatchObject({ added: 1, restored: 3 });
    expect(body.models.some(isPair("moonshot", "kimi-k2.6"))).toBe(true);
    // The protocol and endpoint a preset stores at init are back on it.
    expect(pick(body, "penguin-go", "gemini-3.8-flash").clientType).toBe("google-genai");
    expect(pick(body, "opencode-go", "qwen3.8-max").credential?.baseUrl).toBe(
      catalogEntryFor("opencode-go", "qwen3.8-max")!.baseUrl,
    );

    const row = pick(body, "deepseek", "deepseek-v4-pro");
    expect(row).toMatchObject({
      displayName: pro.displayName,
      contextWindow: pro.contextWindow,
      pricing: {
        cacheRead: pro.pricing!.cache_read,
        cacheWrite: pro.pricing!.cache_write,
        output: pro.pricing!.output,
      },
      vision: false,
    });
    expect(row.maxTokens).toBeUndefined();
    expect(row.fastMode).toBeUndefined();
    expect(row.clientType).toBeUndefined();
    // Back on DeepSeek's own endpoint, the key it held is the one key of its group, and
    // reaches it as the group's: moved to the group, never deleted.
    expect(row.credential).toBeUndefined();
    expect(body.providers.deepseek).toEqual({
      apiKeyMasked: "sk-d…0008",
      createdAt: expect.any(String) as string,
    });
    expect(row.effective).toMatchObject({ apiKeySource: "provider", apiKeyMasked: "sk-d…0008" });
    // It no longer takes images, so it is no longer the vision model; the orphaned default
    // is the catalog's again.
    expect(body.visionModel).toBeUndefined();
    expect(body.defaultModel).toEqual({ provider: "deepseek", modelId: "deepseek-flash" });

    // The user's own model and group are exactly as they were.
    expect(pick(body, "custom", "my-own")).toMatchObject({
      clientType: "openai-chat",
      credential: { apiKeyMasked: "sk-m…0009", baseUrl: "https://mine.example/v1" },
      discount: 0.3,
    });
    expect(body.providers["my-lab"]).toEqual({
      baseUrl: "https://lab.example/v1",
      clientType: "openai-chat",
    });
    // So is custom's: the models added there reach their endpoint through it.
    expect(body.providers.custom).toEqual({ baseUrl: "https://custom-proxy.example/v1" });
    // Built-in groups get the catalog's endpoint and protocol back, and keep their key; a
    // value the catalog does not set goes, and a table the file lost is written again.
    const catalogTable = (id: string) => {
      const c = catalogGroupConnection(id)!;
      return {
        ...(c.base_url !== undefined ? { baseUrl: c.base_url } : {}),
        ...(c.client_type !== undefined ? { clientType: c.client_type } : {}),
      };
    };
    expect(body.providers.tokendance).toEqual({
      ...catalogTable("tokendance"),
      apiKeyMasked: "td-g…0010",
      createdAt: expect.any(String) as string,
    });
    expect(body.providers.openrouter).toEqual(catalogTable("openrouter"));
    expect(body.providers.vllm).toEqual(catalogTable("vllm"));
    expect(body.providers.moonshot).toBeUndefined();
    // Promotions are the catalog's, except the platform's own (Penguin Go).
    expect(pick(body, "tokendance", "glm-5.3-flash").discount).toBe(promoted.discount);
    expect(pick(body, "penguin-go", "gemini-3.8-flash").discount).toBe(0.42);
  });

  it("restoring defaults keeps a self-hosted group on the user's server: vLLM's base URL and key stay and only its protocol is the catalog's, while a vendor group's proxy goes", async () => {
    const put = await api.put(url(), {
      models: [
        ...asEntries((await (await api.get(url())).json()) as ModelsResponse),
        { provider: "vllm", modelId: "qwen3-local" },
      ],
      providers: {
        vllm: {
          baseUrl: "http://gpu-box.lan:8000/v1",
          clientType: "openai-chat",
          apiKey: "vllm-group-key-0015",
        },
        deepseek: { baseUrl: "https://proxy.example/deepseek" },
      },
    });
    expect(put.status).toBe(200);

    const body = (await (await sync("restore")).json()) as PresetSyncResponse;
    expect(body.providers.vllm).toEqual({
      baseUrl: "http://gpu-box.lan:8000/v1",
      clientType: catalogGroupConnection("vllm")!.client_type,
      apiKeyMasked: "vllm…0015",
      createdAt: expect.any(String) as string,
    });
    // The model the user added there still runs on that server, with the group's key.
    expect(pick(body, "vllm", "qwen3-local").effective).toMatchObject({
      baseUrl: "http://gpu-box.lan:8000/v1",
      baseUrlSource: "provider",
      apiKeySource: "provider",
      apiKeyMasked: "vllm…0015",
    });
    // A vendor's default is its official endpoint: the proxy is removed with its table.
    expect(body.providers.deepseek).toBeUndefined();
    expect(pick(body, "deepseek", "deepseek-flash").effective.baseUrlSource).toBe("none");
  });

  it("restoring defaults moves a key every keyed model of a group shares into the group once the group key would reach them all, and leaves differing keys on their models", async () => {
    const svc = t.deps.projectConfigService;
    const raw = await svc.readRaw(projectId);
    const keyed: Record<string, { api_key: string; created_at: string; base_url?: string }> = {
      // One OpenRouter key on two models, one of them re-pointed at another host: the group
      // key would not reach that one until restore puts it back on the gateway.
      "openrouter\0anthropic/claude-opus-4.8": {
        api_key: "sk-or-shared-0012",
        created_at: "2026-09-01T00:00:00.000Z",
      },
      "openrouter\0openai/gpt-5.5": {
        api_key: "sk-or-shared-0012",
        created_at: "2026-09-02T00:00:00.000Z",
        base_url: "https://proxy.example/v1",
      },
      // Two Fireworks models on two accounts.
      "fireworks\0accounts/fireworks/models/glm-5p3": {
        api_key: "fw-one-key-0013",
        created_at: "2026-09-03T00:00:00.000Z",
      },
      "fireworks\0accounts/fireworks/models/qwen3p8-max": {
        api_key: "fw-two-key-0014",
        created_at: "2026-09-04T00:00:00.000Z",
      },
    };
    await svc.writeRaw(projectId, {
      ...raw,
      models: (raw.models as Array<Record<string, unknown>>).map((m) => ({
        ...m,
        ...keyed[`${String(m.provider)}\0${String(m.model_id)}`],
      })),
    });

    const body = (await (await sync("restore")).json()) as PresetSyncResponse;
    expect(body.providers.openrouter).toMatchObject({
      apiKeyMasked: "sk-o…0012",
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    for (const modelId of ["anthropic/claude-opus-4.8", "openai/gpt-5.5", "xiaomi/mimo-v2.5"]) {
      const row = pick(body, "openrouter", modelId);
      expect(row.credential, modelId).toBeUndefined();
      expect(row.effective, modelId).toMatchObject({
        apiKeySource: "provider",
        apiKeyMasked: "sk-o…0012",
      });
    }
    expect(body.providers.fireworks?.apiKeyMasked).toBeUndefined();
    expect(pick(body, "fireworks", "accounts/fireworks/models/glm-5p3").credential).toMatchObject({
      apiKeyMasked: "fw-o…0013",
    });
    expect(
      pick(body, "fireworks", "accounts/fireworks/models/qwen3p8-max").credential,
    ).toMatchObject({ apiKeyMasked: "fw-t…0014" });
    // Every key is still in the file, the shared one once.
    const toml = await readFile(cfgFile(), "utf8");
    expect(toml.match(/sk-or-shared-0012/g)).toHaveLength(1);
    expect(toml).toContain("fw-one-key-0013");
    expect(toml).toContain("fw-two-key-0014");
  });

  it("sync-presets is the owner's, and takes only its two modes", async () => {
    expect((await api.post(`/api/projects/${projectId}/members`, { userId: "hank" })).status).toBe(
      201,
    );
    const before = await readFile(cfgFile(), "utf8");
    expect((await sync("restore", member)).status).toBe(403);
    expect((await sync("upgrade")).status).toBe(400);
    expect((await sync(undefined)).status).toBe(400);
    expect(await readFile(cfgFile(), "utf8")).toBe(before);
  });
});

describe("models update reaches loaded sessions (invalidation + live unlock)", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  /** Loader call count: how many times the manager (re)built a runtime from the index. */
  let loads: number;

  const insertSession = (sessionId: string, project: string): void => {
    t.deps.sessionsRepo.insert(sessionRow(sessionId, { projectId: project, workspace: t.root }));
  };

  const putModels = (apiKey: string) =>
    api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "m-inv" },
      models: [{ provider: "custom", modelId: "m-inv", apiKey }],
    });

  beforeAll(async () => {
    // Every runtime the manager builds from the index is an idle fake: no LLM call is made.
    t = await createTestApp({
      loader: {
        load: async (row) => {
          loads++;
          return fakeSession(row.sessionId);
        },
      },
    });
    const { cookie } = await provisionUser(t.app, "inv_owner");
    api = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  let projects = 0;
  beforeEach(async () => {
    loads = 0;
    projects += 1;
    const created = (await (
      await api.post("/api/projects", {
        projectId: `inv_owner-models_${projects}`,
        name: "invalidation",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
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
