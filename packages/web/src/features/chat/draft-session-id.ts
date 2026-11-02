/**
 * The route segment a not-yet-created conversation sits under.
 *
 * A chat that has been opened but never sent is a draft: it has a place in the URL so a
 * reload lands back on it, and no session behind it yet. The literal lives here rather
 * than in chat-page because the shell needs it too — the sidebar links a new chat, and the
 * layout reads it to decide whether to keep a dock alive. A static import of chat-page for
 * one string pulled the whole chat surface (stream controller, markdown, workspace browser)
 * into the entry chunk; measured at 351 KB of source, a third of what a first paint has to
 * download on a link measured in hundreds of KB per second.
 */
export const DRAFT_SESSION_ID = "new";
