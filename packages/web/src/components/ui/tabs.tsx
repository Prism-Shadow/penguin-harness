/**
 * Tab switcher component (controlled): GitHub-style underline; scrolls
 * horizontally on narrow screens.
 */
import { UpdateDot } from "./update-dot";

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  /**
   * Something updatable behind this tab: raises an update badge and folds this sentence into
   * the tab's tooltip and accessible name (the dot itself carries nothing). Null / omitted =
   * no badge.
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
      // overflow-y-hidden: only allow horizontal scroll on narrow screens, otherwise some browsers reserve a vertical scrollbar gutter for overflow-x-auto.
      className="flex max-w-full gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 dark:border-gray-800"
    >
      {items.map((item) => {
        const badge = item.badge ?? null;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === active}
            {...(badge !== null ? { title: badge, "aria-label": `${item.label} · ${badge}` } : {})}
            onClick={() => onChange(item.key)}
            className={`relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors duration-150 ${
              item.key === active
                ? "border-gray-900 font-semibold text-gray-900 dark:border-gray-100 dark:text-gray-100"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {item.label}
            {/* Inside the button's own padding, not hanging off its corner: the strip clips
                vertically (overflow-y-hidden above), so an overhanging dot would be cut. */}
            {badge !== null && <UpdateDot size="inline" position="right-1 top-1" />}
          </button>
        );
      })}
    </div>
  );
}
