/**
 * TreePane: the Files panel's left-hand column — the file tree under a header holding its search
 * box and the panel's own actions (refresh, upload). The actions are the caller's: they belong to
 * the panel rather than to any one file, which is why they sit here and not on the path row,
 * where everything names the open file.
 *
 * The body is the first of: the listing's failure, a skeleton while the first listing is on its
 * way, a waiting line (a search whose answer has not arrived — an empty tree there would read as
 * "nothing matches", the one answer that must not be guessed), and otherwise the tree itself with
 * an optional footnote under it (a search that was cut short).
 *
 * The pane takes the caller's handlers on its root (`...rest`): the tree's context menu hangs off
 * the whole pane and resolves the row under the pointer itself, so a gesture between rows — the
 * search box, the space below the last row — reaches nothing and the browser's own menu stands.
 * `menu` is that menu's portal, drawn in every state.
 *
 * The header measures the room its search box would get. Below {@link SEARCH_MIN_WIDTH} a box
 * would clip its own placeholder to a few letters, so it folds into a magnifier beside the
 * actions instead. A click opens the box across the whole row (the actions keep their place but
 * are hidden under it, so the measured room, and with it the fold, stays put). An empty box folds
 * back on Escape, on its ×, or when focus leaves it; a box holding a query stays open, because a
 * filter in force must stay on screen or the tree would look wrong. Escape and × clear it and fold
 * it back, and both hand focus to the magnifier.
 */
import { useEffect, useRef, useState } from "react";
import type { FocusEvent, HTMLAttributes, ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { SkeletonList } from "../../feedback/skeleton/skeleton";
import { SearchInput } from "../../forms/search-input/search-input";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useMeasuredWidth } from "../../layout/measure/use-measured-width";
import { filesActionClass } from "../files-frame/files-frame";

/** The narrowest search box, in px, that still shows its placeholder whole. */
const SEARCH_MIN_WIDTH = 140;

export interface TreePaneSearch {
  value: string;
  onChange: (value: string) => void;
  /** The box's placeholder, which is also its accessible name. */
  placeholder: string;
  /** The clear button's name; the interface's "Clear search" by default. */
  clearLabel?: string;
}

export interface TreePaneProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  search: TreePaneSearch;
  /** The header's actions, after the search box. */
  actions?: ReactNode;
  /** The listing failed: said in place of the tree. */
  error?: string | null;
  /** The first listing is on its way. */
  loading?: boolean;
  /** Waiting for an answer that decides what the tree shows: said in place of it. */
  pending?: string | null;
  /** Small print under the tree. */
  note?: string | null;
  /** The context menu's portal. */
  menu?: ReactNode;
  /** The tree. */
  children?: ReactNode;
}

export function TreePane({
  search,
  actions,
  error = null,
  loading = false,
  pending = null,
  note = null,
  menu,
  children,
  className = "",
  ...rest
}: TreePaneProps) {
  const slot = useRef<HTMLDivElement>(null);
  const magnifier = useRef<HTMLButtonElement>(null);
  const room = useMeasuredWidth(slot);
  // 0 is "not measured yet": the box stands until a width says otherwise.
  const folded = room > 0 && room < SEARCH_MIN_WIDTH;
  const [opened, setOpened] = useState(false);
  // An opening belongs to the fold it was made in: once the box has its room back it is no longer
  // open-by-click, and a later fold starts from the magnifier.
  if (opened && !folded) setOpened(false);
  const spread = folded && (opened || search.value !== "");
  const refocus = useRef(false);
  useEffect(() => {
    if (spread || !refocus.current) return;
    refocus.current = false;
    magnifier.current?.focus();
  }, [spread]);
  const fold = (returnFocus: boolean) => {
    if (returnFocus) refocus.current = true;
    setOpened(false);
  };
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (search.value === "" && !event.currentTarget.contains(event.relatedTarget as Node | null))
      fold(false);
  };
  return (
    <div {...rest} className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {/* Esc in a non-empty box clears it rather than reaching the dock or a dialog above, which
          is what that key means here (SearchInput); in the folded box it also folds it back. */}
      <div className="relative flex shrink-0 items-center gap-1 border-b border-line-muted px-2 py-1.5">
        {/* The box's room, whatever stands in it: `flex-1` over a zero basis measures the row
            less the actions, never its own content. */}
        <div ref={slot} className="flex min-w-0 flex-1 justify-end">
          {folded && (
            <button
              ref={magnifier}
              type="button"
              aria-label={search.placeholder}
              data-tooltip={search.placeholder}
              onClick={() => setOpened(true)}
              className={`${filesActionClass} ${spread ? "invisible" : ""}`}
            >
              <GlyphIcon d={ICONS.search} size={ICON_SIZE.iconButton} />
            </button>
          )}
          {(!folded || spread) && (
            <div
              className={
                folded ? "absolute inset-x-2 inset-y-0 flex items-center" : "flex min-w-0 flex-1"
              }
              onBlur={folded ? leave : undefined}
            >
              <SearchInput
                variant="panel"
                className="min-w-0 flex-1"
                value={search.value}
                onChange={search.onChange}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                clearLabel={search.clearLabel}
                autoFocus={folded}
                alwaysClearable={folded}
                onClear={
                  folded
                    ? () => {
                        search.onChange("");
                        fold(true);
                      }
                    : undefined
                }
              />
            </div>
          )}
        </div>
        {actions !== undefined && actions !== null && (
          <div className={`flex shrink-0 items-center gap-1 ${spread ? "invisible" : ""}`}>
            {actions}
          </div>
        )}
      </div>
      {error !== null ? (
        <p className="px-3 py-3 text-sm text-tone-danger-fg">{error}</p>
      ) : loading ? (
        <SkeletonList rows={6} />
      ) : pending !== null ? (
        <p className="px-3 py-3 text-xs text-fg-subtle">{pending}</p>
      ) : (
        <>
          {children}
          {note !== null && (
            <p className="shrink-0 border-t border-line-muted px-3 py-1.5 text-xs text-fg-subtle">
              {note}
            </p>
          )}
        </>
      )}
      {menu}
    </div>
  );
}
