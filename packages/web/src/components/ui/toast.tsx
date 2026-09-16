/**
 * Top overlay toast: results like "saved successfully" or "connection failed"
 * all pop up at the top of the page and disappear automatically after a few
 * seconds.
 *
 * Rendered via portal to body with a z-index above Modal/drawer (z-50), so a
 * toast triggered inside a dialog is still visible; the container doesn't
 * intercept mouse events (pointer-events-none) — only the toast itself is
 * interactive (clicking it dismisses immediately).
 *
 * Usage: call `toastSuccess("Saved")` / `toastInfo("Already up to date")` /
 * `toastAttention("Two desks share one minute")` / `toastError("Connection
 * failed: ...")` from anywhere, no context needed — a module-level store plus a
 * single `<Toaster />` mounted at the app root is all it takes.
 */
import { createPortal } from "react-dom";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";

/** `attention` is the advisory kind: the write went through, and something about it is worth a look. */
type ToastKind = "success" | "error" | "info" | "attention";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** Leaving: plays the exit animation first, removed from the list once it finishes. */
  leaving?: boolean;
}

/** Display duration: an error and an advisory both need reading, so they get the longest stay; info sits in between; a plain success is gone as soon as it is seen. */
const DURATION: Record<ToastKind, number> = {
  success: 2500,
  info: 4000,
  attention: 6000,
  error: 6000,
};

const toastStore = createStore<{ items: ToastItem[] }>(() => ({ items: [] }));
let nextId = 1;

/** Exit animation duration (matches toast-out in styles.css). */
const LEAVE_MS = 160;

function dismiss(id: number): void {
  const item = toastStore.getState().items.find((i) => i.id === id);
  if (!item || item.leaving) return;
  // Mark as leaving first (triggering the exit animation), then actually remove it once the animation ends — otherwise the toast would just vanish abruptly.
  toastStore.setState((s) => ({
    items: s.items.map((i) => (i.id === id ? { ...i, leaving: true } : i)),
  }));
  setTimeout(() => {
    toastStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  }, LEAVE_MS);
}

function push(kind: ToastKind, text: string): void {
  if (!text) return;
  const id = nextId++;
  toastStore.setState((s) => ({ items: [...s.items, { id, kind, text }] }));
  setTimeout(() => dismiss(id), DURATION[kind]);
}

export const toastSuccess = (text: string): void => push("success", text);
export const toastError = (text: string): void => push("error", text);
export const toastInfo = (text: string): void => push("info", text);
export const toastAttention = (text: string): void => push("attention", text);

const KIND_CLASS: Record<ToastKind, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  attention:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

/** Toast container: mount once at the app root. */
export function Toaster() {
  const list = useStore(toastStore, (s) => s.items);
  if (list.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-lg break-words rounded-md border px-3 py-2 text-left text-sm shadow-lg ${t.leaving ? "anim-toast-out" : "anim-toast-in"} ${KIND_CLASS[t.kind]}`}
        >
          {t.text}
        </button>
      ))}
    </div>,
    document.body,
  );
}
