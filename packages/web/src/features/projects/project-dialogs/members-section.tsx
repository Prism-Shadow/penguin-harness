import { useEffect, useState } from "react";
import type { MemberInfo } from "@prismshadow/penguin-server/api";
import { Badge, Button, ConfirmModal, Input, toastError } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { useAuth } from "../../../state/auth";

export function MembersSection({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The member whose removal awaits confirmation: it revokes their access at once. */
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMembers(null);
    setLoadError(null);
    api
      .listMembers(projectId)
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const addMember = async () => {
    if (!newMemberId.trim()) return;
    try {
      await api.addMember(projectId, { userId: newMemberId.trim() });
      setNewMemberId("");
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const doRemove = async (memberId: string) => {
    try {
      await api.removeMember(projectId, memberId);
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  if (loadError) return <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>;
  if (members === null) return <p className="text-xs text-gray-400">{S.common.loading}</p>;
  return (
    // Member permission table: username / role / actions; cells never wrap. Last row
    // (owner only) = add member: small username input + add button (new members are
    // always the member role).
    <>
      <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
              <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">{S.common.username}</th>
              <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">{S.common.role}</th>
              <th className="w-20 whitespace-nowrap px-2.5 py-1.5 text-right font-medium">
                {S.common.actions}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {members.map((m) => (
              <tr key={m.userId}>
                <td className="whitespace-nowrap px-2.5 py-1.5">{m.userId}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5">
                  <Badge>{m.role}</Badge>
                </td>
                <td className="whitespace-nowrap px-2.5 py-1 text-right">
                  {isOwner && m.role !== "owner" && m.userId !== user?.userId && (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(m.userId)}>
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
                    placeholder={S.common.username}
                    size="sm"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addMember();
                    }}
                  />
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5">
                  <Badge>member</Badge>
                </td>
                <td className="whitespace-nowrap px-2.5 py-1 text-right">
                  <Button size="sm" disabled={!newMemberId.trim()} onClick={() => void addMember()}>
                    {S.project.addMember}
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ConfirmModal
        open={removing !== null}
        title={S.project.removeMemberTitle}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) void doRemove(removing);
          setRemoving(null);
        }}
        confirmLabel={S.project.removeMember}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.project.removeMemberConfirm(removing) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
