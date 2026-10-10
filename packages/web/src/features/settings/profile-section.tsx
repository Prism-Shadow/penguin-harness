/**
 * Profile page of Settings: the avatar and nickname the account shows itself by.
 *
 * Unlike the Account page beside it, this one exists in every session — the desktop shell's
 * own token window included, which for a desktop install is the only session there is. A
 * profile is display data, so there is no old password for the server to check.
 *
 * The page has no footer: every control writes when it is used, and the button that writes a
 * value stands next to that value. Choosing an image applies it at once, because a picture is
 * direct manipulation with nothing to review before committing, and one staged behind a button
 * is the kind of edit people set and then lose by closing the dialog. Typed text is the one
 * thing here that still needs an explicit commit, so the nickname keeps a Save — beside the
 * field, not under the page, live only while the trimmed text differs from the stored nickname.
 * Leaving the page or the dialog with an unsaved nickname asks first (settings-dialog.tsx).
 * Restore default is a write like any other on both rows, so the
 * two buttons next to one control never disagree about when they act. The avatar's asks first:
 * it deletes the uploaded picture, which only a fresh upload brings back.
 *
 * Both control rows are rigid and the field is what gives: the buttons carry `shrink-0` and the
 * nickname field `min-w-0`, so a narrow dialog takes width from the field rather than from the
 * buttons. Without it the row collapses in Chinese and not in English, which is the surprising
 * half: flex will not shrink an item below its min-content width, and min-content for a CJK label
 * is one character — the browser breaks between any two of them — while an English label is held
 * open by its longest word. A squeezed button then wraps "恢复默认" onto two lines and stands twice
 * as tall as the row beside it.
 *
 * Nothing is applied optimistically: the preview and every other surface show what is STORED.
 * A write that fails therefore leaves the screen agreeing with the server and says so inline,
 * rather than showing a picture that silently disappears on the next load.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import type { UpdateProfileRequest, UserInfo } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  HiddenFileInput,
  Input,
  PrefRow,
  SettingsGroup,
  USER_AVATAR_SIZE,
  UserAvatar,
  buttonClass,
  toastSuccess,
  useFormDraft,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { avatarDataUrlFromFile } from "../../lib/avatar-image";
import { profileControls } from "../../lib/profile-form";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";
import { useAuth } from "../../state/auth";

/** What the picker offers — the three formats the server stores, spelled the way `accept` wants. */
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

const CHANGE_AVATAR_CLASS = buttonClass("secondary", "sm");

/**
 * The same control while a write is running. `Button`'s `disabled:` rules cannot help here — a
 * `<label>` takes no disabled state — and a `cursor-not-allowed` beside `buttonClass`'s
 * `cursor-pointer` would be decided by the order the stylesheet was generated in rather than by
 * this string. `pointer-events-none` has no counterpart to lose to, and it removes the hover
 * colour and the pointer cursor together; the input inside is `disabled`, so Tab skips it too.
 */
const CHANGE_AVATAR_BUSY_CLASS = `${CHANGE_AVATAR_CLASS} pointer-events-none opacity-60`;

/** Which row is mid-write. One at a time, so the busy mark always names the row being used. */
type PendingWrite = "avatar" | "nickname";

