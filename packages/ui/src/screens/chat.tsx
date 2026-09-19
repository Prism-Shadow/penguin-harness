/**
 * `/screens/chat` — a Task mid-run. The sidebar with the session list; the transcript scrolled
 * to its live tail: the end of turn 1's settled answer (a code block and a table), then turn 2
 * with a finished work group opened on its `edit_file` diff, and a running work group holding a
 * subagent call and a command that waits for approval; the composer with a draft and two chips;
 * and the right dock on the Subagents panel, where the reviewer's reply is still streaming.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FixtureLang, Fixtures, ToolCallItem } from "../fixtures";
import { Glyph } from "./glyph";
import { AgentTile, ChatHeader, DockFrame, GroupHeader, Sidebar, Spinner } from "./parts";
import { Composer, Turn } from "./transcript";

/**
 * A scroller that opens at its bottom: `column-reverse` starts a scroll container at its end, so
 * a server-rendered page shows the live tail without a script, the way the app follows a run.
 */
export function TailScroller({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
      <div className="px-4 py-4 md:px-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
    </div>
  );
}

export function ChatTranscript({ f }: { f: Fixtures }) {
  const [turn1, turn2] = f.session.turns;
  return (
    <TailScroller>
      <Turn turn={turn1!} f={f} from="tx3" />
      <Turn turn={turn2!} f={f} expansion={{ groups: new Set(["th3"]), rows: new Set(["tc4"]) }} />
    </TailScroller>
  );
}

function SubagentsPanel({ f }: { f: Fixtures }) {
  const call = f.session.turns[1]!.items.find(
    (i): i is ToolCallItem => i.kind === "tool_call" && i.subagent !== undefined,
  )!;
  const sub = call.subagent!;
  const mainAgent = f.agents.find((a) => a.id === f.session.agentId)!;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-3 pb-2 pt-1.5">
        <div className="mb-1.5">
          <GroupHeader label={f.copy.dock.topology} />
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-fg-muted">
            <AgentTile id={mainAgent.id} name={mainAgent.name} size={14} />
            <span className="truncate">{mainAgent.name}</span>
            <span className="font-mono text-xs text-fg-subtle">{f.session.id.slice(-6)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-accent-muted py-1 pl-6 pr-1.5 text-fg">
            <span aria-hidden className="h-px w-2 bg-line-emphasis" />
            <AgentTile id={sub.agentId} name={sub.agentName} size={14} />
            <span className="truncate font-(--ui-weight-medium)">{sub.agentName}</span>
            <span className="font-mono text-xs text-fg-subtle">{sub.shortId}</span>
            <span className="min-w-0 flex-1" />
            <span className="flex items-center gap-1 text-tone-success-fg">
              <Spinner size="xs" label={f.copy.chat.runStates.running} />
              {f.copy.dock.nodeRunning}
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-line-muted px-3 py-1.5">
        <AgentTile id={sub.agentId} name={sub.agentName} size={16} />
        <span className="min-w-0 truncate text-xs font-(--ui-weight-strong) text-fg">
          {sub.agentName}
        </span>
        <span className="shrink-0 font-mono text-xs text-fg-subtle">{sub.sessionId}</span>
        <span className="min-w-0 flex-1" />
        <span
          role="button"
          aria-label={f.copy.dock.openAsSession}
          title={f.copy.dock.openAsSession}
          className="flex h-6 w-6 items-center justify-center rounded-control text-fg-subtle hover:text-fg"
        >
          <Glyph name="message" size={13} />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="px-3 py-2 text-sm">
          <Turn
            turn={{ index: 1, running: true, items: sub.transcript }}
            f={f}
            dense
            expansion={{ groups: new Set(["sub-th1"]), rows: new Set(["sub-th1"]) }}
          />
        </div>
      </div>
    </div>
  );
}

export function ChatScreen({ lang }: { lang: FixtureLang }) {
  const f = fixturesFor(lang);
  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas text-fg">
      <Sidebar f={f} activeSessionId={f.session.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={f} dock="right" />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <ChatTranscript f={f} />
            <Composer f={f} />
          </main>
          <div className="w-[24rem] shrink-0">
            <DockFrame f={f} tab={f.copy.dock.subagents(1)} glyph="bot" edge="right">
              <SubagentsPanel f={f} />
            </DockFrame>
          </div>
        </div>
      </div>
    </div>
  );
}
