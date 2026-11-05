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
 */
import type { HTMLAttributes, ReactNode } from "react";
import { SkeletonList } from "../../feedback/skeleton/skeleton";
import { SearchInput } from "../../forms/search-input/search-input";

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
  return (
    <div {...rest} className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {/* Esc in a non-empty box clears it rather than reaching the dock or a dialog above, which
          is what that key means here (SearchInput). */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line-muted px-2 py-1.5">
        <SearchInput
          variant="panel"
          className="min-w-0 flex-1"
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          aria-label={search.placeholder}
          clearLabel={search.clearLabel}
        />
        {actions}
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
