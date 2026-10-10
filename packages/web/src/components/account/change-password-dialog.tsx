/**
 * Change password dialog: validates the old password and that
 * the two new-password entries match; refreshes /api/me on success. The initial-password
 * notice banner disappears once passwordIsInitial clears. Shared by the sidebar user menu and the notice banner.
 *
 * A typed form under the settings commit model: Save is live only once every field it needs is
 * filled and the two new entries match (a mismatch is named under the confirmation as soon as
 * it is typed), and closing the dialog — Cancel, Esc, the × or a press outside it — with
 * anything typed asks before the typing is thrown away. The form is mounted only while the
 * dialog is open, so every opening starts empty.
 */
import { useState } from "react";
import {
  Button,
  Modal,
  PasswordInput,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { omitsOldPassword } from "../../lib/account-menu";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <ChangePasswordForm onClose={onClose} /> : null;
}

const EMPTY = { oldPassword: "", newPassword: "", confirmPassword: "" };

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const { refresh, desktopMode, sessionVia } = useAuth();
  // The shell's own window and a first-login session set the password without the old one —
  // for them the current password is random and was never shown (see omitsOldPassword). Both
  // fields are needed, not the session's origin alone: they are what the server's own gate
  // reads, and a field it wants but the form leaves out fails the request.
  const noOldPassword = omitsOldPassword({ desktopMode, sessionVia });
  const form = useFormDraft(EMPTY);
  const { oldPassword, newPassword, confirmPassword } = form.draft;
  /** What the server refused, on the field it is about. Cleared by the next keystroke. */
  const [refused, setRefused] = useState<{ old?: string; new?: string }>({});
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });

  const mismatch = confirmPassword !== "" && newPassword !== confirmPassword;
  const complete =
    (noOldPassword || oldPassword !== "") && newPassword !== "" && confirmPassword !== "";
  const valid = complete && !mismatch;

  const edit = (patch: Partial<typeof EMPTY>) => {
    form.patch(patch);
    setRefused({});
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setRefused({});
    try {
      await api.changePassword(noOldPassword ? { newPassword } : { oldPassword, newPassword });
      await refresh();
      onClose();
    } catch (e) {
      // Route by error code: invalid_password is about the NEW password's strength;
      // password_mismatch (and anything unrecognized) is about the current one.
      if (e instanceof ApiError && e.code === "invalid_password") {
        setRefused({ new: apiErrorText(e) });
      } else {
        setRefused({ old: apiErrorText(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.account.changePassword}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!form.dirty || !valid || busy}
            onClick={() => void submit()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!noOldPassword && (
          <PasswordInput
            label={S.account.oldPassword}
            required
            size="sm"
            value={oldPassword}
            onChange={(e) => edit({ oldPassword: e.target.value })}
            error={refused.old}
            autoComplete="current-password"
            info={S.account.oldPasswordHint}
            infoLabel={S.account.oldPassword}
            autoFocus
          />
        )}
        <PasswordInput
          label={S.account.newPassword}
          required
          size="sm"
          value={newPassword}
          onChange={(e) => edit({ newPassword: e.target.value })}
          error={refused.new}
          autoComplete="new-password"
          hint={S.auth.passwordHint}
          autoFocus={noOldPassword}
        />
        <PasswordInput
          label={S.account.confirmPassword}
          required
          size="sm"
          value={confirmPassword}
          onChange={(e) => edit({ confirmPassword: e.target.value })}
          error={mismatch ? S.account.passwordMismatch : undefined}
          autoComplete="new-password"
        />
      </div>
    </Modal>
  );
}
