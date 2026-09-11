/**
 * catalog-sync.ts unit tests: the "sync presets" merge — union of the local model table and
 * the built-in catalog, catalog winning on differing preset entries, local additions and
 * credentials untouched, the display name filled but never overwritten — plus `catalogDelta`,
 * the same question asked of a saved table so the Models nav badge can answer it before the
 * page has loaded any rows.
 *
 * The last block is the one that matters most: the badge and the button must never disagree
 * about whether there is anything to do, so every case above is replayed through both.
 */
import { describe, expect, it } from "vitest";
import { catalogEntryFor } from "@prismshadow/penguin-core/model-catalog";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import { catalogDelta, syncRowsWithCatalog } from "../src/features/models/catalog-sync";
import { presetUpdateTodo } from "../src/lib/todo-badges";
import { noticeCounts } from "../src/lib/bulk-update";
import { toRow } from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";

type ModelDto = ModelsResponse["models"][number];

type PresetEntry = Parameters<typeof syncRowsWithCatalog>[1] extends (infer E)[] | undefined
  ? E
  : never;

function makeRow(partial: Partial<RowState> & Pick<RowState, "provider" | "modelId">): RowState {
  return {
    original: { provider: partial.provider, modelId: partial.modelId },
    vision: true,
    contextWindow: "",
    maxTokens: "",
    fastMode: false,
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

/**
 * The shipped catalog's name for a pair, read rather than pinned: the fixtures below stand in
 * for catalog entries on every other field, and a rename in `model-catalog.ts` has no business
 * breaking a test about the merge.
 */
function catalogName(provider: string, modelId: string): string {
  return catalogEntryFor(provider, modelId)!.displayName;
}

/**
 * A row matching the catalog on every field a sync owns, the display name included: a saved
 * preset row always carries one, because the GET fills it in from the catalog when the config
 * file does not. Overrides make the one field under test the only thing out of line.
 */
function inSyncRow(extra: Partial<RowState> = {}): RowState {
  return makeRow({
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    displayName: catalogName("deepseek", "deepseek-v4-pro"),
    vision: false,
    contextWindow: "1000000",
    cacheRead: "0.003571",
    cacheWrite: "0.428571",
    output: "0.857143",
    ...extra,
  });
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
    client_type: "openai-chat",
    pricing: { unit: "usd_per_mtok", cache_read: 0.285714, cache_write: 1.142857, output: 4 },
    vision: false,
    base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  },
  // Preview model without a list price: the catalog carries no pricing.
  {
    provider: "qwen-token-plan",
    model_id: "qwen3.8-max-preview",
    context_window: 1000000,
    client_type: "openai-chat",
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
    expect(glm.clientType).toBe("openai-chat");
    expect(glm.baseUrl).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    expect(glm.originalBaseUrl).toBe(""); // differs from baseUrl -> the PUT submits the preset URL
    expect(glm.cacheRead).toBe("0.285714");
    expect(glm.vision).toBe(false);
    // The catalog's name travels with the new row: a preset entry carries none (the persisted
    // shape only stores a name that differs from the catalog), so a row built without it would
    // reach the PUT nameless and be saved as a model whose name the user cleared.
    expect(glm.displayName).toBe(catalogName("qwen-token-plan", "glm-5.2"));
    // The lookup is against the shipped catalog, not against this list: `qwen3.8-max-preview`
    // left the Token Plan lineup, so the pair resolves to nothing and the row stays nameless
    // (falling back to its model id) rather than picking up an empty name.
    expect(catalogEntryFor("qwen-token-plan", "qwen3.8-max-preview")).toBeUndefined();
    expect(rows.find((r) => r.modelId === "qwen3.8-max-preview")!.displayName).toBeUndefined();
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
    expect(row.displayName).toBe(catalogName("deepseek", "deepseek-v4-pro"));
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
    const upToDate = inSyncRow();
    const { rows, updated } = syncRowsWithCatalog([upToDate], PRESET);
    expect(updated).toBe(0);
    expect(rows[0]).toBe(upToDate);
  });

  it("fills a blank display name from the catalog, and never overwrites one already there", () => {
    // A preset row showing no name is one an earlier sync saved without one: it renders as the
    // raw model id until something puts the catalog's name back, and this is that something.
    const blank = syncRowsWithCatalog([inSyncRow({ displayName: "" })], PRESET);
    expect(blank.updated).toBe(1);
    expect(blank.rows[0]!.displayName).toBe(catalogName("deepseek", "deepseek-v4-pro"));
    // Same for a row that never had the field at all.
    const absent = syncRowsWithCatalog([inSyncRow({ displayName: undefined })], PRESET);
    expect(absent.updated).toBe(1);
    expect(absent.rows[0]!.displayName).toBe(catalogName("deepseek", "deepseek-v4-pro"));
    // A name that is there stays: unlike pricing or the context window, it may be the user's
    // own rename, and the catalog has no claim to it.
    const renamed = inSyncRow({ displayName: "My DeepSeek" });
    const kept = syncRowsWithCatalog([renamed], PRESET);
    expect(kept.updated).toBe(0);
    expect(kept.rows[0]).toBe(renamed);
  });

  it("preserves a user-set max output tokens through a preset sync (user-owned, not catalog-owned)", () => {
    const local = makeRow({
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      maxTokens: "4096", // user annotation
      contextWindow: "500000", // stale -> the row does get updated by the sync
    });
    const { rows, updated } = syncRowsWithCatalog([local], PRESET);
    expect(updated).toBe(1);
    const row = rows[0]!;
    expect(row.contextWindow).toBe("1000000"); // catalog-owned field reset
    expect(row.maxTokens).toBe("4096"); // user field survives the {...row, ...fields} merge
    // Fresh catalog rows default to inherit (no preset output cap exists).
    expect(rows.find((r) => r.modelId === "glm-5.2")!.maxTokens).toBe("");
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
      clientType: "openai-chat",
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
    // Every catalog entry is named, so no row added from it may go out nameless.
    expect(rows.every((r) => (r.displayName ?? "") !== "")).toBe(true);
  });
});

