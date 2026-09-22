/**
 * The global dispatcher (src/lib/shortcuts/dispatcher.ts): handler order, the declined-command
 * path, and the window listener fed a fake event — it runs the bound global command, prevents the
 * default only when handled, keeps a repeat from the browser without re-running, and leaves an
 * already-prevented event alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleShortcutKeydown,
  hasCommandHandler,
  onCommand,
  runCommand,
} from "../src/lib/shortcuts/dispatcher";
import { setPlatformForTests } from "../src/lib/shortcuts/platform";
import { configureKeybindingsStoreForTests } from "../src/lib/shortcuts/store";

function fire(init: Partial<KeyboardEvent> & { code: string }): { defaultPrevented: boolean } {
  const state = { defaultPrevented: false, ...init };
  const event = {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...state,
    preventDefault: () => {
      state.defaultPrevented = true;
    },
  } as unknown as KeyboardEvent;
  handleShortcutKeydown(event);
  return state;
}

const unregisters: Array<() => void> = [];

beforeEach(() => {
  setPlatformForTests("linux");
  configureKeybindingsStoreForTests({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    layout: null,
  });
});

afterEach(() => {
  for (const off of unregisters.splice(0)) off();
  setPlatformForTests(null);
  configureKeybindingsStoreForTests({ storage: null, layout: null });
});

describe("command handlers", () => {
  it("runs the last registered handler first and lets it decline to the previous one", () => {
    const order: string[] = [];
    unregisters.push(onCommand("terminal.toggle", () => void order.push("first")));
    unregisters.push(
      onCommand("terminal.toggle", () => {
        order.push("second");
        return false;
      }),
    );
    expect(hasCommandHandler("terminal.toggle")).toBe(true);
    expect(runCommand("terminal.toggle")).toBe(true);
    expect(order).toEqual(["second", "first"]);
  });

  it("reports an unhandled command, and forgets an unregistered handler", () => {
    expect(hasCommandHandler("palette.toggle")).toBe(false);
    expect(runCommand("palette.toggle")).toBe(false);
    const off = onCommand("palette.toggle", () => {});
    expect(hasCommandHandler("palette.toggle")).toBe(true);
    off();
    expect(hasCommandHandler("palette.toggle")).toBe(false);
    off(); // idempotent
  });
});

describe("the window listener", () => {
  it("runs the bound global command and prevents the default", () => {
    let toggled = 0;
    unregisters.push(onCommand("terminal.toggle", () => void toggled++));
    const event = fire({ code: "Backquote", key: "`", ctrlKey: true });
    expect(toggled).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps a repeat from the browser without running the command again", () => {
    let toggled = 0;
    unregisters.push(onCommand("terminal.toggle", () => void toggled++));
    fire({ code: "Backquote", key: "`", ctrlKey: true });
    const repeat = fire({ code: "Backquote", key: "`", ctrlKey: true, repeat: true });
    expect(toggled).toBe(1);
    expect(repeat.defaultPrevented).toBe(true);
    // A repeat of a chord nothing answers is left to the browser, like its first press.
    expect(fire({ code: "KeyP", key: "p", ctrlKey: true, repeat: true }).defaultPrevented).toBe(
      false,
    );
  });

  it("leaves a chord with no handler, a focus-scoped chord and an already-prevented event to their defaults", () => {
    // palette.toggle is bound to Ctrl+P but nothing answers it yet.
    expect(fire({ code: "KeyP", key: "p", ctrlKey: true }).defaultPrevented).toBe(false);
    // editor.save is editor-scoped: the editor's own handler decides it, never the window.
    let saved = 0;
    unregisters.push(onCommand("editor.save", () => void saved++));
    expect(fire({ code: "KeyS", key: "s", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(saved).toBe(0);
    // A surface that handled the key already.
    let toggled = 0;
    unregisters.push(onCommand("terminal.toggle", () => void toggled++));
    fire({ code: "Backquote", key: "`", ctrlKey: true, defaultPrevented: true });
    expect(toggled).toBe(0);
  });
});
