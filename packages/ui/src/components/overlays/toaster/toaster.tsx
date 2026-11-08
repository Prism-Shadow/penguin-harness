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
 * with them. An error toast may carry a problem report (`toastError(text, { report })`, for an
 * error that is a defect rather than the person's to fix): it then holds two presses, its words
 * (dismiss) and 「[报告问题]」 after them, and stays a little longer so the second can be reached.
 * Any toast may carry one action of the caller's the same way (`toastInfo(text, { action })`, an
 * Undo after something the app did on the person's behalf): its word in brackets after the text,
 * which runs the action and dismisses the toast. The stack is portaled to the body above dialogs
 * and drawers (`z-[100]` over their `z-50`), so a toast raised inside a dialog is still seen; the
 * stack lets the pointer through and only the toasts take it.
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
import { TextAction } from "../../actions/text-action/text-action";
import { NoticeStrip } from "../../feedback/notice/notice-strip";
import type { NoticeStripTone } from "../../feedback/notice/notice-strip";
import { ReportIssueAction } from "../../report/report-action";
import type { ErrorReport } from "../../report/error-report";

/** `attention` is the advisory kind: the write went through, and something in it needs a look. */
export type ToastKind = "success" | "error" | "info" | "attention";

/** A press the caller puts on its toast, after the text: its word, and what pressing it does. */
export interface ToastAction {
  label: string;
  /** Runs once, as the toast dismisses itself. */
  onPress: () => void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** An error's problem report, opened from 「[报告问题]」 on the toast. */
  report?: ErrorReport | (() => ErrorReport);
  /** The caller's press after the text. */
  action?: ToastAction;
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

/** How long a toast that carries a second press (a report, an action) stays, ms: long enough to reach it. */
const SECOND_PRESS_DURATION = 10_000;

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

function push(kind: ToastKind, text: string, options: ErrorToastOptions = {}): void {
  if (!text) return;
  const id = nextId++;
  const { report, action } = options;
  const item: ToastItem = {
    id,
    kind,
    text,
    ...(report !== undefined ? { report } : {}),
    ...(action !== undefined ? { action } : {}),
  };
  toastStore.setState((s) => ({ items: [...s.items, item] }));
  const secondPress = report !== undefined || action !== undefined;
  setTimeout(() => dismiss(id), secondPress ? SECOND_PRESS_DURATION : DURATION[kind]);
}

export interface ToastOptions {
  /** A press after the text (an Undo): the toast offers it in brackets and stays longer. */
  action?: ToastAction;
}

export interface ErrorToastOptions extends ToastOptions {
  /** A serious error's problem report: the toast offers 「[报告问题]」. */
  report?: ErrorReport | (() => ErrorReport);
}

export const toastSuccess = (text: string, options?: ToastOptions): void =>
  push("success", text, options);
export const toastError = (text: string, options?: ErrorToastOptions): void =>
  push("error", text, options);
export const toastInfo = (text: string, options?: ToastOptions): void =>
  push("info", text, options);
export const toastAttention = (text: string, options?: ToastOptions): void =>
  push("attention", text, options);

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
      className="pointer-events-none fixed inset-x-0 top-[calc(env(titlebar-area-height,0px)+0.75rem)] z-[100] flex flex-col items-center gap-2 px-4"
    >
      <span id={hint} hidden>
        {strings.dismiss}
      </span>
      {items.map((t) => (
        <div
          key={t.id}
          className={`max-w-lg rounded-lg bg-overlay ${t.leaving ? "anim-toast-out" : "anim-toast-in"}`}
        >
          {t.report === undefined && t.action === undefined ? (
            <NoticeStrip
              as="button"
              tone={KIND_TONE[t.kind]}
              aria-describedby={hint}
              onClick={() => onDismiss(t.id)}
              className="pointer-events-auto block w-full break-words rounded-md border px-3 py-2 text-left text-sm shadow-lg"
            >
              <span data-slot="body">{t.text}</span>
            </NoticeStrip>
          ) : (
            // Two presses cannot nest in one button: the words dismiss, the action after them acts.
            <NoticeStrip
              as="div"
              tone={KIND_TONE[t.kind]}
              className="pointer-events-auto flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm shadow-lg"
            >
              <button
                type="button"
                aria-describedby={hint}
                onClick={() => onDismiss(t.id)}
                className="min-w-0 flex-1 cursor-pointer break-words text-left"
              >
                <span data-slot="body">{t.text}</span>
              </button>
              {t.action !== undefined && (
                <TextAction
                  onClick={() => {
                    onDismiss(t.id);
                    t.action?.onPress();
                  }}
                >
                  {t.action.label}
                </TextAction>
              )}
              {t.report !== undefined && (
                <ReportIssueAction report={t.report} onOpen={() => onDismiss(t.id)} />
              )}
            </NoticeStrip>
          )}
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
