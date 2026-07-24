/**
 * User management page (admin only): user list + create / reset password / delete.
 * Registration is closed: new users are created here, with the initial password set by the admin and
 * communicated offline; deleting a user also deletes all their Projects (including data directories),
 * with a confirmation dialog.
 */
import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import type { UserInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { USERNAME_PATTERN } from "../../lib/semantic-id";
import { formatDateTime } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Modal } from "../../components/ui/modal";

export function AdminUsersPage() {
  useDocumentTitle(S.admin.users);
  const { user } = useAuth();
  const [users, setUsers] = useState<UserInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetting, setResetting] = useState<UserInfo | null>(null);
  const [deleting, setDeleting] = useState<UserInfo | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers((await api.adminListUsers()).users);
      setListError(null);
    } catch (e) {
      setListError(apiErrorText(e));
    }
  }, []);

  useEffect(() => {
    if (user?.isAdmin) void reload();
  }, [user?.isAdmin, reload]);

  // Route guard fallback: non-admins are redirected back to the chat page (the sidebar has no entry point anyway).
  if (user && !user.isAdmin) return <Navigate to="/chat" replace />;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{S.admin.users}</h1>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {S.admin.createUser}
          </Button>
        </div>

        {users === null ? (
          <p className="text-sm text-gray-400">{S.common.loading}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{S.common.username}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{S.common.role}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{S.common.created}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {S.common.actions}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {users.map((u) => (
                  <tr key={u.userId}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {u.userId}
                      {u.passwordIsInitial && (
                        <span className="ml-2 align-middle">
                          <Badge tone="gray">{S.admin.initialPasswordFlag}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Badge tone="gray">{u.isAdmin ? S.admin.roleAdmin : S.admin.roleUser}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-gray-400">
                      {formatDateTime(u.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                        {S.admin.resetPassword}
                      </Button>
                      {!u.isAdmin && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(u)}>
                          {S.common.delete}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {listError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{listError}</p>}
      </div>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          void reload();
        }}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <DeleteUserDialog
        user={deleting}
        onClose={() => setDeleting(null)}
        onDone={() => {
          setDeleting(null);
          void reload();
        }}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ userId?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const clearErrors = () => setErrors((p) => (p.userId || p.password ? {} : p));

  useEffect(() => {
    if (!open) return;
    setUserId("");
    setPassword("");
    setErrors({});
  }, [open]);

  const submit = async () => {
    const id = userId.trim();
    const next: { userId?: string; password?: string } = {};
    if (!id) next.userId = S.common.requiredField;
    else if (!USERNAME_PATTERN.test(id)) next.userId = S.auth.usernameHint;
    if (!password) next.password = S.common.requiredField;
    if (next.userId || next.password) {
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.adminCreateUser({ userId: id, password });
      onDone();
    } catch (e) {
      // The server rejects a duplicate id here — surface it on the id field.
      setErrors({ userId: apiErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.admin.createUser}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={S.common.username}
          required
          size="sm"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            clearErrors();
          }}
          error={errors.userId}
          hint={S.auth.usernameHint}
          autoFocus
        />
        <PasswordInput
          label={S.admin.initialPassword}
          required
          size="sm"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearErrors();
          }}
          error={errors.password}
          autoComplete="new-password"
          hint={S.auth.passwordHint}
        />
        {USERNAME_PATTERN.test(userId.trim()) && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.admin.defaultProjectNote(`${userId.trim()}-default_project`)}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserInfo | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setPassword("");
    setPasswordError(undefined);
  }, [user]);

  const submit = async () => {
    if (!user) return;
    if (!password) {
      setPasswordError(S.common.requiredField);
      return;
    }
    setBusy(true);
    setPasswordError(undefined);
    try {
      await api.adminResetPassword(user.userId, { password });
      onClose();
    } catch (e) {
      setPasswordError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      title={user ? S.admin.resetPasswordTitle(user.userId) : ""}
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
          label={S.admin.initialPassword}
          required
          size="sm"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setPasswordError(undefined);
          }}
          error={passwordError}
          autoComplete="new-password"
          hint={S.auth.passwordHint}
          autoFocus
        />
        <p className="text-xs text-gray-400 dark:text-gray-500">{S.admin.resetPasswordNote}</p>
      </div>
    </Modal>
  );
}

function DeleteUserDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserInfo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setConfirmed(false);
    setError(null);
  }, [user]);

  const doDelete = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminDeleteUser(user.userId);
      onDone();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      title={user ? S.admin.deleteUserTitle(user.userId) : ""}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          {confirmed ? (
            <Button variant="danger" disabled={busy} onClick={() => void doDelete()}>
              {S.common.confirm}
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirmed(true)}>
              {S.common.delete}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-sm text-red-600 dark:text-red-400">
          {user ? S.admin.deleteUserConfirm(user.userId) : ""}
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
