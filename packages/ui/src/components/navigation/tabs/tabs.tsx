/**
 * The tab switcher (controlled): an underline tab bar that scrolls sideways on a narrow screen.
 *
 * The selected tab's marker is the theme's to draw: the bar carries the `ui-underline-nav` hook,
 * and the recipes select the tabs by `role="tab"` and `aria-selected`; in Primer the marker is the
 * tab's own bottom border.
 *
 * A tab may carry an update badge: a sentence saying what is updatable behind it. The dot itself
 * says nothing; the sentence is folded into the tab's tooltip and accessible name.
 */
import { UpdateDot } from "../../icons/update-dot/update-dot";

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  /**
   * Something updatable behind this tab: raises an update badge and folds this sentence into
   * the tab's tooltip and accessible name. Null or omitted: no badge.
   */
  badge?: string | null;
}

export function Tabs<K extends string>({
  items,
  active,
  onChange,
}: {
  items: ReadonlyArray<TabItem<K>>;
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div
      role="tablist"
      // overflow-y-hidden: only the horizontal axis scrolls; with overflow-x-auto alone some
      // browsers reserve a vertical scrollbar gutter.
      className="ui-underline-nav flex max-w-full gap-1 overflow-x-auto overflow-y-hidden border-b border-line"
    >
      {items.map((item) => {
        const badge = item.badge ?? null;
        const selected = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={selected}
            {...(badge !== null
              ? { "data-tooltip": badge, "aria-label": `${item.label} · ${badge}` }
              : {})}
            onClick={() => onChange(item.key)}
            className={`relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors duration-150 ${
              selected
                ? "border-fg font-semibold text-fg"
                : "border-transparent text-fg-muted hover:border-line-emphasis hover:text-fg"
            }`}
          >
            {item.label}
            {/* Inside the button's own padding, not hanging off its corner: the bar clips
                vertically (overflow-y-hidden above), so an overhanging dot would be cut. */}
            {badge !== null && <UpdateDot size="inline" position="right-1 top-1" />}
          </button>
        );
      })}
    </div>
  );
}
