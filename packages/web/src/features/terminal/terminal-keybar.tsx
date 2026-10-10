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
import { GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { useTerminalChrome } from "./terminal-appearance";
import { S } from "../../lib/strings";
import {
  NO_MODIFIERS,
  arrowSequence,
  type ArrowKey,
  type TerminalModifiers,
} from "./terminal-keys";

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
  // stacking: this app has no class merger, so two border colours on one element resolve by
  // stylesheet order, not by which was written last. The corner is the theme's.
  const capShape =
    "flex h-9 min-w-8 flex-1 basis-0 items-center justify-center rounded-sm border px-1 text-xs font-medium";

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
      data-tooltip={props.label}
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
      // A hairline between caps: the row's width is budgeted to the cap, so the gap stays thin.
      className={`no-scrollbar flex shrink-0 items-center gap-px overflow-x-auto border-t pt-1 ${chrome.border}`}
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
        children: <GlyphIcon d={ICONS.clipboard} size={ICON_SIZE.rowLead} />,
      })}
      {cap({
        testId: "terminal-key-keyboard",
        label: focused ? S.terminal.touchKeys.hideKeyboard : S.terminal.touchKeys.showKeyboard,
        onPress: () => (focused ? control.current?.blur() : control.current?.focus()),
        children: (
          <GlyphIcon
            d={focused ? ICONS.keyboardChevronDown : ICONS.keyboardChevronUp}
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
