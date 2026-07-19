/**
 * Handoff notice for a chat created via @ delegation: the source block (<handoff_from>) isn't
 * shown verbatim, it's collapsed into a single line reading "Handed off from <agent>'s chat";
 * when there's a source Session, the whole line is clickable and jumps back to the original chat
 * (the source Session's title goes into the title hover tooltip, taking no space in the body).
 */
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import type { HandoffOrigin } from "./agent-mentions";

/** Display name of the source agent: `displayName (@id)` when the display name differs from the id, otherwise just `@id`. */
function agentLabel(origin: HandoffOrigin): string {
  return origin.agentName && origin.agentName !== origin.agentId
    ? `${origin.agentName} (@${origin.agentId})`
    : `@${origin.agentId}`;
}

export function HandoffBanner({ origin }: { origin: HandoffOrigin }) {
  const navigate = useNavigate();
  const text = S.chat.handoffFrom(agentLabel(origin));
  const frame =
    "anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400";
  // A handoff initiated from draft state has no source Session: only the origin is shown, with nowhere to jump to.
  if (!origin.sessionId) return <p className={frame}>{text}</p>;
  const sessionId = origin.sessionId;
  return (
    <button
      type="button"
      title={S.chat.handoffBack(origin.sessionTitle)}
      onClick={() => navigate(`/chat/${sessionId}`)}
      className={`${frame} transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200`}
    >
      {text}
      <span aria-hidden className="text-gray-400 dark:text-gray-500">
        →
      </span>
    </button>
  );
}
