/**
 * Shared "what did the user actually write" extraction for a user_text item, mirroring
 * MessageItem's parse chain (handoff / model-switch → goal → scheduled → skills →
 * attachment lines) without any rendering. Input history and the conversation outline both
 * need this reduction, and each re-implementing the chain would drift from the renderer the
 * moment a new protocol block is added — this module is the single non-rendering copy.
 */
import {
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
} from "./agent-handoff";
import { parseGoalMessage } from "./goal-use";
import { parseSkillsMessage } from "./skill-use";
import { splitAttachments } from "../../lib/attachments";

export interface UserMessageBody {
  /** What remains once protocol blocks and attachment lines are stripped: the text the user wrote (trimmed; may be empty for e.g. an image-only message). */
  body: string;
  /** Set when the message is a [goal] round re-send; round 1 carries the user's own objective, later rounds are the loop's re-injection. */
  goalRound?: number;
  /** True when the message was injected by a scheduled-task trigger rather than typed into the composer. */
  scheduled: boolean;
}

/**
 * Parses a user_text item's raw text down to the user-authored body. Returns null for
 * machine-only source blocks ([handoff_from] / [model_switch_from]) — those render as
 * banners and carry no user prose at all.
 */
export function parseUserMessageBody(raw: string): UserMessageBody | null {
  if (parseHandoffMessage(raw) || parseModelSwitchMessage(raw)) return null;
  const goal = parseGoalMessage(raw);
  const afterGoal = goal ? goal.rest : raw;
  const scheduled = parseScheduledMessage(afterGoal);
  const afterScheduled = scheduled ? scheduled.rest : afterGoal;
  const skills = parseSkillsMessage(afterScheduled);
  const { text } = splitAttachments(skills ? skills.rest : afterScheduled);
  return {
    body: text.trim(),
    ...(goal ? { goalRound: goal.round } : {}),
    scheduled: scheduled !== null,
  };
}
