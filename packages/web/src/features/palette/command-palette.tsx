/**
 * Ctrl+P / Cmd+P command palette, VSCode-style: a top-centered input filtering a list of
 * actions; Enter (or click) runs the selected one. The palette is mechanism only — its
 * actions come from the mount point (app-palette.tsx), so a new capability registers an
 * action instead of claiming another global shortcut.
 *
 * Keyboard model: ArrowUp/ArrowDown move the selection (wrapping), Enter runs, Escape
 * closes through the shared esc-layer stack (modal.tsx), and the shortcut that opened it
 * toggles it closed. Filtering is filterPaletteActions (lib/command-palette.ts).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isTopEscLayer, popEscLayer, pushEscLayer } from "../../components/ui/modal";
import {
  filterPaletteActions,
  isCommandPaletteShortcut,
  type PaletteAction,
} from "../../lib/command-palette";
import { S } from "../../lib/strings";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function CommandPalette({ actions }: { actions: readonly PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // Global shortcut, registered once (a functional update reads the latest `open`).
  // preventDefault on every match — otherwise the browser's print dialog opens underneath.
  useEffect(() => {
    const isMac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(e, isMac)) return;
      e.preventDefault();
      setOpen((o) => !o);
      setQuery("");
      setSelected(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape closes it only while it is the topmost esc-consuming layer (shared with Modal /
  // Dropdown, see modal.tsx), so an action's own dialog above it gets its Escape first.
  useEffect(() => {
    if (!open) return;
    const id = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(id)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(id);
    };
  }, [open]);

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
      className="anim-fade fixed inset-0 z-[70] flex justify-center bg-black/45 px-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-label={S.commandPalette.title}
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
          {S.commandPalette.hint}
        </div>
      </div>
    </div>,
    document.body,
  );
}
