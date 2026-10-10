/**
 * The command palette, VS Code-style: a top-centred search box filtering a list of actions; Enter
 * (or a click) runs the selected one. The palette is mechanism only — the caller decides which
 * actions exist and what opens it (the app binds a global shortcut), so a new capability registers
 * an action instead of claiming another shortcut.
 *
 * Keyboard model: ArrowUp/ArrowDown move the selection (wrapping) and Enter runs it. Escape closes
 * the palette only while it is the topmost Escape-consuming layer (the shared stack Modal and
 * Dropdown use), so a dialog an action opened above it gets its Escape first; Tab stays inside the
 * panel, and closing hands focus back to where it was. Every opening starts over: an empty query
 * with the first action selected.
 *
 * Rendered via portal to body, like Modal, so no transformed or clipping ancestor captures the
 * fixed overlay.
 */
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogLayer } from "../esc-layers/esc-layers";

export interface PaletteAction {
  id: string;
  label: string;
  /** Searchable words beyond the label (an English alias under a Chinese label, say). */
  keywords?: readonly string[];
  run: () => void;
}

/**
 * Palette filtering, VS Code-style-lite: every whitespace-separated query token must appear
 * (case-insensitive substring) in the label or a keyword, in any order. Predictable over fuzzy for
 * a handful of actions; an empty query lists everything in registration order.
 */
export function filterPaletteActions<A extends { label: string; keywords?: readonly string[] }>(
  actions: readonly A[],
  query: string,
): A[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...actions];
  return actions.filter((a) => {
    const hay = [a.label, ...(a.keywords ?? [])].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: readonly PaletteAction[];
  /** Names the dialog for assistive technology; the palette shows no title. */
  title: string;
  /** The search box's placeholder, which is also its accessible name. */
  placeholder: string;
  /** Shown in place of the list when the query matches nothing. */
  emptyText: string;
  /** A line pinned under the list: the keys that drive the palette. */
  hint?: ReactNode;
}

export function CommandPalette({
  open,
  onClose,
  actions,
  title,
  placeholder,
  emptyText,
  hint,
}: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown: onPanelKeyDown } = useDialogLayer(open, panelRef, onClose);

  if (!open) return null;

  const run = (action: PaletteAction) => {
    // Close first: an action may open its own overlay and expects the palette gone.
    onClose();
    action.run();
  };

  return createPortal(
    <div
      // ui-scrim: the overlay is the dimmed layer, with the palette inside it. z-50 like Modal's
      // overlay, so a portaled menu or tooltip (z-[60]) opened from inside still paints above it.
      className="ui-scrim anim-fade fixed inset-0 z-50 flex justify-center bg-[var(--ui-overlay-backdrop)] px-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="anim-pop h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        {/* Mounted per opening, so the query and the selection start over each time. */}
        <PaletteSearch
          actions={actions}
          placeholder={placeholder}
          emptyText={emptyText}
          onRun={run}
        />
        {hint !== undefined && (
          <div className="border-t border-line px-4 py-2 text-right text-xs text-fg-subtle">
            {hint}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The search box and the filtered list under it, with the keyboard selection. */
function PaletteSearch({
  actions,
  placeholder,
  emptyText,
  onRun,
}: {
  actions: readonly PaletteAction[];
  placeholder: string;
  emptyText: string;
  onRun: (action: PaletteAction) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const filtered = filterPaletteActions(actions, query);
  const sel = Math.min(selected, Math.max(filtered.length - 1, 0));

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setSelected((sel + delta + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[sel];
      if (action !== undefined) onRun(action);
    }
  };

  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={onInputKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none placeholder:text-fg-subtle"
      />
      {filtered.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="max-h-[40vh] overflow-y-auto py-1" role="listbox">
          {filtered.map((action, i) => (
            <li key={action.id} role="option" aria-selected={i === sel}>
              <button
                type="button"
                className={`w-full px-4 py-2 text-left text-sm text-fg ${
                  i === sel ? "bg-surface-muted" : ""
                }`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => onRun(action)}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
