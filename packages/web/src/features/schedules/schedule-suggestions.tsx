/**
 * The canned suggestions of the scheduled-tasks surfaces: four everyday schedules — a daily
 * brief, a weekly review, a follow-up reminder, an update monitor — each with a glyph, a
 * schedule hint and a one-line description, and two phrasings of its prompt: one for the
 * conversation on screen (the dock panel sends into the current Session) and one for an
 * agent as a whole (the settings tab opens a new Session). Picking one opens the AI creation
 * dialog with that prompt filled in, and the same rows are the dialog's clickable examples.
 */
import { S } from "../../lib/strings";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CALENDAR_ICON } from "../../components/ui/group-list";
import type { AiExample } from "../ai-create";

/** Sunrise (a half sun over the horizon, rays out): the daily brief. */
const SUNRISE_ICON =
  "M12 2v3M4.9 5.9l2.1 2.1M2 13h3M19 13h3M17 8l2.1-2.1M6 18a6 6 0 0 1 12 0M2 22h20";
/** Bell (lucide bell): the follow-up reminder. */
const BELL_ICON = "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";
/** Activity pulse (lucide activity): the update monitor. */
const ACTIVITY_ICON = "M22 12h-4l-3 9L9 3l-3 9H2";

export type ScheduleSuggestionKey = "dailyBrief" | "weeklyReview" | "followUp" | "monitor";

/** Which phrasing of the prompt a surface uses (see the module header). */
export type SuggestionMode = "session" | "agent";

export interface ScheduleSuggestion {
  key: ScheduleSuggestionKey;
  icon: string;
  name: string;
  hint: string;
  description: string;
  prompt: string;
}

const ICONS: Record<ScheduleSuggestionKey, string> = {
  dailyBrief: SUNRISE_ICON,
  weeklyReview: CALENDAR_ICON,
  followUp: BELL_ICON,
  monitor: ACTIVITY_ICON,
};

const ORDER: readonly ScheduleSuggestionKey[] = [
  "dailyBrief",
  "weeklyReview",
  "followUp",
  "monitor",
];

/** The suggestions in display order, worded by the active dictionary (read at call time). */
export function scheduleSuggestions(mode: SuggestionMode): ScheduleSuggestion[] {
  return ORDER.map((key) => {
    const s = S.schedule.suggestions[key];
    return {
      key,
      icon: ICONS[key],
      name: s.name,
      hint: s.hint,
      description: s.description,
      prompt: mode === "session" ? s.prompt : s.agentPrompt,
    };
  });
}

/** The same rows as the AI dialog's clickable examples: the name, the schedule hint under it, the prompt it fills in. */
export function scheduleExamples(mode: SuggestionMode): AiExample[] {
  return scheduleSuggestions(mode).map((s) => ({
    key: s.key,
    label: s.name,
    description: s.hint,
    prompt: s.prompt,
  }));
}

/** The suggestions list: glyph, name with the schedule hint beside it, the description under. */
export function ScheduleSuggestions({
  mode,
  onPick,
}: {
  mode: SuggestionMode;
  onPick: (prompt: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        {S.schedule.suggestionsTitle}
      </div>
      <ul className="space-y-0.5">
        {scheduleSuggestions(mode).map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onPick(s.prompt)}
              className={`flex w-full items-start ${ICON_GAP.menu} rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
            >
              <span className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500">
                <GlyphIcon d={s.icon} size={ICON_SIZE.rowLead} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-sm text-gray-800 dark:text-gray-100">
                    {s.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                    {s.hint}
                  </span>
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {s.description}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
