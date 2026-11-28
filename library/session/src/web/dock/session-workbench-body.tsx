import { useContext } from "react";
import {
  PageIdentity,
  S,
  machineForSession,
  parseSessionWorkbenchPage,
  useChatSession,
} from "@prismshadow/penguin-web/internal";
import type { OpenPage } from "@prismshadow/penguin-web/internal";

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
  const host = useContext(PageIdentity)?.sessionHost;
  const panels = useSessionWorkbenchPanels(ref?.address.machineId === null && !page.catalogDock);
  const definition = panels.find((item) => item.id === ref?.kind);
  if (
    !ref ||
    !selected ||
    !definition ||
    selected.sessionId !== sessionId ||
    ref.address.sessionId !== sessionId ||
    ref.address.projectId !== projectId ||
    (host && (host.session.sessionId !== sessionId || host.session.projectId !== projectId)) ||
    ref.address.machineId !== (host ? host.machineId : machineForSession(sessionId))
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
