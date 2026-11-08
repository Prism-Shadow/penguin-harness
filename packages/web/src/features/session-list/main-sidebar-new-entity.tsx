import { S } from "../../lib/strings";
import { newEntityForGroupMode } from "../../components/ui/group-list";
import type { useMainSidebarArchiveSession } from "./main-sidebar-archive-session";

/** Consecutive live main statements 116..117, called once in original hook order. */
export function useMainSidebarNewEntity(scope: ReturnType<typeof useMainSidebarArchiveSession>) {
  const { groupMode } = scope;

  /** What the header's create button makes, and its tooltip (the created object follows the grouping mode). */
  const newEntity = newEntityForGroupMode(groupMode);
  const newEntityLabel =
    newEntity === "agent"
      ? S.agent.create
      : newEntity === "chat"
        ? S.chat.newSessionMenu
        : S.chat.newWorkspaceEntity;
  return { ...scope, newEntity, newEntityLabel };
}
