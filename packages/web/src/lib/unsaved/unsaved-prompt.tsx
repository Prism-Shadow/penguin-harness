/**
 * The app's copy for the shared UI package's `UnsavedChangesHost`: the one prompt every way of
 * leaving a form with unsaved edits shows, and the unload guard while one is dirty. A component
 * of its own so the dictionary is read during its own render — `S` is swapped on a language
 * switch, and props built in a parent that does not re-render would keep the old words.
 */
import { UnsavedChangesHost } from "@prismshadow/penguin-ui";
import { S } from "../strings";

export function UnsavedPrompt() {
  return (
    <UnsavedChangesHost
      title={S.common.discardTitle}
      body={S.common.discardBody}
      discardLabel={S.common.discard}
      keepLabel={S.common.keepEditing}
    />
  );
}
