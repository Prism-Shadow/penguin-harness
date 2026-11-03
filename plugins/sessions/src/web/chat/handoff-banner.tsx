/**
 * Provenance banners for conversations opened from another conversation — each collapses a
 * machine-inserted source block (the raw text is never shown; the model still sees it):
 * - `HandoffBanner` (`[handoff_from]`, the /agent handoff): "Handed off from <agent>'s chat";
 * - `ModelSwitchBanner` (`[model_switch_from]`, the /model command): "switched model —
 *   continued from the earlier conversation".
 * Each is one harness note (TranscriptNote): a fixed phrase, then the agent or the earlier model
 * outside it, so no theme recases a name. When there's a source Session, the whole line is a
 * button that jumps back to it, named by the old one-sentence wording (the source Session's
 * title goes into the hover tooltip, taking no space in the body).
 */
import { useNavigate } from "react-router";
import { TranscriptNote } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { HandoffOrigin, ModelSwitchOrigin } from "./agent-handoff";

/**
 * Display name of the source agent: `displayName (id)` when the display name differs from the
 * id, otherwise just the id. No `@` sigil — the mention trigger it stood for is gone (`/agent`
 * replaced it), and the composer's own handoff chip spells the agent out without one, so the
 * banner would otherwise name the same agent differently from the control that started it.
 */
function agentLabel(origin: HandoffOrigin): string {
  return origin.agentName && origin.agentName !== origin.agentId
    ? `${origin.agentName} (${origin.agentId})`
    : origin.agentId;
}

export function HandoffBanner({ origin }: { origin: HandoffOrigin }) {
  const navigate = useNavigate();
  const agent = agentLabel(origin);
  // A handoff initiated from draft state has no source Session: only the origin is shown, with nowhere to jump to.
  const sessionId = origin.sessionId;
  return (
    <TranscriptNote
      className="anim-msg my-2"
      label={S.chat.handoffLabel}
      subject={agent}
      {...(sessionId
        ? {
            action: {
              onClick: () => navigate(`/chat/${sessionId}`),
              hint: S.chat.handoffBack(origin.sessionTitle),
              name: S.chat.handoffFrom(agent),
            },
          }
        : {})}
    />
  );
}

/**
 * Notice for a conversation opened by the `/model` switch (`[model_switch_from]` first
 * message): a single line naming the previous model, clickable to jump back to the source
 * session — the same interaction as the handoff banner's back-link.
 */
export function ModelSwitchBanner({ origin }: { origin: ModelSwitchOrigin }) {
  const navigate = useNavigate();
  const sessionId = origin.sessionId;
  return (
    <TranscriptNote
      className="anim-msg my-2"
      label={S.chat.modelSwitchLabel}
      {...(origin.prevModelId ? { subject: S.chat.modelSwitchPrev(origin.prevModelId) } : {})}
      action={{
        onClick: () => navigate(`/chat/${sessionId}`),
        hint: S.chat.handoffBack(origin.sessionTitle),
        name: S.chat.modelSwitchFrom(origin.prevModelId),
      }}
    />
  );
}
