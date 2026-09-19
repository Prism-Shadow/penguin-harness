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
 * - Failed: the test command failed, its output opened, and the reply that reads it.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { AssistantTextItem, ChatItem, ChatTurn, Fixtures } from "../fixtures";
import { defineModule } from "../module";
import { Turn } from "../screens/transcript";

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
  variants: [
    { key: "streaming", title: "Streaming" },
    { key: "settled", title: "Settled" },
    { key: "approval", title: "Approval" },
    { key: "failed", title: "Failed" },
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
