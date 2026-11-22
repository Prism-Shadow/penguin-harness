/**
 * A review list: what is about to be removed, laid out to be checked before anything goes — the
 * folders a cleanup would delete, the conversations picked for deletion. The caller acts on the
 * choice (and counts it in its own footer); the list only shows it and changes it.
 *
 * - Groups (`groups`), each with a header: its name, how many items and their size together (the
 *   caller's words, `total`), and Select all, which chooses every item of the group that can be
 *   chosen — Deselect all once all of those are. Under the header a muted line may say what
 *   removing the group's items does (`note`). A group with no items is not drawn.
 * - One line per item: its box, its title (cut off when long, whole on hover), marks right after
 *   the title (`trail`: a state pill, a running mark), a muted meta (where it lives), its time and
 *   its size, right-aligned so the sizes read as a column. The whole line toggles the box.
 * - An item that cannot be chosen (`disabled`) keeps its line, its box disabled; hovering the box
 *   says why (`disabledReason`). Select all passes it by, and it is never in the choice the list
 *   hands back.
 *
 * The choice is the caller's (`selected`, by item key), and every change comes back whole through
 * `onChange`. Every word — the counts, Select all, a box's name — is the caller's (`labels`).
 */
import type { ReactNode } from "react";
import { Checkbox } from "../../forms/checkbox/checkbox";

/** One thing the review may remove. */
export interface ReviewItem {
  /** Names the item in the choice. */
  key: string;
  title: string;
  /** Marks right after the title: a state pill, a running mark. */
  trail?: ReactNode;
  /** Muted words after the title: where the item lives ("Project › Agent"). */
  meta?: string;
  /** When it was last used, as the caller prints it ("3 days ago"). */
  time?: string;
  /** The exact time behind a relative `time`, on hover. */
  timeTitle?: string;
  /** Its size as the caller prints it ("1.2 GB"). */
  value: string;
  /** It cannot be chosen: its box is disabled, and Select all passes it by. */
  disabled?: boolean;
  /** Why it cannot be chosen, on its box's hover. */
  disabledReason?: string;
}

/** A run of items under one header. */
export interface ReviewGroup {
  key: string;
  label: string;
  /** One muted line under the header: what removing these items does. */
  note?: string;
  /** The group's size together, as the caller prints it. */
  total?: string;
  items: readonly ReviewItem[];
}

/** The list's words. */
export interface ReviewListLabels {
  selectAll: string;
  deselectAll: string;
  /** A group's count beside its name ("3 items"). */
  count: (n: number) => string;
  /** An item's box, named by the item's title. */
  select: (title: string) => string;
}

/** The keys of a group's items that can be chosen. */
const choosable = (group: ReviewGroup): string[] =>
  group.items.flatMap((item) => (item.disabled === true ? [] : [item.key]));

/** Whether every item of the group that can be chosen is chosen (false when none can be). */
export function reviewGroupChosen(group: ReviewGroup, selected: ReadonlySet<string>): boolean {
  const keys = choosable(group);
  return keys.length > 0 && keys.every((key) => selected.has(key));
}

/**
 * Select all on a group, or Deselect all once all of it is chosen: the new choice, with the other
 * groups' items left as they were and no disabled item in it.
 */
export function toggleReviewGroup(group: ReviewGroup, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const all = reviewGroupChosen(group, selected);
  for (const key of choosable(group)) {
    if (all) next.delete(key);
    else next.add(key);
  }
  return next;
}

export function ReviewList({
  groups,
  selected,
  onChange,
  labels,
  className = "",
}: {
  groups: readonly ReviewGroup[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  labels: ReviewListLabels;
  /** Layout only (a margin). */
  className?: string;
}) {
  const toggle = (item: ReviewItem) => {
    if (item.disabled === true) return;
    const next = new Set(selected);
    if (next.has(item.key)) next.delete(item.key);
    else next.add(item.key);
    onChange(next);
  };
  return (
    <div className={`space-y-6 ${className}`}>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => {
          const all = reviewGroupChosen(group, selected);
          const canChoose = choosable(group).length > 0;
          return (
            <section key={group.key} className="min-w-0">
              <div className="flex items-center gap-2 pb-1.5">
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{group.label}</h3>
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                  {labels.count(group.items.length)}
                </span>
                {group.total !== undefined && (
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">{group.total}</span>
                )}
                {canChoose && (
                  <button
                    type="button"
                    onClick={() => onChange(toggleReviewGroup(group, selected))}
                    className="shrink-0 whitespace-nowrap text-xs text-fg-muted transition-colors duration-150 hover:text-fg"
                  >
                    {all ? labels.deselectAll : labels.selectAll}
                  </button>
                )}
              </div>
              {group.note !== undefined && (
                <p className="pb-2 text-xs text-fg-muted">{group.note}</p>
              )}
              <ul className="divide-y divide-line-muted border-t border-line-muted">
                {group.items.map((item) => (
                  <ReviewRow
                    key={item.key}
                    item={item}
                    chosen={item.disabled !== true && selected.has(item.key)}
                    label={labels.select(item.title)}
                    onToggle={() => toggle(item)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

function ReviewRow({
  item,
  chosen,
  label,
  onToggle,
}: {
  item: ReviewItem;
  chosen: boolean;
  label: string;
  onToggle: () => void;
}) {
  const disabled = item.disabled === true;
  const reason = disabled ? item.disabledReason : undefined;
  return (
    <li>
      {/* The line is the box's label, so a press anywhere on it toggles the box. */}
      <label className="flex min-w-0 items-center gap-3 py-2">
        {/* A disabled box hears no pointer, so its reason hangs on the box's own wrapper. */}
        <span
          className="inline-flex shrink-0"
          {...(reason !== undefined ? { "data-tooltip": reason, "data-tooltip-extra": true } : {})}
        >
          <Checkbox
            checked={chosen}
            disabled={disabled}
            onChange={onToggle}
            aria-label={label}
            className={disabled ? "[&_input]:pointer-events-none" : ""}
          />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <span className={`min-w-0 truncate ${disabled ? "text-fg-muted" : "text-fg"}`}>
            {item.title}
          </span>
          {item.trail}
        </span>
        {item.meta !== undefined && (
          <span className="min-w-0 max-w-[40%] truncate text-xs text-fg-muted">{item.meta}</span>
        )}
        {item.time !== undefined && (
          // A fixed width, so the places before it line up down the list whatever each time reads.
          <span
            className="w-16 shrink-0 whitespace-nowrap text-right text-xs text-fg-muted"
            {...(item.timeTitle !== undefined
              ? { "data-tooltip": item.timeTitle, "data-tooltip-extra": true }
              : {})}
          >
            {item.time}
          </span>
        )}
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg">{item.value}</span>
      </label>
    </li>
  );
}
