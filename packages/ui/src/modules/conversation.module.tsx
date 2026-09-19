/**
 * Conversation: the transcript of the docs-expert Task, composed from the screens' transcript
 * (`screens/transcript.tsx`, W6's chat components until they exist) over the fixture turns:
 *
 * - Streaming: the user's second prompt with its attachment, a finished work group opened on the
 *   `edit_file` diff, and the reply still arriving behind its caret;
 * - Settled: the first turn condensed to prompt, work group, the answer (a tree, a table, inline
 *   code) and the per-turn stats line;
 * - Approval: the running work group — thinking, a subagent with its row, and a command waiting
 *   for approval;
 * - Failed: the test command failed, its output opened, and the reply that reads it;
 * - Streaming reply (live): turn 2 told short, from the prompt landing to the settled stats line.
 */
import { Fragment, useState } from "react";
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
import { defineModule } from "../module";
import type { SceneSpec } from "../module";
import { at, reached, useScene } from "../scene";
import type { SceneClock } from "../scene";
import { StatsLine, Turn, UserBubble, WorkGroup } from "../screens/transcript";
import type { WorkItem } from "../screens/transcript";
import { StreamText, useFrameProgress } from "./parts";

function item<T extends ChatItem = ChatItem>(turn: ChatTurn, id: string): T {
  const found = turn.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture item ${id} is missing`);
  return found as T;
}

function Transcript({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-3xl">{children}</div>;
}

function Streaming({ f }: { f: Fixtures }) {
  const turn2 = f.session.turns[1]!;
  const reply = item<AssistantTextItem>(turn2, "tx4");
  const turn: ChatTurn = {
    index: 2,
    running: true,
    items: [
      item(turn2, "u2"),
      item(turn2, "th3"),
      item(turn2, "tc3"),
      item(turn2, "tc4"),
      { ...reply, streaming: true },
    ],
  };
  return (
    <Transcript>
      <Turn turn={turn} f={f} expansion={{ groups: new Set(["th3"]), rows: new Set(["tc4"]) }} />
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

// ---------------------------------------------------------------------------------------------
// Streaming reply (live)
// ---------------------------------------------------------------------------------------------

const LIVE_STREAM: SceneSpec = {
  frames: [
    { key: "sent", title: "Sent", hold: 900 },
    { key: "thinking", title: "Thinking", hold: 1400 },
    { key: "tools", title: "Tool calls", hold: 2400 },
    { key: "streaming", title: "Streaming", hold: 4200 },
    { key: "settled", title: "Settled", hold: 2400 },
  ],
};

/** Where the tool-call frame's two calls sit in it: the read, then the edit, as shares of it. */
const READ_DONE = 0.2;
const EDIT_START = 0.3;
const EDIT_DONE = 0.75;

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
 * How many times the clock has gone back — the loop from the last frame to the first, or a jump
 * back — so the scene can key its pieces on it and have them arrive again rather than stay put.
 */
function useSceneRun(clock: SceneClock | null): number {
  const index = clock?.index ?? 0;
  const [seen, setSeen] = useState({ index, run: 0 });
  if (index !== seen.index) setSeen({ index, run: seen.run + (index < seen.index ? 1 : 0) });
  return seen.run;
}

/**
 * The work group through the scene: a live Thinking row, then the read and the edit arriving on
 * the tool-call frame's clock, the edit's diff open while it runs. It says Done once the reply
 * starts, and folds to its summary when the turn settles.
 */
function LiveWorkGroup({ turn, f }: { turn: ChatTurn; f: Fixtures }) {
  const clock = useScene();
  const progress = useFrameProgress();
  const thinking = item<ThinkingItem>(turn, "th3");
  const read = item<ToolCallItem>(turn, "tc3");
  const edit = item<ToolCallItem>(turn, "tc4");
  const items: WorkItem[] = [];
  if (at(clock, "thinking")) {
    items.push(runningAt(thinking, progress));
  } else {
    const t = at(clock, "tools") ? progress : 1;
    items.push(thinking, t < READ_DONE ? runningAt(read, t / READ_DONE) : read);
    if (t >= EDIT_START) {
      items.push(
        t < EDIT_DONE ? runningAt(edit, (t - EDIT_START) / (EDIT_DONE - EDIT_START)) : edit,
      );
    }
  }
  return (
    <WorkGroup
      items={items}
      running={!reached(clock, "streaming")}
      expansion={{ rows: new Set([edit.id]) }}
      f={f}
      live={{ open: !reached(clock, "settled") }}
    />
  );
}

/**
 * Streaming reply: one state per frame — the prompt lands; the work group opens on a live
 * Thinking row; the read and then the edit arrive; the reply streams behind its caret; the turn
 * settles, the group folding to "Done · 2 steps" and the stats line arriving. The transcript keeps
 * its height and its tail in view, as the app follows a run, so turn 1's answer scrolls up as
 * turn 2 grows.
 */
function LiveStream({ f }: { f: Fixtures }) {
  const clock = useScene();
  const run = useSceneRun(clock);
  const [turn1, turn2] = f.session.turns;
  const { reply, stats } = f.streamedReply;
  return (
    <div className="mx-auto flex h-[36rem] max-w-3xl flex-col justify-end overflow-hidden">
      <div>
        <Turn turn={turn1!} f={f} from="tx3" />
        <Fragment key={run}>
          <div data-reveal>
            <UserBubble item={item<UserMessageItem>(turn2!, "u2")} dense={false} />
          </div>
          {reached(clock, "thinking") && <LiveWorkGroup turn={turn2!} f={f} />}
          {reached(clock, "streaming") && (
            <div className="my-3 font-sans text-base leading-relaxed text-fg [overflow-wrap:break-word]">
              <p className="leading-[1.7]">
                <StreamText text={reply.markdown} frame="streaming" />
              </p>
            </div>
          )}
          {reached(clock, "settled") && (
            <div data-reveal>
              <StatsLine stats={stats} f={f} />
            </div>
          )}
        </Fragment>
      </div>
    </div>
  );
}

const VARIANTS = {
  streaming: Streaming,
  settled: Settled,
  approval: Approval,
  failed: Failed,
  "live-stream": LiveStream,
} as const;

export const module = defineModule({
  id: "conversation",
  title: "Conversation",
  description:
    "A Task's transcript: a user message with its attachment, settled prose with a table and code, a work group with thinking and tool rows, an opened diff, a running subagent, a pending approval and the stats line.",
  width: "wide",
  variants: [
    { key: "streaming", title: "Streaming" },
    { key: "settled", title: "Settled" },
    { key: "approval", title: "Approval" },
    { key: "failed", title: "Failed" },
    { key: "live-stream", title: "Streaming reply", scene: LIVE_STREAM },
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
