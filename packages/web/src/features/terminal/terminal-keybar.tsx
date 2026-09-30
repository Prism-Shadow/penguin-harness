/**
 * The touch key bar: the keys a phone's soft keyboard does not have.
 *
 * Without it a terminal on a phone is read-only in practice — no Esc, no Tab completion, no
 * ↑ for the last command, and no Ctrl, so not even Ctrl+C. It renders only under
 * `(pointer: coarse)`; a device with a real keyboard already has every key on it.
 *
 * Two things make it behave like a keyboard rather than like buttons:
 *
 * - **Presses never move focus.** Every cap cancels its own `mousedown` — the event that
 *   moves focus, for a tap as much as for a click — so xterm's textarea keeps it and the
 *   soft keyboard does not slide away on the first tap of Esc. It has to be `mousedown` and
 *   not `pointerdown`: cancelling a touch `pointerdown` suppresses the compatibility events
 *   that follow it, and the cap's own `click` is one of them.
 * - **Ctrl and Alt are sticky, one shot.** A phone cannot hold a modifier down, so a tap
 *   arms it and the next character typed on the soft keyboard consumes it (the composition
 *   happens on the data path in terminal-view.tsx). Tapping again disarms.
 */
import { useTerminalChrome } from "./terminal-appearance";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import {
  NO_MODIFIERS,
  arrowSequence,
  type ArrowKey,
  type TerminalModifiers,
} from "./terminal-keys";

/** Clipboard with a sheet on it: paste from the system clipboard. */
const PASTE_ICON =
  "M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H15";
/** Keyboard with a chevron under it: dismiss the soft keyboard. */
const KEYBOARD_HIDE_ICON =
  "M4 4.5h16v10H4zM7.5 8h.01M12 8h.01M16.5 8h.01M8.5 11.5h7M9 18l3 2.5 3-2.5";
/** Keyboard with a chevron above it: bring the soft keyboard back. */
const KEYBOARD_SHOW_ICON =
  "M4 9.5h16v10H4zM7.5 13h.01M12 13h.01M16.5 13h.01M8.5 16.5h7M9 6.5 12 4l3 2.5";

/** What the bar needs from the live terminal; null while none is attached. */
export interface TerminalControl {
  /** Writes into the shell's input stream — the bar's keys never reach xterm's key handler. */
  send(data: string): void;
  paste(): void;
  focus(): void;
  blur(): void;
  /** True while a full-screen app has switched the cursor keys to SS3 (see arrowSequence). */
  applicationCursorKeys(): boolean;
}

const ARROW_GLYPH: Record<ArrowKey, string> = { left: "←", up: "↑", down: "↓", right: "→" };

export interface TerminalKeyBarProps {
  control: React.RefObject<TerminalControl | null>;
  modifiers: TerminalModifiers;
  onModifiers: (mods: TerminalModifiers) => void;
  /** Whether xterm currently holds focus — decides which way the keyboard cap points. */
  focused: boolean;
}

export function TerminalKeyBar({ control, modifiers, onModifiers, focused }: TerminalKeyBarProps) {
  const chrome = useTerminalChrome();
  // The caps SHARE the width the way a keyboard row does, rather than each taking what its
  // label needs: the whole set has to be on screen at once, because a cap that must be
  // scrolled into view is one nobody finds. `min-w-8` is the floor a finger still hits, and
  // it is what makes the row overflow (and scroll) on the narrowest phones instead of
  // squeezing the caps down to slivers.
  // Shape here, colour from the chrome — and the two tones REPLACE each other rather than
  // stacking: this app has no class merger, so `border-gray-300` and `border-amber-600` on
  // one element resolve by stylesheet order, not by which was written last.
  const capShape =
    "flex h-9 min-w-8 flex-1 basis-0 items-center justify-center rounded border px-1 text-xs font-medium";

  /** Sends a sequence the bar composed itself, then spends any armed modifier. */
  const send = (data: string): void => {
    control.current?.send(data);
    if (modifiers.ctrl || modifiers.alt) onModifiers(NO_MODIFIERS);
  };

  const cap = (props: {
    testId: string;
    label: string;
    onPress: () => void;
    children: React.ReactNode;
    /** Modifier caps only: their armed state, which also makes them toggle buttons. */
    pressed?: boolean;
  }) => (
    <button
      key={props.testId}
      type="button"
      data-testid={props.testId}
      aria-label={props.label}
      title={props.label}
      {...(props.pressed !== undefined ? { "aria-pressed": props.pressed } : {})}
      // Keeps focus (and the soft keyboard) on the terminal — see the file header.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onPress}
      className={`${capShape} ${props.pressed === true ? chrome.keyCapArmed : chrome.keyCap}`}
    >
      {props.children}
    </button>
  );

  const arrow = (key: ArrowKey) =>
    cap({
      testId: `terminal-key-${key}`,
      label: S.terminal.touchKeys[key],
      onPress: () =>
        send(arrowSequence(key, modifiers, control.current?.applicationCursorKeys() ?? false)),
      children: <span aria-hidden>{ARROW_GLYPH[key]}</span>,
    });

  return (
    <div
      role="toolbar"
      aria-label={S.terminal.touchKeys.label}
      data-testid="terminal-key-bar"
      className={`no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-t pt-1 ${chrome.border}`}
    >
      {cap({
        testId: "terminal-key-esc",
        label: S.terminal.touchKeys.esc,
        onPress: () => send("\x1b"),
        children: "Esc",
      })}
      {cap({
        testId: "terminal-key-tab",
        label: S.terminal.touchKeys.tab,
        onPress: () => send("\t"),
        children: "Tab",
      })}
      {cap({
        testId: "terminal-key-ctrl",
        label: S.terminal.touchKeys.ctrl,
        pressed: modifiers.ctrl,
        onPress: () => onModifiers({ ...modifiers, ctrl: !modifiers.ctrl }),
        children: "Ctrl",
      })}
      {arrow("left")}
      {arrow("up")}
      {arrow("down")}
      {arrow("right")}
      {cap({
        testId: "terminal-key-interrupt",
        label: S.terminal.touchKeys.interrupt,
        // Its own cap rather than two taps through Ctrl: interrupting a runaway command is
        // the one key a user reaches for with the soft keyboard already dismissed.
        onPress: () => send("\x03"),
        children: "^C",
      })}
      {cap({
        testId: "terminal-key-paste",
        label: S.terminal.touchKeys.paste,
        onPress: () => control.current?.paste(),
        children: <GlyphIcon d={PASTE_ICON} size={ICON_SIZE.rowLead} />,
      })}
      {cap({
        testId: "terminal-key-keyboard",
        label: focused ? S.terminal.touchKeys.hideKeyboard : S.terminal.touchKeys.showKeyboard,
        onPress: () => (focused ? control.current?.blur() : control.current?.focus()),
        children: (
          <GlyphIcon
            d={focused ? KEYBOARD_HIDE_ICON : KEYBOARD_SHOW_ICON}
            size={ICON_SIZE.rowLead}
          />
        ),
      })}
      {/* Last on purpose, away from its sibling Ctrl: eleven caps are a hair wider than a
          phone, and this is the one to leave under the fold. Alt on a phone is Alt+. and
          word motion — worth a swipe, not worth a slot ahead of interrupting a command. */}
      {cap({
        testId: "terminal-key-alt",
        label: S.terminal.touchKeys.alt,
        pressed: modifiers.alt,
        onPress: () => onModifiers({ ...modifiers, alt: !modifiers.alt }),
        children: "Alt",
      })}
    </div>
  );
}
