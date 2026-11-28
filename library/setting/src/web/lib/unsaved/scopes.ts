/**
 * The unsaved-changes scopes the app names (see the shared UI package's `unsaved-changes.ts`). A
 * scope groups the forms one leave abandons together; a record dialog needs none of these, since
 * `useFormDraft` gives every form a scope of its own unless it is handed one.
 */

/** Every page of the Settings dialog: its rail switch and its close ask about these forms. */
export const SETTINGS_SCOPE = "settings";
