/**
 * The chat route: the conversation page, unless the routed Session is a surface Session —
 * one a plugin renders (SessionInfo.surface) — in which case its surface's page is what
 * the route shows. Decided from the Session list, which is what the sidebar decided from;
 * a Session the list has not resolved yet renders as a conversation until it has.
 */
import { useParams } from "react-router";
import { useSessions } from "../../state/sessions";
import { ChatPage } from "./chat-page";
import { SurfaceSessionPage } from "./session-surface-view";

export function ChatRoute() {
  const { sessionId } = useParams();
  const { sessions } = useSessions();
  const listed = sessionId ? sessions.find((s) => s.sessionId === sessionId) : undefined;
  if (listed !== undefined && listed.surface !== undefined) {
    return <SurfaceSessionPage key={listed.sessionId} session={listed} />;
  }
  return <ChatPage />;
}
