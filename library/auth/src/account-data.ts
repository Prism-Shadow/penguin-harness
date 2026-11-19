/**
 * The account-data mechanisms: what a user keeps on the server that is too large or too many for
 * the free-form ui_prefs document — unsent drafts, and the custom background image.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** One stored draft, as the drafts routes read it back. */
export interface StoredDraft {
  key: string;
  valueJson: string;
}

/** One draft write: the value to keep, or null to remove the key. */
export interface DraftWrite {
  key: string;
  /** The draft's JSON text; null removes it. */
  valueJson: string | null;
  /** The Session the key names, so the draft goes with it; null when it names none. */
  sessionId: string | null;
  /** The Project the key names, so the draft goes with it; null when it names none. */
  projectId: string | null;
}

/** UserDraftsStore: the mechanism UserDraftsRepo implements. */
@Interface()
export abstract class UserDraftsStore {
  abstract list(userId: string): StoredDraft[];
  /**
   * Applies the writes together, then drops the user's least recently written drafts outside
   * them until the user holds at most `maxCount` drafts of at most `maxChars` characters in all.
   */
  abstract apply(
    userId: string,
    writes: readonly DraftWrite[],
    bounds: { maxCount: number; maxChars: number },
  ): void;
  /** Every user's drafts of one Session (the Session is being deleted). */
  abstract deleteBySession(sessionId: string): void;
  /** Every user's drafts of one Project and of the Sessions indexed under it (the Project is being deleted). */
  abstract deleteByProject(projectId: string): void;
  /** Every user's drafts of the Sessions indexed under one Agent (the Agent is being deleted). */
  abstract deleteByAgent(projectId: string, agentId: string): void;
}

/** A user's stored background image. */
export interface StoredBackgroundImage {
  image: string;
  imageId: string;
}

/** BackgroundImageStore: the mechanism BackgroundImagesRepo implements. */
@Interface()
export abstract class BackgroundImageStore {
  abstract get(userId: string): StoredBackgroundImage | null;
  abstract set(userId: string, image: StoredBackgroundImage): void;
  abstract clear(userId: string): void;
}
