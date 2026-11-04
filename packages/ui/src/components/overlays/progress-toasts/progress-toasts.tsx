/**
 * Long operations in the corner: a card per operation that takes noticeable time — a title, a
 * bar, a line of figures — which keeps the user informed while the work goes on elsewhere, and
 * which they can close at any point without stopping it.
 *
 * Raise one from anywhere with `startProgress({ title })`, then drive it through the handle it
 * returns: `update` as readings arrive, `finish` once the work is over (`failed` for a stop short),
 * and `closed` to learn whether the user has let it go. One `<ProgressToasts />` mounted at the app
 * root draws them. The words are the caller's; the package adds only the close cross's name.
 *
 * An operation is shown only once it has run for `PROGRESS_REVEAL_MS`: one that ends sooner never
 * appears, since a card flashing up and away says nothing the result does not. A shown card that
 * finishes well stays for `PROGRESS_DONE_STAY_MS` with its finishing words and a full bar, then
 * leaves; one that fails stays until closed, since its words need reading. Without `value` the bar
 * is indeterminate (a phase with no amount yet, such as counting).
 *
 * The stack sits at the bottom right — clear of the toasts at the top centre — across the width
 * at phone size, portaled above dialogs like the toasts. It lets the pointer through and only the
 * cards take it. A visually hidden polite live region reads each shown card's title, which the
 * caller changes on the transitions that matter (started, finished, failed); the figures update
 * too often to be read out and stay in the bar and the visible line.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import { CloseButton } from "../../actions/close-button/close-button";
import { ProgressBar } from "../../feedback/progress-bar/progress-bar";

export type ProgressState = "running" | "done" | "failed";

export interface ProgressItem {
  id: number;
  title: string;
  /** The line under the bar: what is being done, in figures. */
  detail?: string;
  /** How far along, out of `max`; absent while there is no amount to show. */
  value?: number;
  max?: number;
  state: ProgressState;
  /** On screen: false until the operation has run for `PROGRESS_REVEAL_MS`. */
  shown: boolean;
  /** Leaving: plays the exit, then is removed. */
  leaving?: boolean;
}

/** What `update` and `finish` change. */
export interface ProgressPatch {
  title?: string;
  detail?: string;
  value?: number;
  max?: number;
}

export interface ProgressHandle {
  update(patch: ProgressPatch): void;
  /** The work is over: `failed` keeps the card until it is closed. */
  finish(patch?: ProgressPatch & { failed?: boolean }): void;
  /** Takes the card away now. */
  close(): void;
  /** True once the card is gone — closed by the user, by `close`, or after finishing. */
  readonly closed: boolean;
}

/** How long an operation runs before its card appears, ms. */
export const PROGRESS_REVEAL_MS = 600;
/** How long a card that finished well stays, ms. */
export const PROGRESS_DONE_STAY_MS = 4000;
/**
 * How long a leaving card waits for its exit animation before it is removed anyway, ms: under
 * reduced motion, or a theme that jumps, no animation runs and none reports its end. Past every
 * theme's exit duration.
 */
const LEAVE_FALLBACK_MS = 400;

/** The operations, oldest first, shown or not. Drive them through `startProgress`. */
export const progressStore = createStore<{ items: ProgressItem[] }>(() => ({ items: [] }));
let nextId = 1;

const find = (id: number): ProgressItem | undefined =>
  progressStore.getState().items.find((i) => i.id === id);

function patchItem(id: number, patch: Partial<ProgressItem>): void {
  progressStore.setState((s) => ({
    items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  }));
}

function remove(id: number): void {
  progressStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
}

/**
 * Takes a card away — what its close cross does: plays the exit of a shown card, or drops one
 * never shown at once. The operation behind it goes on; its handle reads `closed` from then on.
 */
export function closeProgress(id: number): void {
  const item = find(id);
  if (!item || item.leaving) return;
  if (!item.shown) {
    remove(id);
    return;
  }
  patchItem(id, { leaving: true });
  setTimeout(() => remove(id), LEAVE_FALLBACK_MS);
}

