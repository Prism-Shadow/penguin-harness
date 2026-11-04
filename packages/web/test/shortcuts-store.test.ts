/**
 * The keymap store (lib/shortcuts/store.ts) over an in-memory localStorage mirror.
 *
 * - The keymap starts from the platform's registry defaults; the platform's stored section
 *   overlays them, an explicit null unbinds, and an unknown id or unparseable chord keeps the
 *   default.
 * - A command holds a LIST of bindings: a lone chord string (the form an older build writes)
 *   reads as one binding, an array reads as several, null as none.
 * - Adding a binding appends without dropping what the command had, and an already-bound chord
 *   writes nothing at all; removing one (the default chord included) leaves the rest; a list back
 *   to just the default leaves no row, an emptied list stores the explicit unbind.
 * - Malformed JSON, a foreign shape or a wrong version reads as no overrides; the document is
 *   sanitized to the three platform sections of string, array-of-strings and null rows.
 * - A write stores the override in the platform's section and notifies subscribers; unknown ids
 *   and other platforms' sections survive; a literal Ctrl chord is Mod on Linux; Reset all
 *   clears the current platform only.
 * - Another tab's write to the mirror is re-read (only for its own key); defaults move to the
 *   keys the keyboard layout types.
 * - The account's copy: every edit goes to the persister as the compact document; the server's
 *   document wins over the mirror; a mirror edited here is kept when the server has none; one
 *   account's edit never reaches the next account on the tab; a mirror the server does not know
 *   and this session did not write is cleared.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseChord } from "../src/lib/shortcuts/chord";
import { setPlatformForTests } from "../src/lib/shortcuts/platform";
import {
  KEYBINDINGS_KEY,
  addBinding,
  bindingsOf,
  configureKeybindingsStoreForTests,
  hydrateFromServer,
  isOverridden,
  keymap,
  keymapVersion,
  noteExternalChange,
  readStored,
  removeBinding,
  resetAll,
  resetBinding,
  sanitizeStored,
  setKeybindingsPersister,
  subscribeKeymap,
  unbindCommand,
} from "../src/lib/shortcuts/store";
import type { StoredKeybindings } from "../src/lib/shortcuts/types";
import { memoryStorage } from "./helpers/storage";

let storage = memoryStorage();

beforeEach(() => {
  storage = memoryStorage();
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
    expect(bindingsOf("terminal.close")).toEqual([parseChord("Mod+Alt+Backquote")]);
    expect(bindingsOf("terminal.toggle")).toEqual([
      { ...parseChord("Ctrl+Backquote")!, mod: true, ctrl: false },
    ]);
    setPlatformForTests("mac");
    configureKeybindingsStoreForTests({});
    expect(bindingsOf("terminal.toggle")).toEqual([parseChord("Ctrl+Backquote")]);
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
    expect(bindingsOf("terminal.close")).toEqual([parseChord("Mod+Alt+KeyW")]);
    expect(bindingsOf("editor.save")).toEqual([]);
    expect(bindingsOf("terminal.toggle")).not.toEqual([]);
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
    expect(bindingsOf("terminal.close")).toEqual([parseChord("Mod+Alt+Backquote")]);
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
      expect(bindingsOf("terminal.close"), raw).toEqual([parseChord("Mod+Alt+Backquote")]);
      expect(readStored(storage), raw).toEqual({ v: 1 });
    }
  });

  it("sanitizes the document shape: only the three sections, only chord, chord-array and null rows", () => {
    expect(
      sanitizeStored({
        v: 1,
        linux: { a: "Mod+KeyA", b: null, c: 3, d: ["Mod+KeyS", "Ctrl+KeyD"], e: ["ok", 7, null] },
        ios: { a: "Mod+KeyA" },
        mac: [],
        extra: true,
      }),
    ).toEqual({ v: 1, linux: { a: "Mod+KeyA", b: null, d: ["Mod+KeyS", "Ctrl+KeyD"], e: ["ok"] } });
  });

  it("reads a legacy single-chord row as one binding, and an array as several", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({
        v: 1,
        linux: { "palette.toggle": "Mod+KeyP", "sessions.search": ["Mod+Alt+KeyS", "Mod+KeyK"] },
      }),
    );
    configureKeybindingsStoreForTests({});
    expect(bindingsOf("palette.toggle")).toEqual([parseChord("Mod+KeyP")]);
    expect(bindingsOf("sessions.search")).toEqual([
      parseChord("Mod+Alt+KeyS"),
      parseChord("Mod+KeyK"),
    ]);
  });
});

describe("bindings", () => {
  it("appends a binding to a command, keeping the default and notifying subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeKeymap(() => notified++);
    const before = keymapVersion();
    expect(bindingsOf("palette.toggle")).toEqual([parseChord("Mod+Alt+KeyP")]);
    addBinding("palette.toggle", parseChord("Mod+KeyP")!);
    expect(bindingsOf("palette.toggle")).toEqual([
      parseChord("Mod+Alt+KeyP"),
      parseChord("Mod+KeyP"),
    ]);
    expect(stored()).toEqual({ v: 1, linux: { "palette.toggle": ["Mod+Alt+KeyP", "Mod+KeyP"] } });
    expect(notified).toBe(1);
    expect(keymapVersion()).toBeGreaterThan(before);
    unsubscribe();
  });

  it("adds an already-bound chord as a no-op", () => {
    const before = keymapVersion();
    addBinding("palette.toggle", parseChord("Mod+Alt+KeyP")!); // the default itself
    expect(stored()).toBeNull(); // nothing written: no row, no mirror update
    expect(isOverridden("palette.toggle")).toBe(false);
    expect(keymapVersion()).toBe(before); // and nobody was told
  });

  it("removes an added binding and the row falls back to the default", () => {
    addBinding("palette.toggle", parseChord("Mod+KeyP")!);
    removeBinding("palette.toggle", parseChord("Mod+KeyP")!);
    expect(bindingsOf("palette.toggle")).toEqual([parseChord("Mod+Alt+KeyP")]);
    expect(isOverridden("palette.toggle")).toBe(false);
    expect(stored()).toEqual({ v: 1 });
  });

  it("removes the default chord itself and keeps the added one", () => {
    addBinding("palette.toggle", parseChord("Mod+KeyP")!);
    removeBinding("palette.toggle", parseChord("Mod+Alt+KeyP")!);
    expect(bindingsOf("palette.toggle")).toEqual([parseChord("Mod+KeyP")]);
    expect(stored()).toEqual({ v: 1, linux: { "palette.toggle": ["Mod+KeyP"] } });
  });

  it("removes every binding and the row stores the explicit unbind", () => {
    removeBinding("palette.toggle", parseChord("Mod+Alt+KeyP")!);
    expect(bindingsOf("palette.toggle")).toEqual([]);
    expect(isOverridden("palette.toggle")).toBe(true);
    expect(stored()).toEqual({ v: 1, linux: { "palette.toggle": null } });
    unbindCommand("editor.save");
    expect(stored()).toEqual({
      v: 1,
      linux: { "palette.toggle": null, "editor.save": null },
    });
  });

  it("writes the list to the mirror and the account as an array, and unknown ids and the other platforms' sections survive", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({
        v: 1,
        linux: { "future.command": "Mod+KeyZ" },
        mac: { "terminal.close": "Mod+KeyE" },
      }),
    );
    configureKeybindingsStoreForTests({});
    addBinding("editor.save", parseChord("Mod+Shift+KeyS")!);
    expect(stored()).toEqual({
      v: 1,
      linux: { "future.command": "Mod+KeyZ", "editor.save": ["Mod+KeyS", "Mod+Shift+KeyS"] },
      mac: { "terminal.close": "Mod+KeyE" },
    });
    resetBinding("editor.save");
    expect(stored()).toEqual({
      v: 1,
      linux: { "future.command": "Mod+KeyZ" },
      mac: { "terminal.close": "Mod+KeyE" },
    });
  });

  it("treats a literal Ctrl chord as Mod on Linux, so Ctrl+` is the terminal toggle's default there", () => {
    addBinding("terminal.toggle", parseChord("Ctrl+Backquote")!);
    expect(isOverridden("terminal.toggle")).toBe(false);
  });

  it("resetAll clears the current platform's section only", () => {
    storage.map.set(
      KEYBINDINGS_KEY,
      JSON.stringify({ v: 1, linux: { "editor.save": null }, mac: { "editor.save": null } }),
    );
    configureKeybindingsStoreForTests({});
    resetAll();
    expect(stored()).toEqual({ v: 1, mac: { "editor.save": null } });
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
  });
});

describe("external changes and the keyboard layout", () => {
  it("re-reads the mirror when another tab wrote it, and only for its own key", () => {
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
    storage.map.set(KEYBINDINGS_KEY, JSON.stringify({ v: 1, linux: { "editor.save": null } }));
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]); // still cached
    noteExternalChange("penguin.theme");
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
    noteExternalChange(KEYBINDINGS_KEY);
    expect(bindingsOf("editor.save")).toEqual([]);
    storage.map.delete(KEYBINDINGS_KEY);
    noteExternalChange(null); // a whole-store clear
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
  });

  it("relocates defaults to the layout's keys and treats the relocated chord as the default", () => {
    // US-Dvorak types p on the physical R key and r on the P key.
    const dvorak = new Map([
      ["KeyP", "r"],
      ["KeyR", "p"],
    ]);
    configureKeybindingsStoreForTests({ layout: dvorak });
    expect(bindingsOf("palette.toggle")[0]!.code).toBe("KeyR");
    // The user records the key labelled P (physically KeyR): that is the default, not an override.
    addBinding("palette.toggle", parseChord("Mod+Alt+KeyR")!);
    expect(isOverridden("palette.toggle")).toBe(false);
    // A stored user chord is physical and does not move.
    addBinding("palette.toggle", parseChord("Mod+Alt+KeyP")!);
    expect(
      bindingsOf("palette.toggle")
        .map((chord) => chord.code)
        .includes("KeyP"),
    ).toBe(true);
    expect(stored()).toEqual({
      v: 1,
      linux: { "palette.toggle": ["Mod+Alt+KeyR", "Mod+Alt+KeyP"] },
    });
  });
});

describe("the account's copy", () => {
  it("carries every edit to the persister as the compact document, and nothing before one is installed", () => {
    const sent: StoredKeybindings[] = [];
    unbindCommand("editor.save");
    setKeybindingsPersister((doc) => sent.push(doc));
    addBinding("terminal.close", parseChord("Mod+Alt+KeyW")!);
    resetBinding("editor.save");
    expect(sent).toEqual([
      {
        v: 1,
        linux: { "editor.save": null, "terminal.close": ["Mod+Alt+Backquote", "Mod+Alt+KeyW"] },
      },
      { v: 1, linux: { "terminal.close": ["Mod+Alt+Backquote", "Mod+Alt+KeyW"] } },
    ]);
    setKeybindingsPersister(null);
    resetAll();
    expect(sent).toHaveLength(2);
  });

  it("applies the server document over the mirror, even over an edit made this session", () => {
    unbindCommand("editor.save");
    hydrateFromServer({ v: 1, linux: { "terminal.close": "Mod+Alt+KeyW" }, mac: {} });
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
    expect(bindingsOf("terminal.close")).toEqual([parseChord("Mod+Alt+KeyW")]);
    expect(stored()).toEqual({ v: 1, linux: { "terminal.close": "Mod+Alt+KeyW" } });
  });

  it("keeps the mirror when the server has no copy but this account edited it here, sending nothing again", () => {
    const sent: StoredKeybindings[] = [];
    setKeybindingsPersister((doc) => sent.push(doc));
    unbindCommand("editor.save");
    hydrateFromServer(undefined);
    expect(sent).toEqual([{ v: 1, linux: { "editor.save": null } }]);
    expect(bindingsOf("editor.save")).toEqual([]);
    expect(stored()).toEqual({ v: 1, linux: { "editor.save": null } });
  });

  it("does not carry one account's edit into the next account signed in on the same tab", () => {
    const first: StoredKeybindings[] = [];
    setKeybindingsPersister((doc) => first.push(doc));
    unbindCommand("editor.save"); // account A edits, then signs out (no reload)
    setKeybindingsPersister(null);
    const second: StoredKeybindings[] = [];
    setKeybindingsPersister((doc) => second.push(doc)); // account B signs in
    hydrateFromServer(undefined); // B has no keybindings
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(storage.map.has(KEYBINDINGS_KEY)).toBe(false);
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
  });

  it("clears a mirror the server knows nothing about when this session did not write it", () => {
    storage.map.set(KEYBINDINGS_KEY, JSON.stringify({ v: 1, linux: { "editor.save": null } }));
    configureKeybindingsStoreForTests({});
    expect(bindingsOf("editor.save")).toEqual([]);
    hydrateFromServer(undefined);
    expect(storage.map.has(KEYBINDINGS_KEY)).toBe(false);
    expect(bindingsOf("editor.save")).toEqual([parseChord("Mod+KeyS")]);
  });
});
