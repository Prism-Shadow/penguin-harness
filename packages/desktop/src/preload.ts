/**
 * The window's ONLY bridge to the shell, deliberately a single capability: ask the
 * shell to open Electron DevTools on this window (the web app's Ctrl+P command
 * palette exposes it as the "Open Developer Console" action — a renderer cannot open
 * DevTools on itself). No arguments, no return value, no other channels: the window
 * otherwise stays the plain browser environment main.ts describes.
 *
 * Built as CJS (dist/preload.cjs, see tsup.config.ts): with sandbox:true a preload
 * runs in Electron's sandboxed CJS environment, not Node ESM.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("penguinDesktop", {
  openDevTools: (): void => {
    ipcRenderer.send("penguin:open-devtools");
  },
});
