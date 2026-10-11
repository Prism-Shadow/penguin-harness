/**
 * What the viewer does in a hosted tab's picture, as the input events its server takes
 * (POST /tabs/:id/input): the pure half of hosted-surface.tsx, free of the DOM so it runs under
 * the node tests.
 *
 * - The picture is drawn scaled to fit its element and centred (`frameBox`); a pointer position
 *   on screen becomes a position in the frame's own pixels (`framePoint`), which is the space
 *   the server takes them in.
 * - Mouse, wheel and key events carry CDP's modifier bits (`modifierBits`). A key that types a
 *   character carries it as `text` (Enter types "\r"); a key pressed while an input method
 *   composes is the input method's, and is not sent — the committed text is, as a `text` event.
 * - Every press is paired with a release: `HeldInput` remembers what is down, so the surface can
 *   release it all when it loses the keyboard or the pointer (the release would otherwise never
 *   reach the page, which would see a key or a button held forever).
 * - `InputQueue` holds what has not been sent yet. A move after a move replaces it and a wheel
 *   after a wheel adds to it, so however fast the pointer moves, a request carries one position.
 */
import type {
  HostedBrowserInputEvent,
  HostedBrowserViewport,
} from "@prismshadow/penguin-server/api";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The modifier keys of a DOM event. */
export interface ModifierKeys {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** The part of a MouseEvent the translation reads. */
export interface MouseLike extends ModifierKeys {
  button: number;
  buttons: number;
  /** The click count on a press or a release. */
  detail: number;
}

/** The part of a WheelEvent the translation reads. */
export interface WheelLike extends ModifierKeys {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
}

/** The part of a KeyboardEvent the translation reads. */
export interface KeyLike extends ModifierKeys {
  key: string;
  code: string;
  keyCode: number;
  repeat: boolean;
  isComposing: boolean;
}

type MouseInput = Extract<HostedBrowserInputEvent, { type: "mouse" }>;
type KeyInput = Extract<HostedBrowserInputEvent, { type: "key" }>;

/** The most events one request carries (the server's limit). */
export const MAX_INPUT_BATCH = 200;
/** A wheel line, in pixels: what browsers scroll for one. */
const WHEEL_LINE_PX = 16;
/** The key code every key reports while an input method composes. */
const IME_KEY_CODE = 229;

/** The size a panel asks its page to be laid out to: whole CSS pixels, or null while it has no area. */
export function viewportOf(size: FrameSize): HostedBrowserViewport | null {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Where the frame is drawn inside its element: scaled to fit, keeping its shape, centred. */
export function frameBox(element: Box, frame: FrameSize): Box {
  if (frame.width <= 0 || frame.height <= 0 || element.width <= 0 || element.height <= 0) {
    return { left: element.left, top: element.top, width: 0, height: 0 };
  }
  const scale = Math.min(element.width / frame.width, element.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    left: element.left + (element.width - width) / 2,
    top: element.top + (element.height - height) / 2,
    width,
    height,
  };
}

/**
 * A position on screen (clientX / clientY) as a position in the frame's pixels. A position
 * outside the picture — the bars beside a frame of another shape, a drag that left the panel —
 * is held to its nearest edge.
 */
export function framePoint(client: Point, element: Box, frame: FrameSize): Point {
  const box = frameBox(element, frame);
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  const along = (at: number, start: number, length: number, pixels: number): number => {
    const scaled = ((at - start) / length) * pixels;
    return Math.round(Math.min(Math.max(scaled, 0), pixels - 1));
  };
  return {
    x: along(client.x, box.left, box.width, frame.width),
    y: along(client.y, box.top, box.height, frame.height),
  };
}

/** CDP's modifier bit field: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifierBits(keys: ModifierKeys): number {
  return (
    (keys.altKey ? 1 : 0) |
    (keys.ctrlKey ? 2 : 0) |
    (keys.metaKey ? 4 : 0) |
    (keys.shiftKey ? 8 : 0)
  );
}

function buttonName(button: number): NonNullable<MouseInput["button"]> {
  return button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : "none";
}

/** A mouse event at `point` (a frame position). A move names no button and counts no click. */
export function mouseInput(
  action: MouseInput["action"],
  event: MouseLike,
  point: Point,
): MouseInput {
  const moved = action === "move";
  return {
    type: "mouse",
    action,
    x: point.x,
    y: point.y,
    button: moved ? "none" : buttonName(event.button),
    buttons: event.buttons,
    clickCount: moved ? 0 : Math.max(1, event.detail),
    modifiers: modifierBits(event),
  };
}

/** A wheel event at `point`, its deltas in pixels whatever unit the device reported them in. */
export function wheelInput(
  event: WheelLike,
  point: Point,
  frame: FrameSize,
): HostedBrowserInputEvent {
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? frame.height : 1;
  return {
    type: "wheel",
    x: point.x,
    y: point.y,
    deltaX: event.deltaX * unit,
    deltaY: event.deltaY * unit,
    modifiers: modifierBits(event),
  };
}

/**
 * The character a key press types, if it types one: Enter's carriage return, or the key's own
 * single character unless a shortcut modifier is held (Ctrl without Alt, or Meta; Ctrl with Alt
 * is how AltGr arrives, and types).
 */
function typedText(event: KeyLike): string | undefined {
  if (event.key === "Enter") return "\r";
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return undefined;
  return [...event.key].length === 1 ? event.key : undefined;
}

/**
 * Whether a key is the paste chord (Ctrl+V, or ⌘V). It is left to the browser, whose paste hands
 * over the clipboard's text; the page then gets that text, not the chord.
 */
export function isPasteKey(event: KeyLike): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v";
}

/**
 * A key going down or up; null for a key an input method is composing with, whose text arrives
 * once committed (`textInput`).
 */
export function keyInput(action: KeyInput["action"], event: KeyLike): KeyInput | null {
  if (event.isComposing || event.keyCode === IME_KEY_CODE || event.key === "Process") return null;
  const text = action === "down" ? typedText(event) : undefined;
  return {
    type: "key",
    action,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    ...(text !== undefined ? { text } : {}),
    ...(action === "down" && event.repeat ? { repeat: true } : {}),
    modifiers: modifierBits(event),
  };
}

/** Text to insert at the caret (an input method's committed text, a paste); null for none. */
export function textInput(text: string): HostedBrowserInputEvent | null {
  return text === "" ? null : { type: "text", text };
}

/** MouseEvent.buttons' bit for a button, by the name the events carry. */
const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

/**
 * The keys and mouse buttons that are down in the page, from the events sent to it.
 * `releaseAll` is every release still owed, for the moment the surface stops receiving them.
 */
export class HeldInput {
  private readonly keys = new Map<string, KeyInput>();
  private buttons = 0;
  private point: Point = { x: 0, y: 0 };

