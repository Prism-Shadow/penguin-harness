/**
 * User management (admin only): user list + create / reset password / delete. Rendered as
 * a page of the Settings dialog rather than a routed page of its own.
 * Registration is closed: new users are created here, with the initial password set by the admin and
 * communicated offline; deleting a user also deletes all their Projects (including data directories),
 * with a confirmation dialog.
 *
 * The create and reset dialogs are typed forms under the settings commit model: their footer
 * verb is live only once the fields are valid (an id that breaks the naming rule is named under
 * the box as it is typed), and closing one with anything typed asks first. Each form is mounted
 * only while its dialog is open, so every opening starts empty.
 */
import { useCallback, useEffect, useState } from "react";
import type { UserInfo } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Input,
  Modal,
  PasswordInput,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { USERNAME_PATTERN } from "../../lib/semantic-id";
import { formatDateTime } from "../../lib/format";
import { useAuth } from "../../state/auth";

export function AdminUsersSection() {
  const { user, desktopMode } = useAuth();
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
    if (user?.isAdmin && !desktopMode) void reload();
  }, [user?.isAdmin, desktopMode, reload]);

  // Registry guard fallback: the settings dialog never offers this page to non-admins or
  // in desktop mode (where the server rejects the admin-user routes, desktop_single_user);
  // render nothing rather than half a surface if reached anyway.
  if (user && (!user.isAdmin || desktopMode)) return null;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
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
                        <Badge>{S.admin.initialPasswordFlag}</Badge>
                      </span>
                    )}
                    {/* The nickname under the id, not instead of it: every other control on the
                        row acts on the id, and a list that showed only the chosen name would
                        leave an admin guessing which account they are resetting. */}
                    {u.displayName !== undefined && (
                      <p className="text-xs font-normal text-gray-500 dark:text-gray-400">
                        {u.displayName}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge>{u.isAdmin ? S.admin.roleAdmin : S.admin.roleUser}</Badge>
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
  return open ? <CreateUserForm onClose={onClose} onDone={onDone} /> : null;
}

function CreateUserForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const form = useFormDraft({ userId: "", password: "" });
  /** What the server refused, on the field it is about. Cleared by the next keystroke. */
  const [refused, setRefused] = useState<{ userId?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const id = form.draft.userId.trim();
  const { password } = form.draft;
  // The naming rule is said under the box as soon as it is broken, so a held Create explains itself.
  const idBroken = id !== "" && !USERNAME_PATTERN.test(id);
  const valid = id !== "" && !idBroken && password !== "";

  const edit = (patch: { userId?: string; password?: string }) => {
    form.patch(patch);
    setRefused({});
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setRefused({});
    try {
      await api.adminCreateUser({ userId: id, password });
      onDone();
    } catch (e) {
      // Route by error code: invalid_password is about the password's strength;
      // user_exists (and anything unrecognized) is about the id.
      if (e instanceof ApiError && e.code === "invalid_password") {
        setRefused({ password: apiErrorText(e) });
      } else {
        setRefused({ userId: apiErrorText(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.admin.createUser}
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
          value={form.draft.userId}
          onChange={(e) => edit({ userId: e.target.value })}
          error={refused.userId ?? (idBroken ? S.auth.usernameHint : undefined)}
          hint={S.auth.usernameHint}
          autoFocus
        />
        <PasswordInput
          label={S.admin.initialPassword}
          required
          size="sm"
          value={password}
          onChange={(e) => edit({ password: e.target.value })}
          error={refused.password}
          autoComplete="new-password"
          hint={S.auth.passwordHint}
        />
        {USERNAME_PATTERN.test(id) && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.admin.defaultProjectNote(`${id}-default_project`)}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserInfo | null; onClose: () => void }) {
  return user === null ? null : (
    <ResetPasswordForm key={user.userId} user={user} onClose={onClose} />
  );
}

function ResetPasswordForm({ user, onClose }: { user: UserInfo; onClose: () => void }) {
  const form = useFormDraft("");
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const password = form.draft;

  const submit = async () => {
    if (password === "" || busy) return;
    setBusy(true);
    setRefused(undefined);
    try {
      await api.adminResetPassword(user.userId, { password });
      onClose();
    } catch (e) {
      setRefused(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.admin.resetPasswordTitle(user.userId)}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={password === "" || busy}
            onClick={() => void submit()}
          >
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
            form.setDraft(e.target.value);
            setRefused(undefined);
          }}
          error={refused}
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
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          {confirmed ? (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void doDelete()}>
              {S.common.confirm}
            </Button>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmed(true)}>
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
