/**
 * The update dots of the system apps (06 「角标」, PRFC-0033). A trail that ends on a system app's
 * page (a plugin update on Plugins, new presets on Models, unexpected errors on the Cost Center)
 * has no nav row of its own any more: its dot sits on the App Center's nav entry, then on the
 * app's tile, then on the page's notice, which is where it is cleared. The entry's hint joins the
 * apps' sentences; each tile says its own. Nothing here names the apps: a system app whose path
 * is a trail's route (use-update-badges.ts) carries that trail's sentence.
 */
import { S } from "./strings";
import { useSystemApps, type SystemApp } from "./system-apps";
import { navNoteFor, useUpdateBadges, type UpdateBadges } from "./use-update-badges";

/** Each system app's sentence by its key, in the apps' order; an app with nothing waiting is absent. */
export function systemAppNotesOf(
  badges: UpdateBadges,
  apps: readonly SystemApp[],
): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const app of apps) {
    const note = navNoteFor(badges, app.path);
    if (note !== null) notes.set(app.key, note);
  }
  return notes;
}

/** What one dot covering several apps says: their sentences joined, or null when none waits. */
export function joinedNote(notes: Iterable<string>): string | null {
  const parts = [...notes];
  return parts.length === 0 ? null : S.todo.joined(parts);
}

/** The system apps' sentences for the signed-in viewer (passive: the badges' owner fetches). */
export function useSystemAppNotes(): ReadonlyMap<string, string> {
  return systemAppNotesOf(useUpdateBadges(), useSystemApps());
}
