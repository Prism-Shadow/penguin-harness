/**
 * Global-scope shortcuts: one `window` keydown listener in the bubble phase, installed at module
 * evaluation rather than in a React effect — an effect runs after paint, and a key can land in
 * between (the reason dock-terminal.ts already gave for its own listener). Surfaces that own an
 * action register a handler for the command id; the listener matches the event against the
 * keymap and runs the handler, and `preventDefault`s only what was handled.
 *
 * Focus-scoped commands never come through here: the terminal decides its own keys inside
 * xterm's key handler and stops their propagation, and the editors match `editor.save` in their
 * own onKeyDown and prevent the default, which this listener respects by skipping any event that
 * arrives already `defaultPrevented`.
 */
import { matchShortcut } from "./match";
import { currentPlatform } from "./platform";
import { keymap } from "./store";
import type { CommandId } from "./types";

/** Returning false declines the command so an earlier-registered handler may take it; anything else handles it. */
export type CommandHandler = () => boolean | void;

const handlers = new Map<CommandId, CommandHandler[]>();

/** Registers a handler; the last registered runs first. Returns the unregister function. */
export function onCommand(id: CommandId, handler: CommandHandler): () => void {
  const list = handlers.get(id) ?? [];
  list.push(handler);
  handlers.set(id, list);
  return () => {
    const current = handlers.get(id);
    if (current === undefined) return;
    const index = current.lastIndexOf(handler);
    if (index >= 0) current.splice(index, 1);
  };
}

/** Whether any surface currently answers the command (a chord with no handler goes on to whatever it meant before). */
export function hasCommandHandler(id: CommandId): boolean {
  return (handlers.get(id)?.length ?? 0) > 0;
}

/** Runs the command; true when some handler took it. */
export function runCommand(id: CommandId): boolean {
  const list = handlers.get(id);
  if (list === undefined) return false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!() !== false) return true;
  }
  return false;
}

let blocker: (() => boolean) | null = null;

/**
 * Installs the predicate that suspends global commands: while a dialog or a menu is open (the
 * Esc-layer stack in components/ui/modal.tsx), a command must not run behind it — ⌘K would open
 * the sidebar search under the overlay and pull focus out of the dialog. The store stays free of
 * React, so the layer owner installs the predicate itself at module scope.
 */
export function setShortcutBlocker(fn: (() => boolean) | null): void {
  blocker = fn;
}

/**
 * The window's keydown listener. A held chord auto-repeats: a repeat of a command that has a
 * handler is kept from the browser's own action (Print, Downloads, address-bar search) but does
 * not run the command again, so a held ⌘B toggles the sidebar once. Behind an open dialog every
 * key is left alone, so the dialog's own keys (and the browser's) work as if nothing were bound.
 */
export function handleShortcutKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (blocker?.() === true) return;
  const id = matchShortcut(event, keymap(), ["global"], currentPlatform());
  if (id === null) return;
  if (event.repeat) {
    if (hasCommandHandler(id)) event.preventDefault();
    return;
  }
  if (runCommand(id)) event.preventDefault();
}

if (typeof window !== "undefined") window.addEventListener("keydown", handleShortcutKeydown);
