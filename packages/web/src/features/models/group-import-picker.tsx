/**
 * The add-group import's pick list: the models an endpoint serves, one id per row with a
 * checkbox, so only the ticked ones are imported. It sits in the dialog's body under the
 * endpoint fields; the dialog owns the ticks and commits them with its Import button, so a tick
 * here writes nothing.
 *
 * Above the rows: the title, how many are ticked out of how many listed, and Select all /
 * Select none. A long listing adds a filter box (by id, case-insensitive), and the two bulk
 * actions act on the rows the filter leaves on screen — with a query typed, that is the only
 * reading that matches what the user sees. Filtering never changes a tick: a row it hides keeps
 * its state, and the count and the Import button go on counting it.
 *
 * The rows scroll inside their own capped box, ruled above and below, so a listing of hundreds
 * keeps the fields above it and the dialog's footer where they are. A row is one line: an id
 * too long for it is cut, and shows whole on hover through the app's tooltip layer.
 */
import { useId, useState } from "react";
import { Button, Checkbox, FieldLabel, SearchInput } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** From this many listed models on, a filter box stands above the rows. */
const FILTER_FROM = 11;

export function ImportPickList({
  ids,
  picked,
  onChange,
  disabled,
}: {
  /** The ids on offer, in the endpoint's order (see pickableModelIds). */
  ids: readonly string[];
  /** The ticked ids. */
  picked: ReadonlySet<string>;
  /** Every change, as the whole new set of ticked ids. */
  onChange: (picked: Set<string>) => void;
  /** While the import runs: nothing can be ticked or unticked. */
  disabled: boolean;
}) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? ids : ids.filter((id) => id.toLowerCase().includes(needle));

  const setShown = (on: boolean) => {
    const next = new Set(picked);
    for (const id of shown) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  const setOne = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span id={titleId} className="flex min-w-0 items-baseline gap-2">
          <FieldLabel block={false}>{S.models.groupImportPickTitle}</FieldLabel>
          <span className="text-xs text-fg-muted">
            {S.models.groupImportPickCount(picked.size, ids.length)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Button
            variant="link"
            size="sm"
            disabled={disabled || shown.length === 0}
            onClick={() => setShown(true)}
          >
            {S.models.groupImportSelectAll}
          </Button>
          <Button
            variant="link"
            size="sm"
            disabled={disabled || shown.length === 0}
            onClick={() => setShown(false)}
          >
            {S.models.groupImportSelectNone}
          </Button>
        </span>
      </div>
      {ids.length >= FILTER_FROM && (
        <SearchInput
          size="sm"
          icon
          value={query}
          onChange={setQuery}
          placeholder={S.models.groupImportFilter}
          aria-label={S.models.groupImportFilter}
        />
      )}
      {shown.length === 0 ? (
        <p className="py-1.5 text-xs text-fg-muted">{S.models.noSearchResults}</p>
      ) : (
        <ul
          aria-labelledby={titleId}
          className="max-h-64 divide-y divide-line-muted overflow-y-auto border-y border-line-muted"
        >
          {shown.map((id) => (
            <li key={id} className="transition-colors hover:bg-surface-muted">
              <Checkbox
                size="sm"
                checked={picked.has(id)}
                disabled={disabled}
                onChange={(on) => setOne(id, on)}
                label={<span className="block truncate font-mono">{id}</span>}
                className="w-full px-2 py-1.5"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
