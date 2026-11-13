import {
  Button,
  ConfirmModal,
  Input,
  Modal,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { workspaceLabel } from "../../lib/session-grouping";
import { MessagingBindingModal } from "../messaging";
import { draftSessionTitle } from "../chat";
import type { MainSidebarState } from "./main-sidebar-controller";

/** The rename chat dialog: its draft is the dialog's own, so closing with typed
    text runs the unsaved-changes guard instead of dropping it silently. */
function RenameSessionDialog(props: {
  session: SessionInfo;
  busy: boolean;
  error: string | null;
  onRename: (title: string) => void;
  /** Clears the controller's rename error: the dialog edited the text again. */
  onEdit: () => void;
  onClose: () => void;
}) {
  const { session, busy, error, onRename, onEdit, onClose } = props;
  const form = useFormDraft(session.title ?? "");
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const submit = () => {
    if (busy || !form.draft.trim()) return;
    onRename(form.draft);
  };
  return (
    <Modal
      open
      title={S.chat.renameSession}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !form.draft.trim()}
            onClick={submit}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <Input
        size="sm"
        label={S.chat.renameSessionLabel}
        value={form.draft}
        error={error ?? undefined}
        autoFocus
        maxLength={120}
        onChange={(e) => {
          form.setDraft(e.target.value);
          if (error) onEdit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && form.draft.trim() && !busy) submit();
        }}
      />
    </Modal>
  );
}

/** The workspace alias editor: same dialog-owned draft; a blank save is valid
    (the alias reverts to the directory basename), like the controller's original. */
function RenameWorkspaceDialog(props: {
  path: string;
  initialAlias: string;
  onRename: (alias: string) => void;
  onClose: () => void;
}) {
  const { path, initialAlias, onRename, onClose } = props;
  const form = useFormDraft(initialAlias);
  const requestClose = useGuardedClose(onClose, form.scope);
  const submit = () => onRename(form.draft);
  return (
    <Modal
      open
      title={S.chat.renameWorkspace}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <Input
        size="sm"
        label={S.chat.renameWorkspaceLabel}
        hint={S.chat.renameWorkspaceHint}
        value={form.draft}
        placeholder={workspaceLabel(path)}
        autoFocus
        maxLength={80}
        onChange={(e) => form.setDraft(e.target.value)}
        onKeyDown={(e) => {
          // isComposing guard (the repo's IME convention, cf. workspace-select.tsx):
          // accepting a Chinese candidate fires Enter, which would save the raw pinyin.
          if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
        }}
      />
    </Modal>
  );
}

export function renderMainSessionDialogs(scope: MainSidebarState) {
  const {
    replace,
    sessions,
    renamingSession,
    setRenamingSession,
    renameBusy,
    renameError,
    setRenameError,
    deletingWorkspace,
    setDeletingWorkspace,
    deletingSession,
    setDeletingSession,
    deletingBusy,
    deletingDraft,
    setDeletingDraft,
    messagingSession,
    setMessagingSession,
    renamingWorkspace,
    setRenamingWorkspace,
    workspaceAliasText,
    confirmRename,
    confirmDeleteSession,
    confirmDeleteDraft,
    confirmRenameWorkspace,
    confirmDeleteWorkspace,
  } = scope;
  return (
    <>
      {/* Rename chat */}
      {renamingSession !== null && (
        <RenameSessionDialog
          session={renamingSession}
          busy={renameBusy}
          error={renameError}
          onRename={(title) => void confirmRename(title)}
          onEdit={() => setRenameError(null)}
          onClose={() => setRenamingSession(null)}
        />
      )}

      {/* Messaging binding dialog (row menu "Messaging binding…"): the row indicator
          updates in place from the dialog's own save/unbind outcome. */}
      {messagingSession && (
        <MessagingBindingModal
          sessionId={messagingSession.sessionId}
          onClose={() => setMessagingSession(null)}
          onChanged={(sessionId, channel) => {
            const current = sessions.find((x) => x.sessionId === sessionId);
            if (!current) return;
            const updated = { ...current };
            if (channel !== null) updated.messagingChannel = channel;
            else delete updated.messagingChannel;
            replace(updated);
          }}
        />
      )}

      {/* Rename workspace (alias edit, same Modal + Input idiom as rename chat): the alias
          replaces the directory basename as the group label; leaving it blank reverts to
          the basename — so an empty save is valid here, unlike the chat rename. */}
      {renamingWorkspace !== null && (
        <RenameWorkspaceDialog
          path={renamingWorkspace.path}
          initialAlias={workspaceAliasText}
          onRename={(alias) => confirmRenameWorkspace(alias)}
          onClose={() => setRenamingWorkspace(null)}
        />
      )}

      {/* Delete chat confirmation (shared ConfirmModal) */}
      <ConfirmModal
        open={deletingSession !== null}
        title={S.chat.deleteSession}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={deletingBusy}
        onClose={() => (deletingBusy ? undefined : setDeletingSession(null))}
        onConfirm={() => void confirmDeleteSession()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingSession
            ? S.chat.deleteSessionConfirm(deletingSession.title ?? S.chat.defaultSessionTitle)
            : ""}
        </p>
      </ConfirmModal>

      {/* Remove-workspace confirmation (shared ConfirmModal, same stop as the other
          destructive-looking actions): the copy is honest about the scope — sidebar
          registry entry only, disk and Sessions untouched, re-addable anytime. */}
      <ConfirmModal
        open={deletingWorkspace !== null}
        title={S.chat.deleteWorkspace}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        onClose={() => setDeletingWorkspace(null)}
        onConfirm={confirmDeleteWorkspace}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingWorkspace ? S.chat.deleteWorkspaceConfirm(deletingWorkspace.label) : ""}
        </p>
      </ConfirmModal>

      {/* Delete parked-draft confirmation: purely local (localStorage entry), but the typed
          content is gone for good, which deserves the same explicit stop as a session. */}
      <ConfirmModal
        open={deletingDraft !== null}
        title={S.chat.deleteDraft}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        onClose={() => setDeletingDraft(null)}
        onConfirm={confirmDeleteDraft}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingDraft
            ? S.chat.deleteDraftConfirm(draftSessionTitle(deletingDraft) || S.chat.draftUntitled)
            : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
