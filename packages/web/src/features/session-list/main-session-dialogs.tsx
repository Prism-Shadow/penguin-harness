import { Button, ConfirmModal, Input, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { workspaceLabel } from "../../lib/session-grouping";
import { MessagingBindingModal } from "../messaging";
import { draftSessionTitle } from "../chat";
import { CreateProjectDialog, ProjectSettingsDialog } from "../projects";
import type { MainSidebarState } from "./main-sidebar-controller";

export function renderMainSessionDialogs(scope: MainSidebarState) {
  const {
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    replace,
    createProjectOpen,
    setCreateProjectOpen,
    projectSettingsOpen,
    setProjectSettingsOpen,
    sessions,
    renamingWorkspace,
    setRenamingWorkspace,
    workspaceAliasText,
    setWorkspaceAliasText,
    deletingWorkspace,
    setDeletingWorkspace,
    deletingSession,
    setDeletingSession,
    deletingBusy,
    deletingDraft,
    setDeletingDraft,
    renamingSession,
    setRenamingSession,
    renameText,
    setRenameText,
    renameBusy,
    renameError,
    setRenameError,
    messagingSession,
    setMessagingSession,
    confirmRename,
    confirmDeleteSession,
    confirmDeleteDraft,
    confirmRenameWorkspace,
    confirmDeleteWorkspace,
  } = scope;
  return (
    <>
      <CreateProjectDialog
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(projectId) => {
          setCreateProjectOpen(false);
          void reloadProjects().then(() => setCurrentProjectId(projectId));
        }}
      />
      {currentProject && (
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
      {/* Rename chat */}
      <Modal
        open={renamingSession !== null}
        title={S.chat.renameSession}
        onClose={() => (renameBusy ? undefined : setRenamingSession(null))}
        footer={
          <>
            <Button size="sm" onClick={() => setRenamingSession(null)} disabled={renameBusy}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={renameBusy || !renameText.trim()}
              onClick={() => void confirmRename()}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          label={S.chat.renameSessionLabel}
          value={renameText}
          error={renameError ?? undefined}
          autoFocus
          maxLength={120}
          onChange={(e) => {
            setRenameText(e.target.value);
            if (renameError) setRenameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renameText.trim() && !renameBusy) void confirmRename();
          }}
        />
      </Modal>

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
      <Modal
        open={renamingWorkspace !== null}
        title={S.chat.renameWorkspace}
        onClose={() => setRenamingWorkspace(null)}
        footer={
          <>
            <Button size="sm" onClick={() => setRenamingWorkspace(null)}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" onClick={confirmRenameWorkspace}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          label={S.chat.renameWorkspaceLabel}
          hint={S.chat.renameWorkspaceHint}
          value={workspaceAliasText}
          placeholder={renamingWorkspace ? workspaceLabel(renamingWorkspace.path) : ""}
          autoFocus
          maxLength={80}
          onChange={(e) => setWorkspaceAliasText(e.target.value)}
          onKeyDown={(e) => {
            // isComposing guard (the repo's IME convention, cf. workspace-select.tsx):
            // accepting a Chinese candidate fires Enter, which would save the raw pinyin.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) confirmRenameWorkspace();
          }}
        />
      </Modal>

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