/** Starts an operation's card; it appears once the operation has run for `PROGRESS_REVEAL_MS`. */
export function startProgress(init: ProgressPatch & { title: string }): ProgressHandle {
  const id = nextId++;
  progressStore.setState((s) => ({
    items: [...s.items, { ...init, id, state: "running", shown: false }],
  }));
  setTimeout(() => {
    const item = find(id);
    if (item && item.state === "running" && !item.leaving) patchItem(id, { shown: true });
  }, PROGRESS_REVEAL_MS);
  return {
    update(patch) {
      const item = find(id);
      if (item && item.state === "running" && !item.leaving) patchItem(id, patch);
    },
    finish({ failed = false, ...patch } = {}) {
      const item = find(id);
      if (!item || item.state !== "running" || item.leaving) return;
      if (!item.shown && !failed) {
        // Over before anyone saw it: nothing to report that the result does not say.
        remove(id);
        return;
      }
      patchItem(id, { ...patch, state: failed ? "failed" : "done", shown: true });
      if (!failed) setTimeout(() => closeProgress(id), PROGRESS_DONE_STAY_MS);
    },
    close() {
      closeProgress(id);
    },
    get closed() {
      const item = find(id);
      return item === undefined || item.leaving === true;
    },
  };
}

const TONE: Readonly<Record<ProgressState, "accent" | "success" | "danger">> = {
  running: "accent",
  done: "success",
  failed: "danger",
};

/** One card as it is drawn. */
function ProgressCard({ item, onClose }: { item: ProgressItem; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // No exit plays under reduced motion or in a theme that jumps: the card goes at once rather
  // than standing still until the fallback.
  useEffect(() => {
    if (item.leaving && box.current && getComputedStyle(box.current).animationName === "none") {
      remove(item.id);
    }
  }, [item.leaving, item.id]);
  // A finished operation reads as complete whatever its last reading was.
  const value = item.state === "done" ? (item.max ?? 1) : item.value;
  return (
    <div
      ref={box}
      data-presence={item.leaving ? "exit" : "enter"}
      data-side="bottom"
      onAnimationEnd={(e) => {
        if (item.leaving && e.target === e.currentTarget) remove(item.id);
      }}
      className="pointer-events-auto w-full rounded-lg border border-line bg-overlay px-3 py-2.5 shadow-lg sm:w-80"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-medium text-fg">{item.title}</p>
        <CloseButton onClose={onClose} className="-my-1 -mr-1.5 shrink-0" />
      </div>
      <ProgressBar
        label={item.title}
        value={value}
        max={item.state === "done" ? (item.max ?? 1) : item.max}
        indeterminate={item.state === "running" && item.value === undefined}
        tone={TONE[item.state]}
        className="mt-2"
      />
      {item.detail !== undefined && item.detail !== "" && (
        <p
          className={`mt-1.5 break-words text-xs tabular-nums ${item.state === "failed" ? "text-tone-danger-fg" : "text-fg-muted"}`}
        >
          {item.detail}
        </p>
      )}
    </div>
  );
}

/** The stack as it is drawn, without the portal: what `ProgressToasts` renders into the body. */
export function ProgressStack({
  items,
  onClose,
}: {
  items: readonly ProgressItem[];
  onClose: (id: number) => void;
}) {
  const shown = items.filter((i) => i.shown);
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:left-auto">
      <p className="sr-only" aria-live="polite">
        {shown
          .filter((i) => !i.leaving)
          .map((i) => i.title)
          .join(". ")}
      </p>
      {shown.map((item) => (
        <ProgressCard key={item.id} item={item} onClose={() => onClose(item.id)} />
      ))}
    </div>
  );
}

/** The operations' stack: mount once at the app root. */
export function ProgressToasts() {
  const items = useStore(progressStore, (s) => s.items);
  // A static render has no document to portal into, and nothing to show there.
  if (typeof document === "undefined") return null;
  return createPortal(<ProgressStack items={items} onClose={closeProgress} />, document.body);
}
