/**
 * The multi-select skill panel body, shared by every surface that picks several skills at once:
 * the composer's skills dropdown and the Agent create dialog's two seed pickers. It owns the
 * search box, the scroll cap, the row chrome and the toggle semantics — clicking a row toggles it
 * and the panel stays open — so the hosts differ only in their trigger and in whether they offer
 * the bulk controls.
 *
 * A row is a Skill's metadata. The create dialog's library picker lists plugins, whose manifest
 * carries the same fields (name, descriptions, icon, version), so a plugin is a row too. A row's
 * icon is its plugin's — an installed skill carries the icon of the plugin it came from — and a
 * row without one draws its kind's glyph: the book, unless the host names another
 * (`fallbackIcon`, the puzzle piece for plugin rows).
 *
 * `onSelectAll` / `onSelectNone` render the bulk row, and both receive the names **currently
 * matching the search box**. With an empty query that is the whole list, which is the common
 * case; with a query typed, acting on the filtered set is the only reading that matches what the
 * user can see.
 */
import { useState } from "react";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import { ICON_SIZE, MenuItem, SearchInput } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { filterSkills, localizedShortText } from "../chat/skill-use";
import { SkillIcon } from "./skill-icon-view";

/** A bulk-row action: a plain text button, sized to sit inside the panel's chrome without competing with the rows. */
const bulkActionClass =
  "whitespace-nowrap rounded px-1 py-0.5 text-xs text-gray-500 transition-colors duration-150 " +
  "hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200";

/** One pickable row: a Skill's metadata, plus the glyph to draw when it carries no icon (the book when absent). */
export type PickableItem = SkillMetadataItem & { fallbackIcon?: string };

export function SkillPickList({
  skills,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  emptyHint,
  searchPlaceholder,
}: {
  skills: PickableItem[];
  /** Selected skill names. */
  selected: string[];
  onToggle: (name: string) => void;
  /** Given the names matching the current query; omit (with onSelectNone) to hide the bulk row. */
  onSelectAll?: (names: string[]) => void;
  onSelectNone?: (names: string[]) => void;
  /** Shown in place of the list when there is nothing to pick from at all. */
  emptyHint: string;
  /** The search box's placeholder and accessible name; "search skills" unless the rows are something else. */
  searchPlaceholder?: string;
}) {
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const filtered = filterSkills(skills, locale, query);
  const bulk = onSelectAll !== undefined && onSelectNone !== undefined;
  const searchLabel = searchPlaceholder ?? S.chat.skillsSearchPlaceholder;
  return (
    <>
      {/* Quick search: filters by skill name and localized description */}
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <SearchInput
          variant="menu"
          autoFocus
          value={query}
          onChange={setQuery}
          placeholder={searchLabel}
          aria-label={searchLabel}
        />
      </div>
      {bulk && skills.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1 dark:border-gray-800">
          <span className="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500">
            {S.skills.selectedCount(selected.length)}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={bulkActionClass}
              onClick={() => onSelectAll(filtered.map((s) => s.name))}
            >
              {S.skills.selectAll}
            </button>
            <button
              type="button"
              className={bulkActionClass}
              onClick={() => onSelectNone(filtered.map((s) => s.name))}
            >
              {S.skills.selectNone}
            </button>
          </span>
        </div>
      )}
      <div className="max-h-56 overflow-y-auto">
        {skills.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{emptyHint}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.chat.skillsNoMatch}</p>
        ) : (
          filtered.map((s) => {
            const on = selected.includes(s.name);
            return (
              <MenuItem
                key={s.name}
                density="sm"
                aria-pressed={on}
                checked={on}
                onSelect={() => onToggle(s.name)}
                // Each row's icon (icon.svg, sanitized and inlined), else the kind's glyph.
                glyph={
                  <SkillIcon
                    icon={s.icon}
                    fallback={s.fallbackIcon}
                    size={ICON_SIZE.inlineGlyph}
                    className="shrink-0 text-gray-400 dark:text-gray-500"
                  />
                }
                // The name, then the short description (falls back to the full description if
                // missing, per the UI language), muted, which gives way when the row runs out.
                label={
                  <>
                    <span className="font-mono">{s.name}</span>{" "}
                    <span className="text-gray-400 dark:text-gray-500">
                      {localizedShortText(locale, s)}
                    </span>
                  </>
                }
              />
            );
          })
        )}
      </div>
    </>
  );
}
