/**
 * Named workspace layouts: saving, renaming, deleting, the limits, reading back from
 * storage (corrupt included), clamping, which layout is current, and the Alt+number keys.
 */
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  LAYOUTS_KEY,
  MAX_SAVED_PRESETS,
  allPresets,
  applyOrder,
  commitPresets,
  currentPresetId,
  deletePreset,
  isTypingTarget,
  readPresets,
  renamePreset,
  sanitize,
  savePreset,
  shortcutIndex,
  writePresets,
  type LayoutState,
  type LayoutStore,
} from "../src/features/activities/layout-presets";
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH } from "../src/features/activities/workspace-model";
import { MAP_MIN } from "../src/features/activities/map-split";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const STATE: LayoutState = {
  railWidth: 340,
  railCollapsed: false,
  sidePanel: "run",
  section: "speech",
  mapWidth: 500,
  mapVisible: false,
  showReasoning: false,
};

const BUILT_IN_NAMES = ["Writing", "Reviewing", "Media"];
const empty = (): LayoutStore => ({ presets: [], shortcuts: false });

let next = 0;
const ids = () => `id-${++next}`;

function saved(store: LayoutStore, name: string, state = STATE): LayoutStore {
  const result = savePreset(store, name, state, BUILT_IN_NAMES, ids);
  if (!result.ok) throw new Error(result.error);
  return result.store;
}

describe("savePreset", () => {
  it("saves a trimmed name with the whole arrangement, after the built-ins", () => {
    const result = savePreset(empty(), "  Audio pass ", STATE, BUILT_IN_NAMES, () => "a");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preset).toEqual({ id: "a", builtIn: false, name: "Audio pass", state: STATE });
    expect(allPresets(result.store).map((preset) => preset.id)).toEqual([
      "writing",
      "reviewing",
      "media",
      "a",
    ]);
  });

  it("refuses an empty, too long or duplicate name, case aside", () => {
    const store = saved(empty(), "Audio pass");
    expect(savePreset(store, "   ", STATE, BUILT_IN_NAMES)).toEqual({ ok: false, error: "empty" });
    expect(savePreset(store, "x".repeat(41), STATE, BUILT_IN_NAMES)).toEqual({
      ok: false,
      error: "tooLong",
    });
    expect(savePreset(store, "x".repeat(40), STATE, BUILT_IN_NAMES, ids).ok).toBe(true);
    expect(savePreset(store, "AUDIO PASS", STATE, BUILT_IN_NAMES)).toEqual({
      ok: false,
      error: "duplicate",
    });
    expect(savePreset(store, "reviewing", STATE, BUILT_IN_NAMES)).toEqual({
      ok: false,
      error: "duplicate",
    });
  });

  it("refuses the 21st layout with the limit", () => {
    let store = empty();
    for (let i = 1; i <= MAX_SAVED_PRESETS; i++) store = saved(store, `Layout ${i}`);
    expect(store.presets).toHaveLength(20);
    expect(savePreset(store, "One more", STATE, BUILT_IN_NAMES, ids)).toEqual({
      ok: false,
      error: "limit",
    });
  });

  it("never reuses an id already in the list", () => {
    const store = saved(empty(), "First");
    const again = savePreset(store, "Second", STATE, [], () => store.presets[0]!.id);
    expect(again.ok && again.preset.id).not.toBe(store.presets[0]!.id);
  });
});

describe("renamePreset and deletePreset", () => {
  it("renames a saved layout, keeping its own name allowed", () => {
    const store = saved(saved(empty(), "Audio pass"), "Review");
    const id = store.presets[0]!.id;
    const same = renamePreset(store, id, "audio PASS", BUILT_IN_NAMES);
    expect(same.ok && same.preset.name).toBe("audio PASS");
    expect(renamePreset(store, id, "review", BUILT_IN_NAMES)).toEqual({
      ok: false,
      error: "duplicate",
    });
    expect(renamePreset(store, id, "Media", BUILT_IN_NAMES)).toEqual({
      ok: false,
      error: "duplicate",
    });
    const renamed = renamePreset(store, id, "Voice pass", BUILT_IN_NAMES);
    expect(renamed.ok && renamed.store.presets.map((preset) => preset.name)).toEqual([
      "Voice pass",
      "Review",
    ]);
  });

  it("cannot rename or delete a built-in", () => {
    const store = saved(empty(), "Audio pass");
    expect(renamePreset(store, "writing", "Mine", BUILT_IN_NAMES)).toEqual({
      ok: false,
      error: "missing",
    });
    expect(deletePreset(store, "reviewing")).toBe(store);
    expect(allPresets(deletePreset(store, "reviewing"))).toHaveLength(4);
  });

  it("deletes a saved layout", () => {
    const store = saved(saved(empty(), "One"), "Two");
    const after = deletePreset(store, store.presets[0]!.id);
    expect(after.presets.map((preset) => preset.name)).toEqual(["Two"]);
  });
});

