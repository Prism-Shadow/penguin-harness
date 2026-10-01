/**
 * The top toasts: a result like "Saved" or "Connection failed" pops up at the top of the page and
 * leaves by itself after a few seconds.
 *
 * Raise one from anywhere — `toastSuccess("Saved")`, `toastInfo("Already up to date")`,
 * `toastAttention("Two desks share one minute")`, `toastError("Connection failed: …")` — with no
 * context: a module-level store and one `<Toaster />` mounted at the app root are all it takes.
 * The words are the caller's. The package adds only the stack's accessible name and the hint that
 * pressing a toast dismisses it (`UiStrings`).
 *
 * A toast is a notice: each one renders through `NoticeStrip` as a button, so it carries the
 * `ui-notice` hook and the strip's tone colours, and a theme that restyles notices restyles toasts
 * with them. The stack is portaled to the body above dialogs and drawers (`z-[100]` over their
 * `z-50`), so a toast raised inside a dialog is still seen; the stack lets the pointer through and
 * only the toasts take it.
 *
 * The stack is a polite live region, and it stays mounted while empty: a region inserted together
 * with its first message is often not announced at all.
 *
 * Each toast stands on an opaque backing in the overlay colour. The tone tints are translucent in
 * the dark modes — they are drawn for a strip on a page surface — while a toast floats over
 * whatever lies under it, which would otherwise show through its text. The backing takes the
 * largest corner a notice recipe gives a toast (`rounded-lg`), so its corners never reach past
 * the toast's own.
 */
import { useId } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import { useUiStrings } from "../../../strings";
import { NoticeStrip } from "../../feedback/notice/notice-strip";
import type { NoticeStripTone } from "../../feedback/notice/notice-strip";

/** `attention` is the advisory kind: the write went through, and something in it needs a look. */
export type ToastKind = "success" | "error" | "info" | "attention";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** Leaving: plays the exit animation first, and is removed from the list once it has run. */
  leaving?: boolean;
}

/**
 * How long a toast stays, ms: an error and an advisory both need reading, so they stay longest;
 * info sits in between; a plain success is gone as soon as it is seen.
 */
const DURATION: Readonly<Record<ToastKind, number>> = {
  success: 2500,
  info: 4000,
  attention: 6000,
  error: 6000,
};

/** The exit animation's length, ms (the web app's `anim-toast-out`). */
const LEAVE_MS = 160;

const KIND_TONE: Readonly<Record<ToastKind, NoticeStripTone>> = {
  success: "success",
  error: "danger",
  info: "info",
  attention: "attention",
};

/** The toasts on screen, oldest first. Raise them through the functions below. */
export const toastStore = createStore<{ items: ToastItem[] }>(() => ({ items: [] }));
let nextId = 1;

function dismiss(id: number): void {
  const item = toastStore.getState().items.find((i) => i.id === id);
  if (!item || item.leaving) return;
  // Marked as leaving first, which plays the exit animation, and removed once it has run —
  // otherwise the toast would vanish abruptly.
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

/** The stack as it is drawn, without the portal: what `Toaster` renders into the body. */
export function ToastStack({
  items,
  onDismiss,
}: {
  items: readonly ToastItem[];
  /** Pressing a toast dismisses it at once. */
  onDismiss: (id: number) => void;
}) {
  const strings = useUiStrings();
  const hint = useId();
  return (
    <section
      aria-label={strings.notifications}
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4"
    >
      <span id={hint} hidden>
        {strings.dismiss}
      </span>
      {items.map((t) => (
        <div
          key={t.id}
          className={`max-w-lg rounded-lg bg-overlay ${t.leaving ? "anim-toast-out" : "anim-toast-in"}`}
        >
          <NoticeStrip
            as="button"
            tone={KIND_TONE[t.kind]}
            aria-describedby={hint}
            onClick={() => onDismiss(t.id)}
            className="pointer-events-auto block w-full break-words rounded-md border px-3 py-2 text-left text-sm shadow-lg"
          >
            <span data-slot="body">{t.text}</span>
          </NoticeStrip>
        </div>
      ))}
    </section>
  );
}

/** The toast stack: mount once at the app root. */
export function Toaster() {
  const items = useStore(toastStore, (s) => s.items);
  // A static render has no document to portal into, and nothing to show there.
  if (typeof document === "undefined") return null;
  return createPortal(<ToastStack items={items} onDismiss={dismiss} />, document.body);
}
