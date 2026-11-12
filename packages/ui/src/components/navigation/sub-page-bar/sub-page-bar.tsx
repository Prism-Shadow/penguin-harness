/**
 * The second tier under a tab: the tab's sub-pages as one segmented switch, and the current
 * sub-page's own controls — a search box, an import button — at the row's end.
 *
 * The switch is a named group of pressed-or-not buttons (`Segmented`), its name saying what it
 * switches between; the active sub-page is the pressed one. It spans the row on a phone and takes
 * a fixed width from `sm` up, so the labels never move whichever is active. The row is rendered in
 * every state of the page — loading, empty, populated — and with the same controls, so nothing in
 * it shifts when an answer lands. On a narrow screen the controls wrap under the switch.
 *
 * Props only: the labels and the controls are the caller's, and so is where the active sub-page
 * is kept (an address, a state).
 */
import type { ReactNode } from "react";
import { Segmented } from "../../forms/segmented/segmented";

export interface SubPageBarProps<K extends string> {
  /** The switch's accessible name ("Plugin sub-pages"). */
  label: string;
  /** Two to five sub-pages (the segmented control's range). */
  items: ReadonlyArray<{ key: K; label: string }>;
  active: K;
  onChange: (key: K) => void;
  /** The current sub-page's controls: a search box, an import button. They wrap under the switch on a narrow screen. */
  actions?: ReactNode;
}

/** The segmented control's column counts. */
const columns = (n: number): 2 | 3 | 4 | 5 => (n <= 2 ? 2 : n >= 5 ? 5 : (n as 3 | 4));

export function SubPageBar<K extends string>({
  label,
  items,
  active,
  onChange,
  actions,
}: SubPageBarProps<K>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label={label} className="w-full sm:w-80">
        <Segmented
          options={items.map((item) => ({ value: item.key, label: item.label }))}
          value={active}
          onChange={onChange}
          cols={columns(items.length)}
        />
      </div>
      {actions !== undefined && actions !== null && actions !== false && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
