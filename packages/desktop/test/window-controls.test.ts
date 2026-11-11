/**
 * The window-controls bridge's main-process end: what each message from the main window's page
 * does to the window, and that no other page can do it.
 *
 * - Given the main window's own page, minimize minimizes, close closes, and the maximize button
 *   maximizes a restored window and restores a maximized one.
 * - Given the main window's own page, asking whether the window is maximized answers its state.
 * - Given a message from any other page (another window's, a guest's), nothing happens to the
 *   window, the refusal is logged, and the maximized question is answered `false`.
 * - Given no main window, or one already destroyed, a message does nothing.
 * - Given the window is maximized or restored by any means (the button, a drag, the keyboard), its
 *   page is told the new state; a destroyed window's page is told nothing.
 */
import { describe, expect, it } from "vitest";
import {
  WINDOW_CONTROL_CHANNEL,
  installWindowControls,
  reportMaximized,
} from "../src/window-controls.js";
import type {
  ControlledWindow,
  WindowControlEvent,
  WindowControlIpc,
} from "../src/window-controls.js";

/** A window that records what was done to it and can raise its maximize events. */
function fakeWindow({ maximized = false } = {}) {
  const sent: Array<[string, unknown]> = [];
  const listeners = new Map<string, Array<() => void>>();
  const window = {
    calls: [] as string[],
    sent,
    destroyed: false,
    maximized,
    webContents: { send: (channel: string, value: unknown) => sent.push([channel, value]) },
    isDestroyed: () => window.destroyed,
    isMaximized: () => window.maximized,
    minimize: () => window.calls.push("minimize"),
    maximize: () => {
      window.calls.push("maximize");
      window.maximized = true;
    },
    unmaximize: () => {
      window.calls.push("unmaximize");
      window.maximized = false;
    },
    close: () => window.calls.push("close"),
    on: (event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
  };
  return window satisfies ControlledWindow;
}

/** An `ipcMain` stand-in: messages are delivered to whatever registered on their channel. */
function fakeIpc() {
  const on = new Map<string, (event: WindowControlEvent) => void>();
  const handle = new Map<string, (event: WindowControlEvent) => unknown>();
  const ipc: WindowControlIpc = {
    on: (channel, listener) => on.set(channel, listener),
    handle: (channel, listener) => handle.set(channel, listener),
  };
  return {
    ipc,
    send: (channel: string, sender: unknown) => on.get(channel)?.({ sender }),
    invoke: (channel: string, sender: unknown) => handle.get(channel)?.({ sender }),
  };
}

function setup(window: ReturnType<typeof fakeWindow> | null) {
  const log: string[] = [];
  const wire = fakeIpc();
  installWindowControls(
    wire.ipc,
    () => window,
    (line) => log.push(line),
  );
  return { ...wire, log };
}

describe("installWindowControls", () => {
  it("minimizes and closes the window for its own page", () => {
    const window = fakeWindow();
    const { send } = setup(window);
    send(WINDOW_CONTROL_CHANNEL.minimize, window.webContents);
    send(WINDOW_CONTROL_CHANNEL.close, window.webContents);
    expect(window.calls).toEqual(["minimize", "close"]);
  });

  it("maximizes a restored window and restores a maximized one", () => {
    const window = fakeWindow();
    const { send } = setup(window);
    send(WINDOW_CONTROL_CHANNEL.toggleMaximize, window.webContents);
    send(WINDOW_CONTROL_CHANNEL.toggleMaximize, window.webContents);
    expect(window.calls).toEqual(["maximize", "unmaximize"]);
  });

  it("tells its own page whether the window is maximized", () => {
    const window = fakeWindow({ maximized: true });
    const { invoke } = setup(window);
    expect(invoke(WINDOW_CONTROL_CHANNEL.isMaximized, window.webContents)).toBe(true);
    window.maximized = false;
    expect(invoke(WINDOW_CONTROL_CHANNEL.isMaximized, window.webContents)).toBe(false);
  });

  it("does nothing to the window for another page, and logs the refusal", () => {
    const window = fakeWindow({ maximized: true });
    const { send, invoke, log } = setup(window);
    const guest = { send: () => undefined };
    for (const channel of [
      WINDOW_CONTROL_CHANNEL.minimize,
      WINDOW_CONTROL_CHANNEL.toggleMaximize,
      WINDOW_CONTROL_CHANNEL.close,
    ]) {
      send(channel, guest);
    }
    expect(invoke(WINDOW_CONTROL_CHANNEL.isMaximized, guest)).toBe(false);
    expect(window.calls).toEqual([]);
    expect(log).toHaveLength(4);
  });

  it("does nothing with no main window, or a destroyed one", () => {
    const { send } = setup(null);
    expect(() => send(WINDOW_CONTROL_CHANNEL.close, {})).not.toThrow();
    const window = fakeWindow();
    window.destroyed = true;
    const wired = setup(window);
    wired.send(WINDOW_CONTROL_CHANNEL.close, window.webContents);
    expect(wired.invoke(WINDOW_CONTROL_CHANNEL.isMaximized, window.webContents)).toBe(false);
    expect(window.calls).toEqual([]);
    expect(wired.log).toEqual([]);
  });
});

describe("reportMaximized", () => {
  it("tells the page each time the window is maximized or restored", () => {
    const window = fakeWindow();
    reportMaximized(window);
    window.emit("maximize");
    window.emit("unmaximize");
    expect(window.sent).toEqual([
      [WINDOW_CONTROL_CHANNEL.maximizedChanged, true],
      [WINDOW_CONTROL_CHANNEL.maximizedChanged, false],
    ]);
  });

  it("tells a destroyed window's page nothing", () => {
    const window = fakeWindow();
    reportMaximized(window);
    window.destroyed = true;
    window.emit("maximize");
    expect(window.sent).toEqual([]);
  });
});