  /** Whether a mouse button is down (a drag is under way). */
  get dragging(): boolean {
    return this.buttons !== 0;
  }

  /** Notes an event that is about to be sent. */
  track(event: HostedBrowserInputEvent): void {
    if (event.type === "key") {
      if (event.action === "down") this.keys.set(event.code, event);
      else this.keys.delete(event.code);
      return;
    }
    if (event.type !== "mouse") return;
    this.point = { x: event.x, y: event.y };
    const bit =
      event.button === undefined || event.button === "none" ? 0 : BUTTON_BITS[event.button];
    if (event.action === "down") this.buttons |= bit;
    else if (event.action === "up") this.buttons &= ~bit;
  }

  /** The releases of everything still down, buttons where the pointer last was; nothing is down after. */
  releaseAll(): HostedBrowserInputEvent[] {
    const events: HostedBrowserInputEvent[] = [];
    for (const name of ["left", "middle", "right"] as const) {
      if ((this.buttons & BUTTON_BITS[name]) === 0) continue;
      this.buttons &= ~BUTTON_BITS[name];
      events.push({
        type: "mouse",
        action: "up",
        x: this.point.x,
        y: this.point.y,
        button: name,
        buttons: this.buttons,
        clickCount: 1,
        modifiers: 0,
      });
    }
    for (const down of this.keys.values()) {
      events.push({
        type: "key",
        action: "up",
        key: down.key,
        code: down.code,
        ...(down.keyCode !== undefined ? { keyCode: down.keyCode } : {}),
        modifiers: 0,
      });
    }
    this.keys.clear();
    return events;
  }
}

/** Whether `next` can stand in for `last`: two moves, or two wheels, in the same state. */
function merged(
  last: HostedBrowserInputEvent,
  next: HostedBrowserInputEvent,
): HostedBrowserInputEvent | null {
  if (last.type === "mouse" && next.type === "mouse") {
    const same =
      last.action === "move" &&
      next.action === "move" &&
      last.buttons === next.buttons &&
      last.modifiers === next.modifiers;
    return same ? next : null;
  }
  if (last.type === "wheel" && next.type === "wheel" && last.modifiers === next.modifiers) {
    return { ...next, deltaX: last.deltaX + next.deltaX, deltaY: last.deltaY + next.deltaY };
  }
  return null;
}

/** The input events not sent yet, in order, with runs of moves and of wheels folded into one. */
export class InputQueue {
  private events: HostedBrowserInputEvent[] = [];

  get size(): number {
    return this.events.length;
  }

  push(event: HostedBrowserInputEvent): void {
    const last = this.events[this.events.length - 1];
    const folded = last === undefined ? null : merged(last, event);
    if (folded !== null) this.events[this.events.length - 1] = folded;
    else this.events.push(event);
  }

  /** The next request's events: the oldest, at most as many as one request carries. */
  take(): HostedBrowserInputEvent[] {
    return this.events.splice(0, MAX_INPUT_BATCH);
  }

  clear(): void {
    this.events = [];
  }
}