export function ProfileSection() {
  const { user, setUserInfo } = useAuth();
  /** The typed nickname against the stored one; trimmed before comparing, as Save stores it. */
  const nickname = useFormDraft(user?.displayName ?? "", {
    scope: SETTINGS_SCOPE,
    normalize: (value) => value.trim(),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [confirmAvatarReset, setConfirmAvatarReset] = useState(false);

  /**
   * One patch out, and the row that comes back becomes the auth state: the sidebar's user row,
   * the collapsed rail's trigger and the account menu's header all read it, so they change with
   * this call rather than on the next page load.
   */
  const send = async (patch: UpdateProfileRequest): Promise<UserInfo | null> => {
    try {
      const res = await api.updateProfile(patch);
      setUserInfo(res.user);
      toastSuccess(S.common.saved);
      return res.user;
    } catch (e) {
      setError(apiErrorText(e));
      return null;
    }
  };

  /**
   * Every control goes through here, so two writes can never be in flight together and the last
   * failure is never left standing beside a control the user has since used again.
   */
  const run = async (what: PendingWrite, body: () => Promise<unknown>): Promise<void> => {
    if (pending !== null) return;
    setPending(what);
    setError(null);
    try {
      await body();
    } finally {
      setPending(null);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Reset before reading so re-picking the same file fires change again.
    e.target.value = "";
    if (file === undefined) return;
    // The encode runs inside the busy window as well as the request: it decodes the picked file
    // and redraws it, which for a phone photograph is long enough to click twice through.
    void run("avatar", async () => {
      const dataUrl = await avatarDataUrlFromFile(file).catch(() => undefined);
      if (dataUrl === undefined) {
        setError(S.profile.avatarUnreadable);
        return;
      }
      if (dataUrl === null) {
        setError(S.profile.avatarTooLarge);
        return;
      }
      await send({ avatar: dataUrl });
    });
  };

  if (!user) return null;
  const controls = profileControls(user, nickname.draft);
  const busy = pending !== null;

  return (
    <section>
      <SettingsGroup>
        {/* The avatar's controls wrap, right-aligned, where a phone-width column cannot hold
            them on one line: a button keeps its label whole and does not shrink. */}
        <PrefRow label={S.profile.avatar} info={S.profile.avatarInfo}>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <UserAvatar
              userId={user.userId}
              {...(user.displayName !== undefined ? { displayName: user.displayName } : {})}
              {...(user.avatar !== undefined ? { avatar: user.avatar } : {})}
              size={USER_AVATAR_SIZE.preview}
            />
            {/* A label rather than a Button: the hidden file input has to be labelled for a
                click to open the native picker. Same two records Button reads, at the form rung
                its neighbours sit on. */}
            <label className={`shrink-0 ${busy ? CHANGE_AVATAR_BUSY_CLASS : CHANGE_AVATAR_CLASS}`}>
              <HiddenFileInput accept={AVATAR_ACCEPT} disabled={busy} onChange={onPickFile} />
              {S.profile.changeAvatar}
            </label>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              aria-label={S.profile.restoreDefaultOf(S.profile.avatar)}
              disabled={busy || !controls.canRestoreAvatar}
              onClick={() => setConfirmAvatarReset(true)}
            >
              {S.profile.restoreDefault}
            </Button>
          </div>
        </PrefRow>
        <PrefRow label={S.profile.displayName} info={S.profile.displayNameInfo}>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              className="w-48 min-w-0"
              maxLength={32}
              value={nickname.draft}
              placeholder={S.profile.displayNamePlaceholder}
              disabled={busy}
              aria-label={S.profile.displayName}
              onChange={(e) => {
                nickname.setDraft(e.target.value);
                setError(null);
              }}
            />
            <Button
              size="sm"
              variant="primary"
              className="shrink-0"
              disabled={busy || !controls.canSaveNickname}
              onClick={() =>
                void run("nickname", async () => {
                  // The stored value becomes the field's only once it landed, so a failed save
                  // keeps the text the user typed instead of snapping back.
                  const stored = await send({ displayName: controls.nicknameToStore });
                  if (stored !== null) nickname.adopt(stored.displayName ?? "");
                })
              }
            >
              {S.common.save}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              aria-label={S.profile.restoreDefaultOf(S.profile.displayName)}
              disabled={busy || !controls.canRestoreNickname}
              onClick={() =>
                void run("nickname", async () => {
                  const stored = await send({ displayName: null });
                  if (stored !== null) nickname.adopt(stored.displayName ?? "");
                })
              }
            >
              {S.profile.restoreDefault}
            </Button>
          </div>
        </PrefRow>
      </SettingsGroup>
      {/* Busy and failed, in the one place both rows can say it: a write here changes the
          sidebar as well as this page, so "it did not happen" has to be stated rather than
          left to the preview looking unchanged. */}
      {busy && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{S.common.saving}</p>}
      {error !== null && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <ConfirmModal
        open={confirmAvatarReset}
        title={S.profile.restoreDefaultOf(S.profile.avatar)}
        onClose={() => setConfirmAvatarReset(false)}
        onConfirm={() => {
          setConfirmAvatarReset(false);
          void run("avatar", () => send({ avatar: null }));
        }}
        confirmLabel={S.profile.restoreDefault}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.profile.avatarResetConfirm}</p>
      </ConfirmModal>
    </section>
  );
}
