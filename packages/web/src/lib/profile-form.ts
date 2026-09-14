/**
 * The Profile page's write rules, kept out of the component so a test can reach them.
 *
 * Every control on that page performs a write when it is used — choosing an image applies it,
 * and the nickname's Save and Restore default each send a patch of their own — so what has to
 * be checkable is WHICH value each one would store and WHEN it is live. This package's vitest
 * runs in Node with no DOM (the same reason `settings-sections.ts` holds the dialog's
 * visibility rules rather than the dialog), so the rules live here rather than inside the JSX.
 */
import type { UserInfo } from "@prismshadow/penguin-server/api";

/** What the nickname row's two buttons would do, given the stored profile and the typed text. */
export interface ProfileControls {
  /**
   * What Save writes: the trimmed text, or `null` for a blank box — the route spells "no
   * nickname" as `null`, and trimming here is what makes the comparison below see the value
   * that would actually be stored.
   */
  nicknameToStore: string | null;
  /** Live only when that differs from what is stored: re-saving the stored value is not a save. */
  canSaveNickname: boolean;
  /**
   * Live only when a nickname is stored. With none stored the default is already in force —
   * every surface falls back to the user id — so the button would write `null` over `null`.
   */
  canRestoreNickname: boolean;
  /** The same rule for the avatar: with none stored, the letter tile is already what is drawn. */
  canRestoreAvatar: boolean;
}

export function profileControls(user: UserInfo, typedNickname: string): ProfileControls {
  const trimmed = typedNickname.trim();
  const nicknameToStore = trimmed === "" ? null : trimmed;
  return {
    nicknameToStore,
    canSaveNickname: (nicknameToStore ?? "") !== (user.displayName ?? ""),
    canRestoreNickname: user.displayName !== undefined,
    canRestoreAvatar: user.avatar !== undefined,
  };
}
