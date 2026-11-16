/**
 * The main process's end of the window-controls bridge (preload.ts): what each message does to
 * the main window, and who may send it. Pure — the IPC object and the window are handed in — so it
 * unit-tests under plain vitest with fakes of both.
 *
 * Only the main window's own page may drive it. Every other renderer of this app has no preload
 * and so no way to send these messages (preview and terminal windows, the built-in browser's
 * guests), but the check is made on every message all the same: a sender that is not the main
 * window's webContents is refused and logged, and a question it asks is answered `false`.
 */
import type { WindowControlAction } from "./title-bar.js";

/** The channels, one per control, plus the maximized state's question and its change. */
export const WINDOW_CONTROL_CHANNEL = {
  minimize: "penguin-window:minimize",
  toggleMaximize: "penguin-window:toggle-maximize",
  close: "penguin-window:close",
  isMaximized: "penguin-window:is-maximized",
  maximizedChanged: "penguin-window:maximized-changed",
} as const satisfies Record<WindowControlAction | "isMaximized" | "maximizedChanged", string>;

/** The part of a BrowserWindow the bridge drives. */
export interface ControlledWindow {
  readonly webContents: { send(channel: string, ...args: unknown[]): void };
  isDestroyed(): boolean;
  isMaximized(): boolean;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  on(event: "maximize" | "unmaximize", listener: () => void): unknown;
}

/** An IPC message's event, as far as the bridge reads it. */
export interface WindowControlEvent {
  sender: unknown;
}

/** The part of `ipcMain` the bridge registers on. */
export interface WindowControlIpc {
  on(channel: string, listener: (event: WindowControlEvent) => void): unknown;
  handle(channel: string, listener: (event: WindowControlEvent) => unknown): unknown;
}

/**
 * Registers the bridge's handlers, once for the app's life: `currentWindow` names the main window
 * at the moment a message arrives (null while there is none).
 */
export function installWindowControls(
  ipc: WindowControlIpc,
  currentWindow: () => ControlledWindow | null,
  log: (line: string) => void,
): void {
  /** The main window, when the message came from its own page; null otherwise. */
  const ownWindow = (event: WindowControlEvent): ControlledWindow | null => {
    const target = currentWindow();
    if (target === null || target.isDestroyed()) return null;
    if (event.sender !== target.webContents) {
      log("[shell] refused a window control from a page other than the main window's");
      return null;
    }
    return target;
  };
  const actions: Record<WindowControlAction, (target: ControlledWindow) => void> = {
    minimize: (target) => target.minimize(),
    toggleMaximize: (target) => (target.isMaximized() ? target.unmaximize() : target.maximize()),
    close: (target) => target.close(),
  };
  for (const action of Object.keys(actions) as WindowControlAction[]) {
    ipc.on(WINDOW_CONTROL_CHANNEL[action], (event) => {
      const target = ownWindow(event);
      if (target !== null) actions[action](target);
    });
  }
  ipc.handle(
    WINDOW_CONTROL_CHANNEL.isMaximized,
    (event) => ownWindow(event)?.isMaximized() ?? false,
  );
}

/** Tells the window's page each time it is maximized or restored, so its button can follow. */
export function reportMaximized(target: ControlledWindow): void {
  const report = (maximized: boolean) => () => {
    if (!target.isDestroyed())
      target.webContents.send(WINDOW_CONTROL_CHANNEL.maximizedChanged, maximized);
  };
  target.on("maximize", report(true));
  target.on("unmaximize", report(false));
}
