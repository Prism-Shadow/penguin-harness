/**
 * The multi-select skill panel body, shared by every surface that picks several skills at once:
 * the composer's skills dropdown and the Agent create dialog's seed picker. It owns the search
 * box, the scroll cap, the row chrome and the toggle semantics — clicking a row toggles it and
 * the panel stays open — so the two hosts differ only in their trigger and in whether they offer
 * the bulk controls.
 *
 * `onSelectAll` / `onSelectNone` render the bulk row, and both receive the names **currently
 * matching the search box**. With an empty query that is the whole list, which is the common
 * case; with a query typed, acting on the filtered set is the only reading that matches what the
 * user can see.
 */
import { useState } from "react";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { ICON_SIZE } from "../../lib/icon-scale";
import { noAutofill } from "../../components/ui/input";
import { filterSkills, localizedShortText } from "../chat/skill-use";
import { SkillIcon } from "./skill-icon-view";

/** A bulk-row action: a plain text button, sized to sit inside the panel's chrome without competing with the rows. */
const bulkActionClass =
  "rounded px-1 py-0.5 text-xs text-gray-500 transition-colors duration-150 " +
  "hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200";

export function SkillPickList({
  skills,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  emptyHint,
}: {
  skills: SkillMetadataItem[];
  /** Selected skill names. */
  selected: string[];
  onToggle: (name: string) => void;
  /** Given the names matching the current query; omit (with onSelectNone) to hide the bulk row. */
  onSelectAll?: (names: string[]) => void;
  onSelectNone?: (names: string[]) => void;
  /** Shown in place of the list when there is nothing to pick from at all. */
  emptyHint: string;
}) {
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const filtered = filterSkills(skills, locale, query);
  const bulk = onSelectAll !== undefined && onSelectNone !== undefined;
  return (
    <>
      {/* Quick search: filters by skill name and localized description */}
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={S.chat.skillsSearchPlaceholder}
          aria-label={S.chat.skillsSearchPlaceholder}
          {...noAutofill}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
        />
      </div>
      {bulk && skills.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1 dark:border-gray-800">
          <span className="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500">
            {S.skills.selectedCount(selected.length)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
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
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(s.name)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  on
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              >
                {/* Each skill's custom icon (icon.svg, sanitized and inlined; falls back to the book icon if missing). */}
                <SkillIcon
                  icon={s.icon}
                  size={ICON_SIZE.inlineGlyph}
                  className="shrink-0 text-gray-400 dark:text-gray-500"
                />
                <span className="shrink-0 font-mono">{s.name}</span>
                {/* Prefers the short description (falls back to the full description if missing), per the UI language. */}
                <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">
                  {localizedShortText(locale, s)}
                </span>
                <span className="w-3 shrink-0 text-center">{on ? "✓" : ""}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
