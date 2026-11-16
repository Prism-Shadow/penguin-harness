/**
 * The element picker: the person points at one thing on the screen, and the session receives
 * its xpath and a link that resolves back to it.
 *
 * One picker exists per page. It is opened from the chat window's header (the message it
 * produces goes straight into the conversation) or by an Agent's `penguin pet ui pick`
 * command (the answer goes back to that command). Both share this store, so a second request
 * replaces the first rather than stacking two catchers over one screen.
 *
 * A password box is refused, not masked: the picker moves past it and says why. Selecting one
 * would hand the session an address into the one element whose contents the bridge must never
 * read, and the refusal is the whole point of the rule.
 */
import { useEffect, useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import {
  OVERLAY_ATTRIBUTE,
  describeElement,
  elementLink,
  isOverlayElement,
  isSensitiveElement,
} from "./dom";
import type { ElementDescription } from "./dom";

/** One picked element, with the handle that names it. */
export interface PickResult extends ElementDescription {
  pageId: string;
  link: string;
}

interface PickerState {
  active: boolean;
  /** The line over the screen: what this pick is for, and the way out. */
  hint: string;
  /** The candidate under the pointer, in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** Set when the pointer is over something the picker refuses. */
  refused: boolean;
}

const IDLE: PickerState = { active: false, hint: "", rect: null, refused: false };

let state: PickerState = IDLE;
let pageId = "";
let pending: ((result: PickResult | null) => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: PickerState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): PickerState {
  return state;
}

/** The page the picker sends its link under (set by the bridge layer once per page). */
export function setPickerPageId(id: string): void {
  pageId = id;
}

/**
 * Opens the picker and resolves with the picked element, or null when it is cancelled or
 * replaced by a later pick. The hint is shown over the screen.
 */
export function startPick(hint = ""): Promise<PickResult | null> {
  pending?.(null);
  publish({ active: true, hint, rect: null, refused: false });
  return new Promise<PickResult | null>((resolve) => {
    pending = resolve;
  });
}

/** Closes the picker without a result. */
export function cancelPick(): void {
  if (!state.active) return;
  const resolve = pending;
  pending = null;
  publish(IDLE);
  resolve?.(null);
}

function finish(result: PickResult): void {
  const resolve = pending;
  pending = null;
  publish(IDLE);
  resolve?.(result);
}

/** The element under a point, skipping the bridge's own surfaces and the document root. */
function elementAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (isOverlayElement(el)) continue;
    if (el === document.documentElement || el === document.body) continue;
    return el;
  }
  return null;
}

/** The overlay itself: a catcher, a highlight box, and the line that says what to do. */
export function PickOverlay() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!current.active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPick();
      }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [current.active]);
  if (!current.active) return null;
  return (
    <div
      {...{ [OVERLAY_ATTRIBUTE]: "" }}
      className="fixed inset-0"
      style={{ zIndex: 2_147_483_000 }}
      data-testid="platform-ui-picker"
    >
      <div
        className="absolute inset-0 cursor-crosshair"
        style={{ pointerEvents: "auto" }}
        onPointerMove={(event) => {
          const el = elementAt(event.clientX, event.clientY);
          if (el === null) {
            if (current.rect !== null || current.refused) {
              publish({ ...current, rect: null, refused: false });
            }
            return;
          }
          const refused = isSensitiveElement(el);
          const box = el.getBoundingClientRect();
          publish({
            ...current,
            refused,
            rect: {
              x: Math.round(box.x),
              y: Math.round(box.y),
              width: Math.round(box.width),
              height: Math.round(box.height),
            },
          });
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const el = elementAt(event.clientX, event.clientY);
          if (el === null) return;
          if (isSensitiveElement(el)) {
            publish({ ...current, refused: true });
            return;
          }
          const description = describeElement(el);
          finish({
            ...description,
            pageId,
            link: elementLink(pageId, description.xpath),
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          cancelPick();
        }}
      />
      {current.rect !== null && (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-accent"
          style={{
            left: current.rect.x,
            top: current.rect.y,
            width: current.rect.width,
            height: current.rect.height,
            background: current.refused ? "rgba(220, 38, 38, 0.12)" : "rgba(59, 130, 246, 0.12)",
            borderColor: current.refused ? "rgb(220, 38, 38)" : undefined,
          }}
        />
      )}
      <div
        className="absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line-emphasis bg-surface px-3 py-1.5 text-xs text-fg shadow-lg"
        style={{ pointerEvents: "auto" }}
      >
        <span>{current.refused ? S.petChat.pickRefused : current.hint || S.petChat.pickHint}</span>
        <span className="text-fg-muted">{S.petChat.pickEscape}</span>
        <button
          type="button"
          className="cursor-pointer text-fg-muted hover:text-fg"
          onClick={() => cancelPick()}
        >
          {S.petChat.pickCancel}
        </button>
      </div>
    </div>
  );
}
