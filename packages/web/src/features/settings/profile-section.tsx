/**
 * Profile page of System settings: the avatar and nickname the account shows itself by.
 *
 * Unlike the Account page beside it, this one exists in every session — the desktop shell's
 * own token window included, which for a desktop install is the only session there is. A
 * profile is display data, so there is no old password for the server to check.
 *
 * One Save button for the page, like the Upload limits page: the avatar and the nickname are
 * two halves of one identity and a picked image that saved itself before the name was typed
 * would commit half of an edit. The picked file is turned into its stored form (cropped,
 * scaled, encoded — see lib/avatar-image.ts) at pick time so the preview shows exactly what
 * Save will send, but nothing leaves the browser until Save.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { avatarDataUrlFromFile } from "../../lib/avatar-image";
import { useAuth } from "../../state/auth";
import { Button, labelButtonClass } from "../../components/ui/button";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { Input } from "../../components/ui/input";
import { UserAvatar, USER_AVATAR_SIZE } from "../../components/ui/user-avatar";
import { toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";
import { PrefRow } from "./setting-row";

/** What the picker offers — the three formats the server stores, spelled the way `accept` wants. */
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

const CHANGE_AVATAR_CLASS = labelButtonClass("secondary", "sm");

export function ProfileSection() {
  const { user, setUserInfo } = useAuth();
  /**
   * Drafts, as the request would carry them: `undefined` means "not edited on this page", so
   * Save sends only what changed — the route is a patch and an unedited field must stay
   * untouched rather than be rewritten with the value the page happened to load.
   */
  const [draftAvatar, setDraftAvatar] = useState<string | null | undefined>(undefined);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storedName = user?.displayName ?? "";
  const name = draftName ?? storedName;
  const avatar = draftAvatar !== undefined ? draftAvatar : (user?.avatar ?? null);
  // A blank field means "clear it", which the route spells as null; a name is trimmed here as
  // well as on the server so the comparison below sees the value that would be stored.
  const nameToSend = name.trim() === "" ? null : name.trim();
  const nameChanged = (nameToSend ?? "") !== storedName;
  const avatarChanged = draftAvatar !== undefined && draftAvatar !== (user?.avatar ?? null);
  const dirty = nameChanged || avatarChanged;

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset before reading so re-picking the same file fires change again.
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await avatarDataUrlFromFile(file);
      if (dataUrl === null) {
        setError(S.profile.avatarTooLarge);
        return;
      }
      setDraftAvatar(dataUrl);
    } catch {
      setError(S.profile.avatarUnreadable);
    }
  };

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateProfile({
        ...(nameChanged ? { displayName: nameToSend } : {}),
        ...(avatarChanged ? { avatar: draftAvatar ?? null } : {}),
      });
      // Adopt the server's row: the user menu's avatar and name read the same auth state, so
      // they change with this call rather than on the next page load. The drafts go back to
      // "not edited" so what is on screen is the stored value again.
      setUserInfo(res.user);
      setDraftAvatar(undefined);
      setDraftName(undefined);
      toastSuccess(S.common.saved);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  return (
    <SectionShell
      actions={
        <Button size="sm" variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {S.common.save}
        </Button>
      }
    >
      <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
        <PrefRow label={S.profile.avatar}>
          <div className="flex items-center gap-3">
            <UserAvatar
              userId={user.userId}
              {...(name.trim() !== "" ? { displayName: name.trim() } : {})}
              {...(avatar !== null ? { avatar } : {})}
              size={USER_AVATAR_SIZE.preview}
            />
            {/* A label rather than a Button: the hidden file input has to be labelled for a
                click to open the native picker. Same two records Button reads, at the form rung
                its neighbours sit on. */}
            <label className={CHANGE_AVATAR_CLASS}>
              <HiddenFileInput
                accept={AVATAR_ACCEPT}
                disabled={busy}
                onChange={(e) => void onPickFile(e)}
              />
              {S.profile.changeAvatar}
            </label>
            {avatar !== null && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraftAvatar(null);
                  setError(null);
                }}
              >
                {S.profile.removeAvatar}
              </Button>
            )}
          </div>
        </PrefRow>
        <PrefRow label={S.profile.displayName} hint={S.profile.displayNameHint}>
          <Input
            size="sm"
            maxLength={32}
            value={name}
            placeholder={S.profile.displayNamePlaceholder}
            disabled={busy}
            aria-label={S.profile.displayName}
            onChange={(e) => {
              setDraftName(e.target.value);
              setError(null);
            }}
          />
        </PrefRow>
      </div>
      {error !== null && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </SectionShell>
  );
}
