/**
 * Conversation: the transcript of the docs-expert Task, composed from the screens' transcript
 * (`screens/transcript.tsx`, W6's chat components until they exist) over the fixture turns:
 *
 * - Streaming: the user's second prompt with its attachment, a finished work group opened on the
 *   `edit_file` diff, and the reply still arriving behind its caret — the state its scene plays
 *   turn 2 into, a frame at a time, from the prompt landing;
 * - Settled: the first turn condensed to prompt, work group, the answer (a tree, a table, inline
 *   code) and the per-turn stats line;
 * - Approval: the running work group — thinking, a subagent with its row, and a command waiting
 *   for approval;
 * - Failed: the test command failed, its output opened, and the reply that reads it.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type {
  AssistantTextItem,
  ChatItem,
  ChatTurn,
  Fixtures,
  ThinkingItem,
  ToolCallItem,
  UserMessageItem,
} from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import type { SceneSpec } from "../module";
import { at, reached, useScene } from "../scene";
import { StreamedProse } from "../screens/markdown";
import { Turn, UserBubble, WorkGroup } from "../screens/transcript";
import type { Expansion, WorkItem } from "../screens/transcript";
import { StreamText, useFrameProgress } from "./parts";

function item<T extends ChatItem = ChatItem>(turn: ChatTurn, id: string): T {
  const found = turn.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture item ${id} is missing`);
  return found as T;
}

function Transcript({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-3xl">{children}</div>;
}

/** The scene's frames, from the prompt landing to the reply arriving behind its caret. */
const STREAM: SceneSpec = {
  frames: [
    { key: "sent", title: "Sent", hold: 900 },
    { key: "thinking", title: "Thinking", hold: 1400 },
    { key: "tools", title: "Tool calls", hold: 2400 },
    { key: "streaming", title: "Streaming", hold: 4200 },
  ],
};

/** Where the tool-call frame's two calls sit in it: the read, then the edit, as shares of it. */
const READ_DONE = 0.2;
const EDIT_START = 0.3;
const EDIT_DONE = 0.75;

/** What the group shows open: the thinking row leads it, the edit row shows its diff. */
const STREAM_EXPANSION: Expansion = { groups: new Set(["th3"]), rows: new Set(["tc4"]) };

/** A settled step shown mid-run: running, its live clock at `share` of the time it settles on. */
function runningAt<T extends WorkItem>(step: T, share: number): T {
  return {
    ...step,
    state: "running",
    durationMs: undefined,
    elapsedMs: Math.min(1, share) * (step.durationMs ?? 0),
  };
}

/**
 * The work group through the scene: a live Thinking row, then the read and the edit arriving on
 * the tool-call frame's clock, the edit's diff open while it runs. Once the reply starts it is
 * the settled group the variant draws when nothing is playing.
 */
function StreamWorkGroup({ turn, f }: { turn: ChatTurn; f: Fixtures }) {
  const clock = useScene();
  const progress = useFrameProgress();
  const thinking = item<ThinkingItem>(turn, "th3");
  const read = item<ToolCallItem>(turn, "tc3");
  const edit = item<ToolCallItem>(turn, "tc4");
  if (reached(clock, "streaming")) {
    return (
      <WorkGroup
        items={[thinking, read, edit]}
        running={false}
        expansion={STREAM_EXPANSION}
        f={f}
      />
    );
  }
  const items: WorkItem[] = [];
  if (at(clock, "thinking")) {
    items.push(runningAt(thinking, progress));
  } else {
    items.push(thinking, progress < READ_DONE ? runningAt(read, progress / READ_DONE) : read);
    if (progress >= EDIT_START) {
      items.push(
        progress < EDIT_DONE
          ? runningAt(edit, (progress - EDIT_START) / (EDIT_DONE - EDIT_START))
          : edit,
      );
    }
  }
  return (
    <WorkGroup items={items} running expansion={STREAM_EXPANSION} f={f} live={{ open: true }} />
  );
}

/**
 * Streaming: one state per frame — the prompt lands; the work group opens on a live Thinking row;
 * the read and then the edit arrive; the reply streams behind its caret and, by the end of the
 * frame, stands as the settled reply this variant shows when nothing is playing.
 */
function Streaming({ f }: { f: Fixtures }) {
  const clock = useScene();
  const turn2 = f.session.turns[1]!;
  const reply = item<AssistantTextItem>(turn2, "tx4");
  return (
    <Transcript>
      <UserBubble item={item<UserMessageItem>(turn2, "u2")} dense={false} />
      {reached(clock, "thinking") && <StreamWorkGroup turn={turn2} f={f} />}
      {reached(clock, "streaming") && (
        <div className="my-3">
          <StreamedProse>
            <StreamText text={reply.markdown} frame="streaming" />
          </StreamedProse>
        </div>
      )}
    </Transcript>
  );
}

function Settled({ f }: { f: Fixtures }) {
  const turn1 = f.session.turns[0]!;
  const turn: ChatTurn = {
    ...turn1,
    items: ["u1", "th1", "tc1", "th2", "tc2", "tx3"].map((id) => item(turn1, id)),
  };
  return (
    <Transcript>
      <Turn turn={turn} f={f} />
    </Transcript>
  );
}

function Approval({ f }: { f: Fixtures }) {
  return (
    <Transcript>
      <Turn turn={f.session.turns[1]!} f={f} from="tx4" />
    </Transcript>
  );
}

function Failed({ f }: { f: Fixtures }) {
  const turn2 = f.session.turns[1]!;
  const run = f.failedRun;
  const turn: ChatTurn = {
    index: 2,
    running: false,
    items: [item(turn2, "u2"), item(turn2, "th3"), item(turn2, "tc4"), run.call, run.reply],
    stats: run.stats,
  };
  return (
    <Transcript>
      <Turn turn={turn} f={f} expansion={{ groups: new Set(["th3"]), rows: new Set(["tc7"]) }} />
    </Transcript>
  );
}

const VARIANTS = {
  streaming: Streaming,
  settled: Settled,
  approval: Approval,
  failed: Failed,
} as const;

export const module = defineModule({
  id: "conversation",
  title: "Conversation",
  description:
    "A Task's transcript: a user message with its attachment, settled prose with a table and code, a work group with thinking and tool rows, an opened diff, a running subagent, a pending approval and the stats line.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "streaming", title: "Streaming", kind: "animated", scene: STREAM },
    { key: "settled", title: "Settled", kind: "static" },
    { key: "approval", title: "Approval", kind: "static" },
    { key: "failed", title: "Failed", kind: "static" },
  ],
  parts: [
    "chat-message-bubble",
    "chat-assistant-text",
    "chat-work-group",
    "chat-tool-call-card",
    "chat-approval",
    "chat-subagent-chip",
    "chat-task-stats-line",
    "chat-changes-card",
    "layout-disclosure-row",
    "icons-status-icon",
    "icons-avatars",
    "content-prose",
    "content-code-block",
    "content-diff-viewer",
    "data-stat-chip",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Streaming;
    return <View f={fixturesFor(lang)} />;
  },
});
