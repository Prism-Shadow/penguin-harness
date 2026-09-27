/**
 * The conversation panel's model: which conversation it shows, what the author is
 * pointing at, and how that is said to the agent.
 *
 * A conversation is an assist run (see the server's `assist.ts`): the first message starts
 * a run whose Session carries the rest. So the panel needs no store of its own. The newest
 * assist run with a Session is the conversation to resume, and "New conversation" just
 * stops following it until the next message starts another.
 */
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { SceneAssetSelection } from "./scene-asset-tree";
import type { WorkspaceSection } from "./workspace-model";

/** What the author has open, in the shape the assist route takes. */
export interface AssistFocus {
  section: WorkspaceSection;
  sceneId?: string;
  assetKey?: string;
  language?: string;
}

/** Every conversation about this activity that can be resumed, newest first. */
export function conversationThreads(runs: readonly ActivityRunSummary[]): ActivityRunSummary[] {
  return runs
    .filter((run) => run.kind === "assist" && !!run.sessionId)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
}

/** The newest conversation about this activity that can be resumed, if there is one. */
export function latestConversation(runs: readonly ActivityRunSummary[]): ActivityRunSummary | null {
  let newest: ActivityRunSummary | null = null;
  for (const run of runs)
    if (run.kind === "assist" && run.sessionId && (!newest || run.createdAt > newest.createdAt))
      newest = run;
  return newest;
}

/**
 * The focus for what the main panel shows. An asset counts only while the scenes section is
 * showing it, the same rule the tree uses to mark the current row.
 */
export function focusFor(
  section: WorkspaceSection,
  selection: SceneAssetSelection | null,
  language: string,
): AssistFocus {
  // Making a new ref reviews this ref's media; the agent knows that part as the scenes.
  if (section === "newRef") return { section: "scenes" };
  // Deploying ships the module; the agent knows that part as the module.
  if (section === "deploy") return { section: "module" };
  if (section === "scenes" && selection)
    return {
      section,
      ...(selection.sceneId ? { sceneId: selection.sceneId } : {}),
      assetKey: selection.key,
      language,
    };
  return { section };
}

/** The focus in the author's words, for the chip above the composer. */
export function focusLabel(focus: AssistFocus | null): string {
  const words = S.activities.studioConversation;
  if (!focus) return words.wholeActivity;
  if (focus.assetKey) return words.asset(focus.assetKey, focus.sceneId ?? null);
  if (focus.sceneId) return words.scene(focus.sceneId);
  return S.activities.sectionNames[focus.section];
}

/** Two focuses are the same place. */
export function sameFocus(left: AssistFocus | null, right: AssistFocus | null): boolean {
  return (
    left?.section === right?.section &&
    left?.sceneId === right?.sceneId &&
    left?.assetKey === right?.assetKey &&
    left?.language === right?.language
  );
}

/**
 * A follow-up's text. The first message tells the agent where the author is; a follow-up
 * does so again only after the author has moved, so a conversation that stays on one asset
 * reads as a conversation.
 */
export function followUpText(
  message: string,
  focus: AssistFocus | null,
  lastSent: AssistFocus | null,
): string {
  return sameFocus(focus, lastSent)
    ? message
    : `${message}\n\n${S.activities.studioConversation.movedTo(focusLabel(focus))}`;
}
