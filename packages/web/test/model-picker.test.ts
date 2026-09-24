/**
 * The model-picker dialog's pure logic (model-picker-logic.ts): which groups the rail shows
 * and how the key-less models stay reachable, which group is active on open, how search
 * ranks and groups results across providers, and how the keyboard moves between the rail
 * and the list. A short source contract pins the wiring the node suite cannot render: every
 * host opens the dialog, and the dialog is the shared Modal rather than an overlay of its own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ModelCredentialRowLike } from "../src/features/models/model-grouping";
import {
  entryRow,
  groupShortcutIndex,
  hiddenModelCount,
  initialGroupId,
  matchRank,
  movePickerNav,
  pickerGroups,
  searchPickerGroups,
  stepIndex,
} from "../src/features/chat/model-picker-logic";

const configured = (
  provider: string,
  modelId: string,
  displayName?: string,
): ModelCredentialRowLike => ({
  provider,
  modelId,
  ...(displayName !== undefined ? { displayName } : {}),
  credential: { apiKeyMasked: "sk-***" },
});
const keyless = (provider: string, modelId: string): ModelCredentialRowLike => ({
  provider,
  modelId,
});

// Library order puts deepseek before anthropic before moonshot, custom last.
const pool: ModelCredentialRowLike[] = [
  keyless("deepseek", "deepseek-v4"),
  configured("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6"),
  keyless("anthropic", "claude-opus-4-8"),
  configured("moonshot", "kimi-k2.6", "Kimi K2.6"),
  keyless("custom", "my-proxy"),
];

const ids = (groups: { id: string }[]) => groups.map((g) => g.id);

describe("pickerGroups: the rail", () => {
  it("shows only groups holding a key-configured model, in library order", () => {
    const groups = pickerGroups(pool, { showAll: false });
    expect(ids(groups)).toEqual(["anthropic", "moonshot"]);
    expect(groups[0]!.rows.map((m) => m.modelId)).toEqual(["claude-sonnet-4-6"]);
  });

  it("follows the user's saved group order", () => {
    expect(ids(pickerGroups(pool, { showAll: false, groupOrder: ["moonshot"] }))).toEqual([
      "moonshot",
      "anthropic",
    ]);
  });

  it("keeps the selected and the default model visible without a key", () => {
    const groups = pickerGroups(pool, {
      showAll: false,
      selected: { provider: "deepseek", modelId: "deepseek-v4" },
      defaultModel: { provider: "custom", modelId: "my-proxy" },
    });
    expect(ids(groups)).toEqual(["deepseek", "anthropic", "moonshot", "custom"]);
  });

  it("the toggle reaches every key-less model: counted, then listed with their groups", () => {
    expect(hiddenModelCount(pool, { showAll: false, query: "" })).toBe(3);
    // The count follows the search, so the toggle names what it would add to these results.
    expect(hiddenModelCount(pool, { showAll: false, query: "claude" })).toBe(1);
    const all = pickerGroups(pool, { showAll: true });
    expect(ids(all)).toEqual(["deepseek", "anthropic", "moonshot", "custom"]);
    expect(all.flatMap((g) => g.rows)).toHaveLength(pool.length);
    expect(hiddenModelCount(pool, { showAll: true, query: "" })).toBe(0);
  });

  it("lists everything, with nothing to toggle, when no model has a key", () => {
    const bare = pool.map((m) => keyless(m.provider, m.modelId));
    expect(pickerGroups(bare, { showAll: false }).flatMap((g) => g.rows)).toHaveLength(5);
    expect(hiddenModelCount(bare, { showAll: false, query: "" })).toBe(0);
  });
});

describe("initialGroupId / entryRow: the opening focus", () => {
  it("opens on the current model's group and row", () => {
    const value = { provider: "moonshot", modelId: "kimi-k2.6" };
    const groups = pickerGroups(pool, { showAll: false, selected: value });
    expect(initialGroupId(groups, value)).toBe("moonshot");
    expect(entryRow(groups[1]!.rows, value)).toBe(0);
  });

  it("with nothing chosen, opens on the first group that has a key", () => {
    // The key-less default puts deepseek first on the rail, but it cannot run.
    const groups = pickerGroups(pool, {
      showAll: false,
      defaultModel: { provider: "deepseek", modelId: "deepseek-v4" },
    });
    expect(ids(groups)[0]).toBe("deepseek");
    expect(initialGroupId(groups, null)).toBe("anthropic");
  });

  it("falls back to the first group when nothing has a key, and to null on an empty rail", () => {
    const bare = pool.map((m) => keyless(m.provider, m.modelId));
    expect(initialGroupId(pickerGroups(bare, { showAll: false }), null)).toBe("deepseek");
    expect(initialGroupId([], null)).toBeNull();
  });
});

describe("search across groups", () => {
  it("ranks exact, prefix, word-boundary, substring, then provider-only matches", () => {
    const row = { provider: "openai", modelId: "gpt-5-mini", displayName: "GPT-5 Mini" };
    expect(matchRank(row, "gpt-5 mini")).toBe(0);
    expect(matchRank(row, "gpt")).toBe(1);
    expect(matchRank(row, "mini")).toBe(2);
    expect(matchRank(row, "ini")).toBe(3);
    expect(matchRank(row, "openai")).toBe(4);
  });

  it("groups results by provider, the group with the best match first, best rows first", () => {
    const models = [
      configured("anthropic", "claude-sonnet-4-6"),
      configured("anthropic", "sonnet-lite"),
      configured("moonshot", "sonnet"),
    ];
    const results = searchPickerGroups(models, { showAll: false, query: "sonnet" });
    // moonshot holds the exact match, so it leads although anthropic comes first on the rail.
    expect(ids(results)).toEqual(["moonshot", "anthropic"]);
    expect(results[1]!.rows.map((m) => m.modelId)).toEqual(["sonnet-lite", "claude-sonnet-4-6"]);
  });

  it("finds exactly what the dropdown's search found: the same visibility, only reordered", () => {
    const found = (showAll: boolean) =>
      searchPickerGroups(pool, { showAll, query: "claude" }).flatMap((g) => g.rows);
    expect(found(false)).toHaveLength(1);
    expect(found(true)).toHaveLength(2);
  });
});

describe("keyboard", () => {
  const shape = {
    groupCount: 3,
    rowCount: (g: number) => [2, 4, 1][g] ?? 0,
    // The current model sits at row 2 of the second group.
    entry: (g: number) => (g === 1 ? 2 : 0),
  };

  it("stepIndex wraps, and enters from nothing at the near end", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });

  it("up/down walk the list's rows, wrapping", () => {
    const nav = { region: "list" as const, group: 1, row: 3 };
    expect(movePickerNav(nav, "down", shape)).toEqual({ region: "list", group: 1, row: 0 });
    expect(movePickerNav(nav, "up", shape)).toEqual({ region: "list", group: 1, row: 2 });
  });

  it("up/down in the rail walk the groups, and the list lands on the group's entry row", () => {
    const nav = { region: "rail" as const, group: 0, row: 1 };
    expect(movePickerNav(nav, "down", shape)).toEqual({ region: "rail", group: 1, row: 2 });
    expect(movePickerNav(nav, "up", shape)).toEqual({ region: "rail", group: 2, row: 0 });
  });

  it("left/right and Tab move between the rail and the list", () => {
    const list = { region: "list" as const, group: 1, row: 2 };
    const rail = { region: "rail" as const, group: 1, row: 2 };
    expect(movePickerNav(list, "left", shape)).toEqual(rail);
    expect(movePickerNav(list, "tab", shape)).toEqual(rail);
    expect(movePickerNav(list, "right", shape)).toEqual(list);
    expect(movePickerNav(rail, "right", shape)).toEqual(list);
    expect(movePickerNav(rail, "tab", shape)).toEqual(list);
    expect(movePickerNav(rail, "left", shape)).toEqual(rail);
  });

  it("⌥1–9 / Alt+1–9 name a group; the browser keeps ⌘/Ctrl+digit", () => {
    type Mods = Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>;
    const k = (digit: string, mods: Mods) => ({
      code: `Digit${digit}`,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(groupShortcutIndex(k("1", { altKey: true }))).toBe(0);
    expect(groupShortcutIndex(k("9", { altKey: true }))).toBe(8);
    expect(groupShortcutIndex(k("0", { altKey: true }))).toBeNull();
    expect(groupShortcutIndex(k("3", {}))).toBeNull();
    // The browser owns ⌘/Ctrl+digit (tab switching); the picker must not claim it.
    expect(groupShortcutIndex(k("3", { metaKey: true }))).toBeNull();
    expect(groupShortcutIndex(k("3", { ctrlKey: true }))).toBeNull();
    expect(groupShortcutIndex(k("3", { altKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("wiring (source contract)", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const select = read("../src/features/chat/model-select.tsx");
  const modal = read("../src/features/chat/model-picker-modal.tsx");
  const chatInput = read("../src/features/chat/chat-input.tsx");

  it("both trigger variants open the dialog, not a dropdown", () => {
    expect(select).toContain("<ModelPickerModal");
    expect(select).not.toMatch(/<Dropdown\b|<FormPicker\b/);
  });

  it("the dialog is the shared Modal, so stacked dialogs and Escape behave as elsewhere", () => {
    expect(modal).toContain("<Modal");
    expect(modal).not.toContain("createPortal");
  });

  it("/model opens the same dialog", () => {
    expect(chatInput).toMatch(/<ModelPickerModal[\s\S]*?open=\{modelSwitchOpen\}/);
    expect(chatInput).not.toContain("ModelMenuList");
  });
});