/** A saved entry, in the shape the models endpoint sends. */
function makeDto(partial: Partial<ModelDto> & Pick<ModelDto, "provider" | "modelId">): ModelDto {
  return { ...partial } as ModelDto;
}

/**
 * A saved entry matching the catalog on every field a sync owns. The display name comes from
 * the catalog because the GET fills it in from there whenever the config file carries none —
 * a table saved from a sync looks like this, and nothing in it is left to do.
 */
function inSyncDto(p: PresetEntry, extra: Partial<ModelDto> = {}): ModelDto {
  const displayName = catalogEntryFor(p.provider, p.model_id)?.displayName;
  return makeDto({
    provider: p.provider,
    modelId: p.model_id,
    vision: p.vision !== false,
    ...(displayName !== undefined ? { displayName } : {}),
    ...(p.context_window !== undefined ? { contextWindow: p.context_window } : {}),
    ...(p.client_type !== undefined ? { clientType: p.client_type } : {}),
    ...(p.pricing
      ? {
          pricing: {
            cacheRead: p.pricing.cache_read,
            cacheWrite: p.pricing.cache_write,
            output: p.pricing.output,
          } as ModelDto["pricing"],
        }
      : {}),
    ...(p.base_url !== undefined
      ? { credential: { baseUrl: p.base_url } as ModelDto["credential"] }
      : {}),
    ...extra,
  });
}

