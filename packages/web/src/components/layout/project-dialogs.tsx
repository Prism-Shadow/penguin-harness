/**
 * Project dialogs: create Project, Project settings
 * (member management and deletion, owner only). Invoked from the sidebar's Project switcher.
 */
import { useEffect, useState } from "react";
import type { MemberInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import {
  PROJECT_ID_MAX_LENGTH,
  PROJECT_SUFFIX_PATTERN,
  SEMANTIC_ID_PATTERN,
} from "../../lib/semantic-id";
import { projectDisplayName, useProject } from "../../state/project";
import { useAuth } from "../../state/auth";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import { Badge } from "../ui/badge";

export function CreateProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { user } = useAuth();
  // Non-admin Project ids are forced to have a "<username>-" prefix: the input locks the prefix segment, only the rest is editable.
  const prefix = user && !user.isAdmin ? `${user.userId}-` : "";
  const [idInput, setIdInput] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // No draft is kept: the form starts empty every time it opens.
  useEffect(() => {
    if (!open) return;
    setIdInput("");
    setName("");
    setError(null);
  }, [open]);

  const submit = async () => {
    const id = prefix + idInput.trim();
    if (!idInput.trim()) {
      setError(S.common.requiredField);
      return;
    }
    // Non-admin: validate the suffix segment (the hyphen is a reserved separator, appearing only once at the prefix join); admin: validate the whole string.
    const valid = prefix
      ? PROJECT_SUFFIX_PATTERN.test(idInput.trim()) && id.length <= PROJECT_ID_MAX_LENGTH
      : SEMANTIC_ID_PATTERN.test(id);
    if (!valid) {
      setError(prefix ? S.project.idPrefixHint : S.project.idHint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProject({
        projectId: id,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onCreated(res.project.projectId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.project.createTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {prefix ? (
          <div>
            <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              {S.project.id}
            </span>
            <div className="flex items-stretch">
              <span className="flex shrink-0 items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-100 px-2 font-mono text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                {prefix}
              </span>
              <Input
                size="sm"
                className="rounded-l-none"
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                autoFocus
              />
            </div>
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-500">
              {S.project.idPrefixHint}
            </span>
          </div>
        ) : (
          <Input
            label={S.project.id}
            size="sm"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            hint={S.project.idHint}
            autoFocus
          />
        )}
        <Input
          label={S.project.name}
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}

/** Project settings dialog: member management (owner) and deletion (owner); members see a read-only member list. */
export function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { currentProject, setCurrentProjectId, projects, reloadProjects } = useProject();
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const projectId = currentProject?.projectId;
  const isOwner = currentProject?.role === "owner";

  useEffect(() => {
    if (!open || !projectId) return;
    setMembers(null);
    setError(null);
    setConfirmDelete(false);
    api
      .listMembers(projectId)
      .then((res) => setMembers(res.members))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : S.common.unknownError));
  }, [open, projectId]);

  if (!currentProject || !projectId) return null;

  const addMember = async () => {
    if (!newMemberId.trim()) return;
    setError(null);
    try {
      await api.addMember(projectId, { userId: newMemberId.trim() });
      setNewMemberId("");
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    }
  };

  const doRemove = async (memberId: string) => {
    setError(null);
    try {
      await api.removeMember(projectId, memberId);
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    }
  };

  const doDelete = async () => {
    setError(null);
    try {
      await api.deleteProject(projectId);
      onClose();
      const next = projects.find((p) => p.projectId !== projectId);
      await reloadProjects();
      if (next) setCurrentProjectId(next.projectId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    }
  };

  return (
    <Modal open={open} title={S.project.settingsTitle} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">{S.project.switcher}</p>
          <p className="text-sm">
            {projectDisplayName(currentProject)}{" "}
            <span className="font-mono text-xs text-gray-400">{projectId}</span>
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">{S.project.members}</p>
          {members === null ? (
            <p className="text-xs text-gray-400">{S.common.loading}</p>
          ) : (
            // Member permission table: username / role / actions; cells never wrap.
            // Last row (owner only) = add member: small username input + add button (new members are always the member role).
            <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
                    <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                      {S.project.memberUsername}
                    </th>
                    <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                      {S.project.memberRole}
                    </th>
                    <th className="w-20 whitespace-nowrap px-2.5 py-1.5 text-right font-medium">
                      {S.project.memberActions}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{m.userId}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        <Badge tone="gray">{m.role}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1 text-right">
                        {isOwner && m.role !== "owner" && m.userId !== user?.userId && (
                          <Button size="sm" variant="ghost" onClick={() => void doRemove(m.userId)}>
                            {S.project.removeMember}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {isOwner && (
                    <tr>
                      <td className="px-2.5 py-1.5">
                        <Input
                          placeholder={S.project.memberUsername}
                          size="sm"
                          value={newMemberId}
                          onChange={(e) => setNewMemberId(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void addMember();
                          }}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        <Badge tone="gray">member</Badge>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1 text-right">
                        <Button
                          size="sm"
                          disabled={!newMemberId.trim()}
                          onClick={() => void addMember()}
                        >
                          {S.project.addMember}
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {isOwner && (
          <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
            {projectId === "default_project" ? (
              <p className="text-xs text-gray-400">{S.project.deleteDefaultForbidden}</p>
            ) : projects.length <= 1 ? (
              // Last accessible Project: deleting it would leave the account with no Project to select
              // (the page would get stuck on the skeleton screen), so the frontend hides the entry point outright, matching the server's 409 rejection.
              <p className="text-xs text-gray-400">{S.project.deleteLastForbidden}</p>
            ) : confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-red-600 dark:text-red-400">{S.project.deleteConfirm}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setConfirmDelete(false)}>
                    {S.common.cancel}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void doDelete()}>
                    {S.common.confirm}
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                {S.project.deleteProject}
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
