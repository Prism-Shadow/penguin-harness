/**
 * The canned suggestions of the scheduled-tasks surfaces: four everyday schedules — a daily
 * brief, a weekly review, a follow-up reminder, an update monitor — each with a glyph, a
 * schedule hint and a one-line description, and two phrasings of its prompt: one for the
 * conversation on screen (the dock panel sends into the current Session) and one for an
 * agent as a whole (the settings tab opens a new Session). Picking one opens the AI creation
 * dialog with that prompt filled in, and the same rows are the dialog's clickable examples.
 */
import { GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { AiExample } from "../ai-create";

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

/** The rising sun is the daily brief, the bell a follow-up reminder, the pulse an update monitor. */
const SUGGESTION_ICONS: Record<ScheduleSuggestionKey, string> = {
  dailyBrief: ICONS.sunrise,
  weeklyReview: ICONS.calendar,
  followUp: ICONS.bell,
  monitor: ICONS.pulse,
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
      icon: SUGGESTION_ICONS[key],
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
      <ul className="space-y-1">
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
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
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
