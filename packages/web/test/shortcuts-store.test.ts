/**
 * The keymap store (src/lib/shortcuts/store.ts) over an in-memory mirror: overrides resolve
 * over the defaults, an explicit null unbinds, unknown ids ride along, malformed input reads as
 * defaults, a row set back to its default disappears, and an external change re-reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseChord } from "../src/lib/shortcuts/chord";
import { setPlatformForTests } from "../src/lib/shortcuts/platform";
import {
  KEYBINDINGS_KEY,
  bindingOf,
  configureKeybindingsStoreForTests,
  hydrateFromServer,
  isOverridden,
  keymap,
  keymapVersion,
  noteExternalChange,
  readStored,
  resetAll,
  resetBinding,
  sanitizeStored,
  setBinding,
  setKeybindingsPersister,
  subscribeKeymap,
  type KeybindingsStorage,
} from "../src/lib/shortcuts/store";
import type { StoredKeybindings } from "../src/lib/shortcuts/types";

function memStorage(
  initial: Record<string, string> = {},
): KeybindingsStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let storage = memStorage();

beforeEach(() => {
  storage = memStorage();
  setPlatformForTests("linux");
  configureKeybindingsStoreForTests({ storage, layout: null });
});

afterEach(() => {
  setPlatformForTests(null);
  configureKeybindingsStoreForTests({ storage: null, layout: null });
});

const stored = (): unknown => JSON.parse(storage.map.get(KEYBINDINGS_KEY) ?? "null");

describe("resolution", () => {
  it("starts from the registry defaults for the platform", () => {
    expect(bindingOf("terminal.close")).toEqual(parseChord("Mod+KeyW"));
    expect(bindingOf("terminal.toggle")).toEqual({
      ...parseChord("Ctrl+Backquote")!,
      mod: true,
      ctrl: false,
    });
    setPlatformForTests("mac");
    configureKeybindingsStoreForTests({});
    expect(bindingOf("terminal.toggle")).toEqual(parseChord("Ctrl+Backquote"));
    expect(isOverridden("terminal.close")).toBe(false);
  });

  it("overlays the platform's stored section, and an explicit null unbinds", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({
        v: 1,
        linux: { "terminal.close": "Mod+Alt+KeyW", "editor.save": null },
        mac: { "terminal.close": "Mod+KeyE" },
      }),
    );
    configureKeybindingsStoreForTests({});
    expect(bindingOf("terminal.close")).toEqual(parseChord("Mod+Alt+KeyW"));
    expect(bindingOf("editor.save")).toBeNull();
    expect(bindingOf("terminal.toggle")).not.toBeNull();
    expect(isOverridden("terminal.close")).toBe(true);
    expect(isOverridden("editor.save")).toBe(true);
    expect(isOverridden("terminal.toggle")).toBe(false);
  });

  it("ignores an unknown id and an unparseable chord when applying, keeping the default", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({ v: 1, linux: { "future.command": "Mod+KeyZ", "terminal.close": "Cmd-W" } }),
    );
    configureKeybindingsStoreForTests({});
    expect(bindingOf("terminal.close")).toEqual(parseChord("Mod+KeyW"));
    expect(keymap().has("future.command" as never)).toBe(false);
  });

  it("reads malformed JSON, a foreign shape and a wrong version as no overrides", () => {
    for (const raw of [
      "{not json",
      '"a string"',
      "[]",
      '{"v":2,"linux":{"terminal.close":null}}',
      '{"linux":{"terminal.close":null}}',
    ]) {
      storage.map.set(KEYBINDINGS_KEY, raw);
      configureKeybindingsStoreForTests({});
      expect(bindingOf("terminal.close"), raw).toEqual(parseChord("Mod+KeyW"));
      expect(readStored(storage), raw).toEqual({ v: 1 });
    }
  });

  it("sanitizes the document shape: only the three sections, only string-or-null values", () => {
    expect(
      sanitizeStored({
        v: 1,
        linux: { a: "Mod+KeyA", b: null, c: 3 },
        ios: { a: "Mod+KeyA" },
        mac: [],
        extra: true,
      }),
    ).toEqual({ v: 1, linux: { a: "Mod+KeyA", b: null } });
  });
});

describe("writes", () => {
  it("stores an override in the platform section and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeKeymap(() => notified++);
    const before = keymapVersion();
    setBinding("terminal.close", parseChord("Mod+Alt+KeyW"));
    expect(bindingOf("terminal.close")).toEqual(parseChord("Mod+Alt+KeyW"));
    expect(stored()).toEqual({ v: 1, linux: { "terminal.close": "Mod+Alt+KeyW" } });
    expect(notified).toBe(1);
    expect(keymapVersion()).toBeGreaterThan(before);
    unsubscribe();
  });

  it("stores an explicit unbind as null", () => {
    setBinding("editor.save", null);
    expect(bindingOf("editor.save")).toBeNull();
    expect(stored()).toEqual({ v: 1, linux: { "editor.save": null } });
  });

  it("removes a row set back to its default, and drops an emptied section", () => {
    setBinding("terminal.close", parseChord("Mod+Alt+KeyW"));
    setBinding("terminal.close", parseChord("Mod+KeyW"));
    expect(isOverridden("terminal.close")).toBe(false);
    expect(stored()).toEqual({ v: 1 });
  });

  it("treats a literal Ctrl chord as Mod on Linux, so Ctrl+` is the terminal toggle's default there", () => {
    setBinding("terminal.toggle", parseChord("Ctrl+Backquote"));
    expect(isOverridden("terminal.toggle")).toBe(false);
  });

  it("preserves unknown ids and the other platforms' sections on write", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({
        v: 1,
        linux: { "future.command": "Mod+KeyZ" },
        mac: { "terminal.close": "Mod+KeyE" },
      }),
    );
    configureKeybindingsStoreForTests({});
    setBinding("editor.save", parseChord("Mod+Shift+KeyS"));
    expect(stored()).toEqual({
      v: 1,
      linux: { "future.command": "Mod+KeyZ", "editor.save": "Mod+Shift+KeyS" },
      mac: { "terminal.close": "Mod+KeyE" },
    });
    resetBinding("editor.save");
    expect(stored()).toEqual({
      v: 1,
      linux: { "future.command": "Mod+KeyZ" },
      mac: { "terminal.close": "Mod+KeyE" },
    });
  });

  it("resetAll clears the current platform's section only", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({ v: 1, linux: { "editor.save": null }, mac: { "editor.save": null } }),
    );
    configureKeybindingsStoreForTests({});
    resetAll();
    expect(stored()).toEqual({ v: 1, mac: { "editor.save": null } });
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
  });
});

describe("external changes and the keyboard layout", () => {
  it("re-reads the mirror when another tab wrote it, and only for its own key", () => {
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
    storage.map.set(KEYBINDINGS_KEY, JSON.stringify({ v: 1, linux: { "editor.save": null } }));
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS")); // still cached
    noteExternalChange("penguin.theme");
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
    noteExternalChange(KEYBINDINGS_KEY);
    expect(bindingOf("editor.save")).toBeNull();
    storage.map.delete(KEYBINDINGS_KEY);
    noteExternalChange(null); // a whole-store clear
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
  });

  it("relocates defaults to the layout's keys and treats the relocated chord as the default", () => {
    const azerty = new Map([
      ["KeyW", "z"],
      ["KeyZ", "w"],
    ]);
    configureKeybindingsStoreForTests({ layout: azerty });
    expect(bindingOf("terminal.close")?.code).toBe("KeyZ");
    // The user records the key labelled W (physically KeyZ): that is the default, not an override.
    setBinding("terminal.close", parseChord("Mod+KeyZ"));
    expect(isOverridden("terminal.close")).toBe(false);
    // A stored user chord is physical and does not move.
    setBinding("terminal.close", parseChord("Mod+KeyW"));
    expect(bindingOf("terminal.close")?.code).toBe("KeyW");
    expect(stored()).toEqual({ v: 1, linux: { "terminal.close": "Mod+KeyW" } });
  });
});

describe("the account's copy", () => {
  it("carries every edit to the persister as the compact document, and nothing before one is installed", () => {
    const sent: StoredKeybindings[] = [];
    setBinding("editor.save", null);
    setKeybindingsPersister((doc) => sent.push(doc));
    setBinding("terminal.close", parseChord("Mod+Alt+KeyW"));
    resetBinding("editor.save");
    expect(sent).toEqual([
      { v: 1, linux: { "editor.save": null, "terminal.close": "Mod+Alt+KeyW" } },
      { v: 1, linux: { "terminal.close": "Mod+Alt+KeyW" } },
    ]);
    setKeybindingsPersister(null);
    resetAll();
    expect(sent).toHaveLength(2);
  });

  it("applies the server document over the mirror, even over an edit made this session", () => {
    setBinding("editor.save", null);
    hydrateFromServer({ v: 1, linux: { "terminal.close": "Mod+Alt+KeyW" }, mac: {} });
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
    expect(bindingOf("terminal.close")).toEqual(parseChord("Mod+Alt+KeyW"));
    expect(stored()).toEqual({ v: 1, linux: { "terminal.close": "Mod+Alt+KeyW" } });
  });

  it("keeps the mirror when the server has no copy but this account edited it here, sending nothing again", () => {
    const sent: StoredKeybindings[] = [];
    setKeybindingsPersister((doc) => sent.push(doc));
    setBinding("editor.save", null);
    hydrateFromServer(undefined);
    expect(sent).toEqual([{ v: 1, linux: { "editor.save": null } }]);
    expect(bindingOf("editor.save")).toBeNull();
    expect(stored()).toEqual({ v: 1, linux: { "editor.save": null } });
  });

  it("does not carry one account's edit into the next account signed in on the same tab", () => {
    const first: StoredKeybindings[] = [];
    setKeybindingsPersister((doc) => first.push(doc));
    setBinding("editor.save", null); // account A edits, then signs out (no reload)
    setKeybindingsPersister(null);
    const second: StoredKeybindings[] = [];
    setKeybindingsPersister((doc) => second.push(doc)); // account B signs in
    hydrateFromServer(undefined); // B has no keybindings
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(storage.map.has(KEYBINDINGS_KEY)).toBe(false);
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
  });

  it("clears a mirror the server knows nothing about when this session did not write it", () => {
    storage.map.set(KEYBINDINGS_KEY, JSON.stringify({ v: 1, linux: { "editor.save": null } }));
    configureKeybindingsStoreForTests({});
    expect(bindingOf("editor.save")).toBeNull();
    hydrateFromServer(undefined);
    expect(storage.map.has(KEYBINDINGS_KEY)).toBe(false);
    expect(bindingOf("editor.save")).toEqual(parseChord("Mod+KeyS"));
  });
});
