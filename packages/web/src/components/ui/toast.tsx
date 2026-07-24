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
 * `toastError("Connection failed: ...")` from anywhere, no context needed — a
 * module-level subscriber list plus a single `<Toaster />` mounted at the app
 * root is all it takes.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** Leaving: plays the exit animation first, removed from the list once it finishes. */
  leaving?: boolean;
}

/** Display duration: error messages are usually longer and more important to read, so give them more time; info sits in between. */
const DURATION: Record<ToastKind, number> = { success: 2500, info: 4000, error: 6000 };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit(): void {
  for (const l of listeners) l(items);
}

/** Exit animation duration (matches toast-out in styles.css). */
const LEAVE_MS = 160;

function dismiss(id: number): void {
  const item = items.find((i) => i.id === id);
  if (!item || item.leaving) return;
  // Mark as leaving first (triggering the exit animation), then actually remove it once the animation ends — otherwise the toast would just vanish abruptly.
  items = items.map((i) => (i.id === id ? { ...i, leaving: true } : i));
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    emit();
  }, LEAVE_MS);
}

function push(kind: ToastKind, text: string): void {
  if (!text) return;
  const id = nextId++;
  items = [...items, { id, kind, text }];
  emit();
  setTimeout(() => dismiss(id), DURATION[kind]);
}

export const toastSuccess = (text: string): void => push("success", text);
export const toastError = (text: string): void => push("error", text);
export const toastInfo = (text: string): void => push("info", text);

const KIND_CLASS: Record<ToastKind, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

/** Toast container: mount once at the app root. */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
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
