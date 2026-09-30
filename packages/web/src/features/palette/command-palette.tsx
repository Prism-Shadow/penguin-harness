/**
 * The command palette (the `palette.toggle` shortcut, ⌥⌘P / Ctrl+Alt+P by default), VSCode-style:
 * a top-centered input filtering a list of actions; Enter (or click) runs the selected one. The
 * palette is mechanism only — its actions come from the mount point (app-palette.tsx), so a new
 * capability registers an action instead of claiming another global shortcut.
 *
 * Keyboard model: ArrowUp/ArrowDown move the selection (wrapping), Enter runs, Escape
 * closes through the shared esc-layer stack (modal.tsx), and the shortcut that opened it
 * toggles it closed. Filtering is filterPaletteActions (lib/command-palette.ts).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogLayer } from "../../components/ui/modal";
import { filterPaletteActions, type PaletteAction } from "../../lib/command-palette";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";

export function CommandPalette({ actions }: { actions: readonly PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // The chord is the keymap's (lib/shortcuts): the window dispatcher matches it, calls this
  // handler and prevents the browser default once it is handled. A functional update reads
  // the latest `open`, so the handler registers once.
  useEffect(
    () =>
      onCommand("palette.toggle", () => {
        setOpen((o) => !o);
        setQuery("");
        setSelected(0);
      }),
    [],
  );
  const toggleShortcut = useShortcutLabel("palette.toggle");

  // Escape closes it only while it is the topmost esc-consuming layer (shared with Modal /
  // Dropdown, see modal.tsx), so an action's own dialog above it gets its Escape first; Tab
  // stays inside the panel, and closing hands focus back to where it was.
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown: onPanelKeyDown } = useDialogLayer(open, panelRef, () => setOpen(false));

  if (!open) return null;

  const filtered = filterPaletteActions(actions, query);
  const sel = Math.min(selected, Math.max(filtered.length - 1, 0));

  const runAction = (action: PaletteAction) => {
    // Close first: an action may open its own overlay and expects the palette gone.
    setOpen(false);
    action.run();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setSelected((sel + delta + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[sel];
      if (action !== undefined) runAction(action);
    }
  };

  return createPortal(
    <div
      // z-50 like Modal's overlay: a portaled menu or tooltip (z-[60]) opened from inside still paints above it.
      className="anim-fade fixed inset-0 z-50 flex justify-center bg-black/45 px-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={S.commandPalette.title}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="anim-pop h-fit w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onInputKeyDown}
          placeholder={S.commandPalette.placeholder}
          aria-label={S.commandPalette.placeholder}
          className="w-full border-b border-gray-200 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-gray-400 dark:border-gray-800 dark:placeholder:text-gray-500"
        />
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
            {S.commandPalette.noResults}
          </p>
        ) : (
          <ul className="max-h-[40vh] overflow-y-auto py-1" role="listbox">
            {filtered.map((action, i) => (
              <li key={action.id} role="option" aria-selected={i === sel}>
                <button
                  type="button"
                  className={`w-full px-4 py-2 text-left text-sm ${
                    i === sel
                      ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => runAction(action)}
                >
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-gray-200 px-4 py-2 text-right text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
          {S.commandPalette.hint(toggleShortcut)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
