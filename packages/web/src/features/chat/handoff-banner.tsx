/**
 * Provenance banners for conversations opened from another conversation — each collapses a
 * machine-inserted source block (the raw text is never shown; the model still sees it):
 * - `HandoffBanner` (`<handoff_from>`, @ delegation): "Handed off from <agent>'s chat";
 * - `ModelSwitchBanner` (`<model_switch_from>`, the /model command): "switched model —
 *   continued from the earlier conversation".
 * When there's a source Session, the whole line is clickable and jumps back to it (the
 * source Session's title goes into the title hover tooltip, taking no space in the body).
 */
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import type { HandoffOrigin, ModelSwitchOrigin } from "./agent-mentions";

/** Display name of the source agent: `displayName (@id)` when the display name differs from the id, otherwise just `@id`. */
function agentLabel(origin: HandoffOrigin): string {
  return origin.agentName && origin.agentName !== origin.agentId
    ? `${origin.agentName} (@${origin.agentId})`
    : `@${origin.agentId}`;
}

const bannerFrame =
  "anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400";

export function HandoffBanner({ origin }: { origin: HandoffOrigin }) {
  const navigate = useNavigate();
  const text = S.chat.handoffFrom(agentLabel(origin));
  // A handoff initiated from draft state has no source Session: only the origin is shown, with nowhere to jump to.
  if (!origin.sessionId) return <p className={bannerFrame}>{text}</p>;
  const sessionId = origin.sessionId;
  return (
    <button
      type="button"
      title={S.chat.handoffBack(origin.sessionTitle)}
      onClick={() => navigate(`/chat/${sessionId}`)}
      className={`${bannerFrame} transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200`}
    >
      {text}
      <span aria-hidden className="text-gray-400 dark:text-gray-500">
        →
      </span>
    </button>
  );
}

/**
 * Notice for a conversation opened by the `/model` switch (`<model_switch_from>` first
 * message): a single line naming the previous model, clickable to jump back to the source
 * session — the same interaction as the handoff banner's back-link.
 */
export function ModelSwitchBanner({ origin }: { origin: ModelSwitchOrigin }) {
  const navigate = useNavigate();
  const sessionId = origin.sessionId;
  return (
    <button
      type="button"
      title={S.chat.handoffBack(origin.sessionTitle)}
      onClick={() => navigate(`/chat/${sessionId}`)}
      className={`${bannerFrame} transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200`}
    >
      {S.chat.modelSwitchFrom(origin.prevModelId)}
      <span aria-hidden className="text-gray-400 dark:text-gray-500">
        →
      </span>
    </button>
  );
}
