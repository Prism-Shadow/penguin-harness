import { useChatSession } from "../../lib/chat-session";
import type { OpenPage } from "../../lib/page-layout";
import { machineForSession } from "../../lib/session-machines";
import { parseSessionWorkbenchPage } from "../../lib/session-workbenches";
import { S } from "../../lib/strings";
import { useSessionWorkbenchPanels } from "./panel-registry";

/** The host supplies the originating chat's existing controller, including its live streams and composer. */
export function SessionWorkbenchBody({
  page,
  sessionId,
  active,
}: {
  page: OpenPage;
  sessionId: string;
  active: boolean;
}) {
  const ref = parseSessionWorkbenchPage(page);
  const { selected, projectId } = useChatSession();
  const panels = useSessionWorkbenchPanels();
  const definition = panels.find((item) => item.id === ref?.kind);
  if (
    !ref ||
    !selected ||
    !definition ||
    selected.sessionId !== sessionId ||
    ref.address.sessionId !== sessionId ||
    ref.address.projectId !== projectId ||
    ref.address.machineId !== machineForSession(sessionId)
  ) {
    return (
      <p role="status" className="p-4 text-sm text-fg-muted">
        {S.dock.toolUnavailable}
      </p>
    );
  }
  const Body = definition.Body;
  return (
    <Body
      active={active}
      scope={{ ...ref.address, agentId: selected.agentId, workspace: selected.workspace }}
    />
  );
}