describe("readPresets and writePresets", () => {
  it("round-trips the saved layouts and the shortcut switch", () => {
    const storage = memory();
    const store = { ...saved(empty(), "Audio pass"), shortcuts: true };
    expect(writePresets(store, storage)).toBe(true);
    expect(storage.values.has(LAYOUTS_KEY)).toBe(true);
    expect(readPresets(storage)).toEqual(store);
  });

  it("leaves only the built-ins for corrupt or blocked storage", () => {
    const storage = memory();
    for (const raw of ["{not json", "[]", "42", "null", '{"presets":"x"}']) {
      storage.setItem(LAYOUTS_KEY, raw);
      expect(readPresets(storage)).toEqual({ presets: [], shortcuts: false });
    }
    expect(readPresets(throwing)).toEqual({ presets: [], shortcuts: false });
    expect(writePresets(empty(), throwing)).toBe(false);
  });

  it("drops entries that are not layouts, duplicates, built-in ids and anything past 20", () => {
    const storage = memory();
    const entries = [
      { id: "a", name: "Good", state: STATE },
      { id: "b", name: "good", state: STATE },
      { id: "writing", name: "Mine", state: STATE },
      { id: "c", name: "", state: STATE },
      { id: "d", name: "No state" },
      "nonsense",
      ...Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, state: STATE })),
    ];
    storage.setItem(LAYOUTS_KEY, JSON.stringify({ presets: entries, shortcuts: "yes" }));
    const store = readPresets(storage);
    expect(store.shortcuts).toBe(false);
    expect(store.presets).toHaveLength(20);
    expect(store.presets[0]!.name).toBe("Good");
    expect(store.presets.some((preset) => preset.id === "writing")).toBe(false);
  });
});

describe("commitPresets", () => {
  it("builds on what storage holds now, so two tabs keep each other's layouts", () => {
    const storage = memory();
    // Two tabs read the same, empty, store.
    const tabA = readPresets(storage);
    const tabB = readPresets(storage);
    const save = (name: string) => (current: LayoutStore) => {
      const result = savePreset(current, name, STATE);
      return result.ok ? result.store : null;
    };
    const a = commitPresets(tabA, true, save("Audio pass"), storage);
    const b = commitPresets(tabB, true, save("Review pass"), storage);
    expect(a?.persisted).toBe(true);
    expect(b?.store.presets.map((preset) => preset.name)).toEqual(["Audio pass", "Review pass"]);
    // Ticking the shortcuts in a tab that never re-read keeps both layouts as well.
    commitPresets(tabA, true, (current) => ({ ...current, shortcuts: true }), storage);
    const stored = readPresets(storage);
    expect(stored.presets.map((preset) => preset.name)).toEqual(["Audio pass", "Review pass"]);
    expect(stored.shortcuts).toBe(true);
  });

  it("refuses a name another tab took since this one read the list", () => {
    const storage = memory();
    const stale = readPresets(storage);
    commitPresets(
      stale,
      true,
      (current) => {
        const result = savePreset(current, "Mine", STATE);
        return result.ok ? result.store : null;
      },
      storage,
    );
    let error: string | null = null;
    const result = commitPresets(
      stale,
      true,
      (current) => {
        const saved = savePreset(current, "mine", STATE);
        if (!saved.ok) error = saved.error;
        return saved.ok ? saved.store : null;
      },
      storage,
    );
    expect(result).toBeNull();
    expect(error).toBe("duplicate");
  });

  it("keeps the page's copy once storage refused a write", () => {
    const first = commitPresets(
      readPresets(throwing),
      true,
      (current) => {
        const result = savePreset(current, "Kept", STATE);
        return result.ok ? result.store : null;
      },
      throwing,
    );
    expect(first?.persisted).toBe(false);
    const second = commitPresets(
      first!.store,
      false,
      (current) => ({ ...current, shortcuts: true }),
      throwing,
    );
    expect(second?.store.presets.map((preset) => preset.name)).toEqual(["Kept"]);
    expect(second?.store.shortcuts).toBe(true);
  });
});

