/**
 * The way back to the docks from a window shown over them.
 *
 * The docks belong to the Chat window, and a workbench tab is a window shown over it: while one
 * is up, a dock moved by a keyboard shortcut would move out of sight. So the chat page registers
 * how to bring Chat back for as long as a workbench tab is shown, and a dock shortcut that acts
 * calls it first: the key switches to Chat, then opens, closes or focuses its dock there.
 */
let revealer: (() => void) | null = null;

/** Registers how to show the window holding the docks; the returned function withdraws it. */
export function setDockRevealer(reveal: () => void): () => void {
  revealer = reveal;
  return () => {
    if (revealer === reveal) revealer = null;
  };
}

/** Shows the window holding the docks, if another window is shown over it. */
export function revealDocks(): void {
  revealer?.();
}
