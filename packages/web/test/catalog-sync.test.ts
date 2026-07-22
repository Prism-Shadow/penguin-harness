/**
 * catalog-sync.ts unit tests: the "sync presets" merge — union of the local model table and
 * the built-in catalog, catalog winning on differing preset entries, local additions and
 * credentials untouched.
 */
import { describe, expect, it } from "vitest";
import { syncRowsWithCatalog } from "../src/features/models/catalog-sync";
import type { RowState } from "../src/features/models/models-page";

type PresetEntry = Parameters<typeof syncRowsWithCatalog>[1] extends (infer E)[] | undefined
  ? E
  : never;

function makeRow(partial: Partial<RowState> & Pick<RowState, "provider" | "modelId">): RowState {
  return {
    original: { provider: partial.provider, modelId: partial.modelId },
    vision: true,
    contextWindow: "",
    thinkingLevel: "",
    clientType: "",
    cacheRead: "",
    cacheWrite: "",
    output: "",
    baseUrl: "",
    originalBaseUrl: "",
    apiKeyInput: "",
    clearApiKey: false,
    ...partial,
  };
}

const PRESET: PresetEntry[] = [
  {
    provider: "deepseek",
    model_id: "deepseek-v4-pro",
    context_window: 1000000,
    pricing: {
      unit: "usd_per_mtok",
      cache_read: 0.003571,
      cache_write: 0.428571,
      output: 0.857143,
    },
    vision: false,
  },
  {
    provider: "qwen-token-plan",
    model_id: "glm-5.2",
    context_window: 1048576,
    client_type: "openai",
    pricing: { unit: "usd_per_mtok", cache_read: 0.285714, cache_write: 1.142857, output: 4 },
    vision: false,
    base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  },
  // Preview model without a list price: the catalog carries no pricing.
  {
    provider: "qwen-token-plan",
    model_id: "qwen3.8-max-preview",
    context_window: 1000000,
    client_type: "openai",
    base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  },
];

describe("syncRowsWithCatalog", () => {
  it("adds catalog entries missing locally (gateway base URL preset, original null -> new on PUT)", () => {
    const { rows, added, updated } = syncRowsWithCatalog([], PRESET);
    expect(added).toBe(3);
    expect(updated).toBe(0);
    const glm = rows.find((r) => r.provider === "qwen-token-plan" && r.modelId === "glm-5.2")!;
    expect(glm.original).toBeNull();
    expect(glm.clientType).toBe("openai");
    expect(glm.baseUrl).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    expect(glm.originalBaseUrl).toBe(""); // differs from baseUrl -> the PUT submits the preset URL
    expect(glm.cacheRead).toBe("0.285714");
    expect(glm.vision).toBe(false);
  });

  it("resets differing preset rows to the catalog's fields, keeping identity and credentials", () => {
    const local = makeRow({
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      vision: true, // user flipped it
      contextWindow: "500000", // stale
      cacheRead: "1",
      cacheWrite: "2",
      output: "3",
      baseUrl: "http://my-proxy", // user override -> catalog wins (cleared)
      originalBaseUrl: "http://my-proxy",
      credential: { hasApiKey: true } as RowState["credential"],
    });
    const { rows, added, updated } = syncRowsWithCatalog([local], PRESET);
    expect(added).toBe(2);
    expect(updated).toBe(1);
    const row = rows[0]!;
    expect(row.contextWindow).toBe("1000000");
    expect(row.vision).toBe(false);
    expect(row.cacheRead).toBe("0.003571");
    expect(row.baseUrl).toBe(""); // catalog has no base_url; differs from originalBaseUrl -> cleared on PUT
    expect(row.originalBaseUrl).toBe("http://my-proxy");
    // Identity and credential state untouched: no rename, no key input, credential kept.
    expect(row.original).toEqual({ provider: "deepseek", modelId: "deepseek-v4-pro" });
    expect(row.apiKeyInput).toBe("");
    expect(row.clearApiKey).toBe(false);
    expect(row.credential).toEqual({ hasApiKey: true });
  });

  it("leaves up-to-date rows untouched (same object, updated not counted)", () => {
    const upToDate = makeRow({
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      vision: false,
      contextWindow: "1000000",
      cacheRead: "0.003571",
      cacheWrite: "0.428571",
      output: "0.857143",
    });
    const { rows, updated } = syncRowsWithCatalog([upToDate], PRESET);
    expect(updated).toBe(0);
    expect(rows[0]).toBe(upToDate);
  });

  it("preserves a user-set thinking level through a preset sync (user-owned, not catalog-owned)", () => {
    const local = makeRow({
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "none", // user annotation
      contextWindow: "500000", // stale -> the row does get updated by the sync
    });
    const { rows, updated } = syncRowsWithCatalog([local], PRESET);
    expect(updated).toBe(1);
    const row = rows[0]!;
    expect(row.contextWindow).toBe("1000000"); // catalog-owned field reset
    expect(row.thinkingLevel).toBe("none"); // user field survives the {...row, ...fields} merge
    // Fresh catalog rows default to inherit (no preset thinking level exists).
    expect(rows.find((r) => r.modelId === "glm-5.2")!.thinkingLevel).toBe("");
  });

  it("keeps locally added models (including user-defined groups) verbatim and in place", () => {
    const mine = makeRow({ provider: "my-gateway", modelId: "my-model", baseUrl: "http://x" });
    const { rows, added } = syncRowsWithCatalog([mine], PRESET);
    expect(added).toBe(3);
    expect(rows[0]).toBe(mine); // existing rows keep their list position; catalog entries append
    expect(rows).toHaveLength(4);
  });

  it("removes pricing when the catalog entry carries none (preview model, catalog wins)", () => {
    const local = makeRow({
      provider: "qwen-token-plan",
      modelId: "qwen3.8-max-preview",
      contextWindow: "1000000",
      clientType: "openai",
      baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      cacheRead: "1",
      cacheWrite: "2",
      output: "3",
    });
    const { rows, updated } = syncRowsWithCatalog([local], PRESET);
    expect(updated).toBe(1);
    const row = rows.find((r) => r.modelId === "qwen3.8-max-preview")!;
    expect([row.cacheRead, row.cacheWrite, row.output]).toEqual(["", "", ""]);
  });

  it("syncs against the real built-in catalog by default", () => {
    const { rows, added, updated } = syncRowsWithCatalog([]);
    expect(added).toBeGreaterThan(30);
    expect(updated).toBe(0);
    // No merged row ever carries a key input: credentials are structurally untouched.
    expect(rows.every((r) => r.apiKeyInput === "" && !r.clearApiKey)).toBe(true);
  });
});