describe("sanitize", () => {
  it("clamps widths and replaces an unknown panel or section", () => {
    expect(
      sanitize({
        railWidth: 9000,
        railCollapsed: "yes",
        sidePanel: "cockpit",
        section: "nowhere",
        mapWidth: 1,
        mapVisible: false,
        showReasoning: false,
      }),
    ).toEqual({
      railWidth: RAIL_MAX_WIDTH,
      railCollapsed: false,
      sidePanel: null,
      section: "description",
      mapWidth: MAP_MIN,
      mapVisible: false,
      showReasoning: false,
    });
    expect(sanitize({ railWidth: 10 })?.railWidth).toBe(RAIL_MIN_WIDTH);
    expect(sanitize(null)).toBeNull();
    expect(sanitize([1])).toBeNull();
  });
});

describe("applyOrder", () => {
  it("writes only what a built-in names, the section last", () => {
    const reviewing = BUILT_IN_PRESETS.find((preset) => preset.id === "reviewing")!;
    expect(applyOrder(reviewing.state)).toEqual([
      { kind: "railCollapsed", value: true },
      { kind: "sidePanel", value: "player" },
      { kind: "mapVisible", value: true },
      { kind: "mapWidth", value: 420 },
      { kind: "section", value: "scenes" },
    ]);
    const writing = BUILT_IN_PRESETS.find((preset) => preset.id === "writing")!;
    expect(applyOrder(writing.state)).toContainEqual({ kind: "railWidth", value: 300 });
    expect(applyOrder(writing.state).some((write) => write.kind === "showReasoning")).toBe(false);
  });

  it("clamps what it writes and writes a closed panel", () => {
    expect(applyOrder({ railWidth: 5000, sidePanel: null })).toEqual([
      { kind: "railWidth", value: RAIL_MAX_WIDTH },
      { kind: "sidePanel", value: null },
    ]);
  });
});

describe("currentPresetId", () => {
  const presets = allPresets(saved(empty(), "Audio pass"));

  it("names the built-in the arrangement matches", () => {
    expect(
      currentPresetId(
        {
          ...STATE,
          railCollapsed: true,
          sidePanel: "player",
          section: "scenes",
          mapVisible: true,
          mapWidth: 420,
        },
        presets,
      ),
    ).toBe("reviewing");
    expect(
      currentPresetId(
        { ...STATE, railWidth: 300, sidePanel: "conversation", section: "description" },
        presets,
      ),
    ).toBe("writing");
  });

  it("names a saved layout, ignoring widths that are not showing", () => {
    const id = presets[3]!.id;
    expect(currentPresetId(STATE, presets)).toBe(id);
    // The map is hidden, so its width does not count.
    expect(currentPresetId({ ...STATE, mapWidth: 700 }, presets)).toBe(id);
    expect(currentPresetId({ ...STATE, showReasoning: true }, presets)).toBeNull();
  });
});

describe("shortcuts", () => {
  const press = (over: Partial<Parameters<typeof shortcutIndex>[0]>) =>
    shortcutIndex({
      key: "2",
      code: "Digit2",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...over,
    });

  it("reads Alt+1..9 as a 0-based index and nothing else", () => {
    expect(press({})).toBe(1);
    expect(press({ key: "™", code: "Digit2" })).toBe(1);
    expect(press({ key: "1", code: "" })).toBe(0);
    expect(press({ altKey: false })).toBeNull();
    expect(press({ ctrlKey: true })).toBeNull();
    expect(press({ shiftKey: true })).toBeNull();
    expect(press({ key: "0", code: "Digit0" })).toBeNull();
  });

  it("stays out of fields", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
