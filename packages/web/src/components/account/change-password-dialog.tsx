/**
 * Change password dialog: validates the old password and that
 * the two new-password entries match; refreshes /api/me on success. The initial-password
 * notice banner disappears once passwordIsInitial clears. Shared by the sidebar user menu and the notice banner.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { Button } from "../ui/button";
import { PasswordInput } from "../ui/password-input";
import { Modal } from "../ui/modal";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setError(S.common.requiredField);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(S.account.passwordMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword({ oldPassword, newPassword });
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.account.changePassword}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PasswordInput
          label={S.account.oldPassword}
          size="sm"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
          hint={S.account.oldPasswordHint}
          autoFocus
        />
        <PasswordInput
          label={S.account.newPassword}
          size="sm"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          hint={S.auth.passwordHint}
        />
        <PasswordInput
          label={S.account.confirmPassword}
          size="sm"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
