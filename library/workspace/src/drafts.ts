/**
 * The account's drafts vocabulary: the draft key kinds, the caps a patch and one draft's
 * value are held to, and the draft screen's user-defined shortcut shape. Moved from the
 * server's api/types.ts so the drafts service beside it (user-drafts.ts, draft-shortcuts.ts)
 * speaks the same module, and the Web App keeps reading the shapes through the server's
 * `./api` re-exports.
 */

/**
 * The kinds of draft the account keeps, as the first segment of a draft key
 * (`<kind>:<id>`). The id names what the draft belongs to, so the server can drop it with that
 * thing: `chat` — a Project's new-conversation draft (`chat:<projectId>`); `parked` — a
 * Project's parked draft conversations (`parked:<projectId>`); `org` — a Project's
 * create-organization form (`org:<projectId>`); `channel` — a company-mode channel's composer
 * (`channel:<projectId>.<orgId>.<channelId>`); `session` — a Session's composer
 * (`session:<sessionId>`); `a2ui` — a reply's form answers in progress
 * (`a2ui:<sessionId>:<block>`).
 */
export const DRAFT_KINDS = ["chat", "parked", "org", "channel", "session", "a2ui"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** One draft's cap, in characters of its JSON text. */
export const DRAFT_VALUE_MAX_CHARS = 256 * 1024;

/** Draft writes one PATCH may carry. */
export const DRAFTS_PATCH_MAX_ENTRIES = 50;

/**
 * One draft-screen shortcut: a prompt the user wrote, filed under a name they chose. Clicking it
 * fills the composer exactly like a built-in example does, and sends nothing. Deliberately holds
 * no Skill list — a saved prompt is not authored against a known Skill catalog the way a shipped
 * example is, and the Agent it will run under is picked after the click.
 */
export interface DraftShortcut {
  /** Stable client-generated id: what an edit or a delete addresses the row by. Unique per user. */
  id: string;
  title: string;
  prompt: string;
}