describe("catalogDelta", () => {
  it("reports nothing when the saved table already matches the catalog", () => {
    expect(
      catalogDelta(
        PRESET.map((p) => inSyncDto(p)),
        PRESET,
      ),
    ).toEqual({
      added: 0,
      updated: 0,
      refs: [],
    });
  });

  it("counts a blank display name as something to sync, and a user's own name as nothing", () => {
    // The badge has to raise the same repair the button performs: a preset row saved with no
    // name renders as its model id until a sync puts the catalog's name back.
    expect(catalogDelta([inSyncDto(PRESET[0]!, { displayName: "" })], PRESET)).toEqual({
      added: 2,
      updated: 1,
      refs: [
        "deepseek/deepseek-v4-pro",
        "qwen-token-plan/glm-5.2",
        "qwen-token-plan/qwen3.8-max-preview",
      ],
    });
    expect(
      catalogDelta([inSyncDto(PRESET[0]!, { displayName: "My DeepSeek" })], PRESET).refs,
    ).not.toContain("deepseek/deepseek-v4-pro");
  });

  it("names every entry it would add or rewrite, in catalog order", () => {
    const stale = makeDto({ provider: "deepseek", modelId: "deepseek-v4-pro", vision: true });
    expect(catalogDelta([stale], PRESET)).toEqual({
      added: 2,
      updated: 1,
      refs: [
        "deepseek/deepseek-v4-pro",
        "qwen-token-plan/glm-5.2",
        "qwen-token-plan/qwen3.8-max-preview",
      ],
    });
  });

  it("ignores locally added models, exactly as the merge does", () => {
    const local = makeDto({ provider: "custom", modelId: "my-own" });
    expect(catalogDelta([local], PRESET).refs).not.toContain("custom/my-own");
  });

  /**
   * The badge reads a saved table; the button reads row state. They are two conversions of the
   * same data, so this pins them together: whatever `toRow` does to a DTO, `catalogDelta` must
   * read the same way, or a dot would lead to a button answering "already up to date".
   */
  it("agrees with the sync merge on every table shape, against the real catalog", () => {
    const tables: ModelDto[][] = [
      [],
      [makeDto({ provider: "deepseek", modelId: "deepseek-v4-pro" })],
      [makeDto({ provider: "deepseek", modelId: "deepseek-v4-pro", contextWindow: 1000000 })],
      [
        makeDto({
          provider: "qwen-token-plan",
          modelId: "glm-5.2",
          clientType: "openai-chat",
          credential: { baseUrl: "http://my-proxy" } as ModelDto["credential"],
        }),
      ],
      [makeDto({ provider: "custom", modelId: "my-own", contextWindow: 8192 })],
      // The display name: in sync, blank (an earlier sync's damage), and the user's own.
      [inSyncDto(PRESET[0]!)],
      [inSyncDto(PRESET[0]!, { displayName: "" })],
      [inSyncDto(PRESET[0]!, { displayName: "My DeepSeek" })],
    ];
    for (const table of tables) {
      const merged = syncRowsWithCatalog(table.map(toRow), PRESET);
      const delta = catalogDelta(table, PRESET);
      expect([delta.added, delta.updated], JSON.stringify(table)).toEqual([
        merged.added,
        merged.updated,
      ]);
      expect(delta.refs.length).toBe(merged.added + merged.updated);
    }
  });

  it("agrees with the merge on an empty table against the shipped catalog", () => {
    const merged = syncRowsWithCatalog([]);
    const delta = catalogDelta([]);
    expect([delta.added, delta.updated]).toEqual([merged.added, merged.updated]);
    expect(delta.refs.length).toBeGreaterThan(30);
  });

  /**
   * The page notice states "N new, M to upgrade" above a button that runs the merge. Those two
   * numbers must be the merge's own, carried through the gate — not a third opinion computed for
   * the block. This walks the same chain the page does: delta -> raised to-do -> notice counts.
   */
  it("hands the merge's own two numbers all the way to the page notice", () => {
    const table = [
      makeDto({ provider: "deepseek", modelId: "deepseek-v4-pro", contextWindow: 1000000 }),
      makeDto({ provider: "custom", modelId: "my-own", contextWindow: 8192 }),
    ];
    const merged = syncRowsWithCatalog(table.map(toRow), PRESET);
    const todo = presetUpdateTodo(catalogDelta(table, PRESET))!;
    expect(noticeCounts(todo)).toEqual({ added: merged.added, updated: merged.updated });
    // And the dot the notice sits under is raised from the same total.
    expect((noticeCounts(todo).added ?? 0) + noticeCounts(todo).updated).toBe(todo.count);
  });
});
