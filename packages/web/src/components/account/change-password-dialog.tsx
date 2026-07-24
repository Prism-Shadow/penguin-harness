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
  const [errors, setErrors] = useState<{ old?: string; new?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const clearErrors = () => setErrors((p) => (p.old || p.new || p.confirm ? {} : p));

  useEffect(() => {
    if (!open) return;
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrors({});
  }, [open]);

  const submit = async () => {
    const next: { old?: string; new?: string; confirm?: string } = {};
    if (!oldPassword) next.old = S.common.requiredField;
    if (!newPassword) next.new = S.common.requiredField;
    if (!confirmPassword) next.confirm = S.common.requiredField;
    if (!next.confirm && newPassword !== confirmPassword) next.confirm = S.account.passwordMismatch;
    if (next.old || next.new || next.confirm) {
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.changePassword({ oldPassword, newPassword });
      await refresh();
      onClose();
    } catch (e) {
      // The server only rejects here when the old password is wrong — attach it to that field.
      setErrors({ old: e instanceof ApiError ? e.message : S.common.unknownError });
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
          onChange={(e) => {
            setOldPassword(e.target.value);
            clearErrors();
          }}
          error={errors.old}
          autoComplete="current-password"
          hint={S.account.oldPasswordHint}
          autoFocus
        />
        <PasswordInput
          label={S.account.newPassword}
          size="sm"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            clearErrors();
          }}
          error={errors.new}
          autoComplete="new-password"
          hint={S.auth.passwordHint}
        />
        <PasswordInput
          label={S.account.confirmPassword}
          size="sm"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearErrors();
          }}
          error={errors.confirm}
          autoComplete="new-password"
        />
      </div>
    </Modal>
  );
}
