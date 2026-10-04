/**
 * The PR graph's search box, at the top of the graph while the search is open: Enter goes to the
 * next hit, Shift+Enter to the previous one, Esc closes it and clears the highlight. The count
 * ("3/12") is announced as it changes.
 */
import { CloseButton, ICON_GAP } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { GraphView } from "./use-graph-view";

export function GraphSearchBox({ search }: { search: GraphView["search"] }) {
  const t = S.company.proposals.graph.search;
  const count =
    search.query.trim() === ""
      ? ""
      : search.hits.length === 0
        ? t.none
        : t.count(search.index + 1, search.hits.length);
  return (
    <div role="search" className={`flex items-center ${ICON_GAP.row} text-xs`}>
      <input
        ref={search.inputRef}
        type="search"
        aria-label={t.label}
        placeholder={t.placeholder}
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            search.step(e.shiftKey);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            search.close();
          }
        }}
        className="w-72 max-w-full rounded-md border border-line bg-surface px-2 py-1 text-xs"
      />
      <span aria-live="polite" className="min-w-12 text-fg-subtle tabular-nums">
        {count}
      </span>
      <CloseButton onClose={search.close} label={t.close} />
    </div>
  );
}
