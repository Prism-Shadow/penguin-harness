/**
 * The desktop shell's window-controls bridge, and what the title band reads besides it.
 *
 * The shell's main window carries a preload that hands the page `window.penguinWindow`: minimize,
 * maximize or restore and close, whether the window is maximized and when that changes, the
 * platform, and the title band's height. Nothing else crosses it. A browser has no such object,
 * and neither has a window of an older desktop shell, so every reader here answers "no bridge"
 * and the page lays out exactly as it does without one.
 */
import { useCallback, useSyncExternalStore } from "react";

/** What the desktop shell's preload exposes (packages/desktop/src/preload.ts). */
export interface WindowBridge {
  /** `darwin`, `win32` or `linux`: macOS draws its own window buttons, the others do not. */
  readonly platform: string;
  /** The title band's height in CSS pixels. */
  readonly bandHeight: number;
  isMaximized(): boolean;
  /** Calls `listener` with the new state each time the window is maximized or restored. */
  onMaximizedChange(listener: (maximized: boolean) => void): () => void;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

/** The bridge, when the page runs in the desktop shell's main window; null anywhere else. */
export function windowBridge(): WindowBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { penguinWindow?: Partial<WindowBridge> }).penguinWindow;
  return bridge !== undefined && typeof bridge.toggleMaximize === "function"
    ? (bridge as WindowBridge)
    : null;
}

/** Whether the window is maximized, following every change the bridge reports. */
export function useWindowMaximized(bridge: WindowBridge): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => bridge.onMaximizedChange(onChange),
    [bridge],
  );
  return useSyncExternalStore(subscribe, () => bridge.isMaximized());
}

/** The part of the Navigation API the band reads. */
interface HistoryNavigation {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  addEventListener(type: "currententrychange", listener: () => void): void;
  removeEventListener(type: "currententrychange", listener: () => void): void;
}

function historyNavigation(): HistoryNavigation | null {
  return (window as unknown as { navigation?: HistoryNavigation }).navigation ?? null;
}

function subscribeHistory(onChange: () => void): () => void {
  const navigation = historyNavigation();
  navigation?.addEventListener("currententrychange", onChange);
  return () => navigation?.removeEventListener("currententrychange", onChange);
}

/**
 * Whether there is a page to go back to and one to go forward to, from the window's own history.
 * Without the Navigation API there is no way to tell, and both stay available: going back past
 * the first page simply does nothing.
 */
export function useHistoryReach(): { back: boolean; forward: boolean } {
  const key = useSyncExternalStore(subscribeHistory, () => {
    const navigation = historyNavigation();
    return navigation === null ? "11" : `${+navigation.canGoBack}${+navigation.canGoForward}`;
  });
  return { back: key[0] === "1", forward: key[1] === "1" };
}
