/**
 * The app window the hero shows: the session sidebar, a Task transcript and the dock, composed
 * from the same fixtures as the rest of the gallery and wired to the reader — session rows switch
 * the transcript, dock tabs switch panels, and the composer sends.
 *
 * The window is an `AppShell`, so the three themes lay its columns out themselves: Frost floats
 * the main column as a sheet on its colour field, Console rules the columns apart edge to edge,
 * Primer leaves the classes as they are. Widths come from container queries rather than the
 * viewport, because the gallery previews the same composition inside a 390 px frame: below the
 * `@3xl` mark the window is one column, the sidebar steps out and the dock becomes a bottom strip.
 *
 * Pieces that carry a style hook take the name of the component they imitate — `ComposerCard`,
 * `DockFrame`, `DockTabs`, `SubagentsPanel` — because a hook belongs to its host (hooks.ts).
 */
import { Fragment } from "react";
import type {
  ChatItem,
  ChatTurn,
  FileNode,
  Fixtures,
  SessionListItem,
  SubagentRef,
  ThinkingItem,
  ToolCallItem,
  UserMessageItem,
} from "../fixtures";
import {
  arriving,
  Field,
  GlyphIcon,
  Heading,
  IconButton,
  RunSpinner,
  Select,
  StatusWord,
  StreamText,
  Text,
  treeInset,
  useFrameProgress,
} from "../modules/parts";
import type { IconName } from "../modules/parts";
import { at, reached, useScene } from "../scene";
import { bytes, duration, tokens, usd } from "../screens/format";
import { AgentTile, AppShell, NEUTRAL_FILL, SidebarBody, StatChip } from "../screens/parts";
import {
  ComposerToolbar,
  StatsLine,
  StopButton,
  Turn,
  UserBubble,
  WorkGroup,
} from "../screens/transcript";
import type { WorkItem } from "../screens/transcript";
import { heroComposer, heroTurn, useTypedPrompt } from "./scene";
import type { HeroDrive } from "./scene";

/** An item of the fixture story by its id; the dataset is fixed, so a miss is a bug. */
function turnItem<T extends ChatItem = ChatItem>(turn: ChatTurn, id: string): T {
  const found = turn.items.find((item) => item.id === id);
  if (!found) throw new Error(`fixture item ${id} is missing`);
  return found as T;
}

/** The prompt the scene types and sends: turn 2's, the one the open Task is answering. */
function scenePrompt(f: Fixtures): string {
  return turnItem<UserMessageItem>(f.session.turns[1]!, "u2").text;
}

/** The child Session turn 2 starts, which the dock's first panel follows. */
function subagentOf(f: Fixtures): SubagentRef {
  const call = f.session.turns[1]!.items.find(
    (item): item is ToolCallItem => item.kind === "tool_call" && item.subagent !== undefined,
  );
  if (!call?.subagent) throw new Error("fixture subagent is missing");
  return call.subagent;
}

/** A settled step shown mid-run: running, its live clock at `share` of the time it settles on. */
function runningAt<T extends WorkItem>(step: T, share: number): T {
  return {
    ...step,
    state: "running",
    durationMs: undefined,
    elapsedMs: Math.min(1, Math.max(0, share)) * (step.durationMs ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------
// The navigation column
// ---------------------------------------------------------------------------------------------

/**
 * The session sidebar: the app's own (screens/parts.tsx), its rows opening their Session. It steps
 * out below the `@3xl` mark rather than folding to the icon rail: at phone width the window is one
 * column, and the rail would be a second one.
 */
function HeroSidebar({
  f,
  sessions,
  open,
  running,
  drive,
}: {
  f: Fixtures;
  sessions: readonly SessionListItem[];
  /** Which row reads as the open one; -1 when no Session is open yet. */
  open: number;
  running: boolean;
  drive: HeroDrive;
}) {
  const group = f.sessionGroups[0];
  // Only the open row's Task runs, and only while the scene has it running.
  const items = sessions.map((item, index) => ({ ...item, running: index === open && running }));
  return (
    <aside
      data-slot="nav"
      className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface-muted @3xl:flex"
    >
      <SidebarBody
        f={f}
        activeSessionId={sessions[open]?.id}
        groups={group ? [{ ...group, items }] : []}
        onOpenSession={(id) => drive.openSession(sessions.findIndex((item) => item.id === id))}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// The main column
// ---------------------------------------------------------------------------------------------

/** The chat's toolbar as the app draws it: the title, a running Task's hourglass, the totals. */
function ChatHead({ f, title, running }: { f: Fixtures; title: string; running: boolean }) {
  const s = f.session;
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
      <span className="min-w-0 truncate text-sm font-(--ui-weight-strong) text-fg">{title}</span>
      {running && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
          <span className="text-tone-attention-fg">
            <GlyphIcon name="hourglass" size={12} />
          </span>
          {f.copy.chat.runStates.running}
        </span>
      )}
      <span className="min-w-0 flex-1" />
      <span className="hidden h-7 shrink-0 items-center gap-3 px-2 text-fg-muted @2xl:flex">
        <StatChip glyph="tokens" value={tokens(s.totals.tokens)} />
        <StatChip glyph="cost" value={usd(s.totals.costUsd)} />
        <StatChip glyph="clock" value={duration(s.totals.elapsedMs)} />
      </span>
    </header>
  );
}

/** Where the work group's steps sit inside the working frame, as shares of it. */
const THINK_DONE = 0.25;
const READ_DONE = 0.45;
const EDIT_START = 0.5;
const EDIT_DONE = 0.9;

/**
 * The work group through the scene: a live Thinking row, then the read and the edit arriving on
 * the working frame's clock. It says Done once the reply starts, and folds to its summary when
 * the turn settles.
 */
function HeroWork({ f, turn }: { f: Fixtures; turn: ChatTurn }) {
  const clock = useScene();
  const progress = useFrameProgress();
  const thinking = turnItem<ThinkingItem>(turn, "th3");
  const read = turnItem<ToolCallItem>(turn, "tc3");
  const edit = turnItem<ToolCallItem>(turn, "tc4");
  const share = at(clock, "working") ? progress : 1;
  const items: WorkItem[] = [];
  if (share < THINK_DONE) {
    items.push(runningAt(thinking, share / THINK_DONE));
  } else {
    items.push(thinking, share < READ_DONE ? runningAt(read, share / READ_DONE) : read);
    if (share >= EDIT_START) {
      items.push(
        share < EDIT_DONE ? runningAt(edit, (share - EDIT_START) / (EDIT_DONE - EDIT_START)) : edit,
      );
    }
  }
  return (
    <WorkGroup
      items={items}
      running={!reached(clock, "answer")}
      expansion={{}}
      f={f}
      live={{ open: !reached(clock, "settled") }}
    />
  );
}

/**
 * The open Session as the scene tells it: turn 1 settled on its answer, then turn 2 arriving —
 * the prompt lands, the work group runs, the reply streams and the stats line closes it. The
 * prompt is the reader's own once they have sent one.
 */
function TaskReading({ f, drive }: { f: Fixtures; drive: HeroDrive }) {
  const clock = useScene();
  const [turn1, turn2] = f.session.turns;
  const phase = heroTurn(clock);
  const { reply, stats } = f.streamedReply;
  return (
    <>
      <Turn turn={turn1!} f={f} from="tx3" dense />
      {phase !== "none" && (
        <>
          <div data-reveal={arriving(clock, "working")}>
            <UserBubble item={{ text: drive.sent ?? scenePrompt(f) }} dense />
          </div>
          <HeroWork f={f} turn={turn2!} />
          {reached(clock, "answer") && (
            <p className="my-3 font-sans text-sm leading-relaxed text-fg [overflow-wrap:break-word]">
              <StreamText text={reply.markdown} frame="answer" />
            </p>
          )}
          {phase === "settled" && (
            <div data-reveal={arriving(clock, "settled")}>
              <StatsLine stats={stats} f={f} />
            </div>
          )}
        </>
      )}
    </>
  );
}

/** The second row's Session: the citation test run against a file renamed upstream, and the fix. */
function FailedReading({ f }: { f: Fixtures }) {
  const turn2 = f.session.turns[1]!;
  const run = f.failedRun;
  const turn: ChatTurn = {
    index: 2,
    running: false,
    items: [turnItem(turn2, "u2"), turnItem(turn2, "th3"), run.call, run.reply],
    stats: run.stats,
  };
  return <Turn turn={turn} f={f} dense />;
}

/** The third row's Session: the reviewer's own, which the docs Agent started as a subagent. */
function ReviewReading({ f }: { f: Fixtures }) {
  const sub = subagentOf(f);
  return <Turn turn={{ index: 1, running: sub.running, items: sub.transcript }} f={f} dense />;
}

/**
 * Three prepared readings behind the sidebar's three rows: the open Task, the run that failed and
 * the reviewer's child Session. Only the first follows the scene; the other two are settled,
 * which is where a reader who picked a row has already put the mock.
 */
function Reading({ f, drive }: { f: Fixtures; drive: HeroDrive }) {
  if (drive.session === 1) return <FailedReading f={f} />;
  if (drive.session >= 2) return <ReviewReading f={f} />;
  return <TaskReading f={f} drive={drive} />;
}

/**
 * The composer, with a real input: the scene types its prompt into it, and a reader can write
 * their own over it and send. Sending starts the scripted reply (hero/scene.ts).
 */
function ComposerCard({ f, drive }: { f: Fixtures; drive: HeroDrive }) {
  const clock = useScene();
  const c = f.copy.chat;
  const state = heroComposer(clock, drive);
  const typed = useTypedPrompt(scenePrompt(f));
  const value = state === "running" ? "" : state === "typing" ? typed : drive.draft;
  return (
    <div className="shrink-0 border-t border-line px-3 py-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          drive.send(value);
        }}
        className="ui-glass @container rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2 focus-within:border-accent focus-within:[box-shadow:var(--ui-focus-ring-input)]"
      >
        {/* The card wears the focus ring, as every other control in the set does. */}
        <input
          type="text"
          value={value}
          onChange={(event) => drive.write(event.target.value)}
          placeholder={c.inputPlaceholder}
          aria-label={c.inputPlaceholder}
          className="w-full min-w-0 bg-transparent px-1 py-0.5 font-sans text-base leading-6 text-fg outline-none placeholder:text-fg-subtle"
        />
        <ComposerToolbar
          f={f}
          send={
            state === "running" ? (
              <StopButton f={f} />
            ) : (
              <button
                type="submit"
                aria-label={c.send}
                title={c.send}
                aria-disabled={value === "" || undefined}
                className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
                  value === "" ? `${NEUTRAL_FILL} text-fg-subtle` : "bg-accent text-accent-fg"
                }`}
              >
                <GlyphIcon name="arrowUp" size={17} />
              </button>
            )
          }
        />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The dock
// ---------------------------------------------------------------------------------------------

/**
 * The call graph, as a tree: the Session's own Agent, and the child it started under it. The
 * child arrives with the working frame, which is the dock filling as the Task runs.
 */
function SubagentsPanel({ f }: { f: Fixtures }) {
  const clock = useScene();
  const sub = subagentOf(f);
  const main = f.agents.find((agent) => agent.id === f.session.agentId)!;
  const started = reached(clock, "working");
  const done = reached(clock, "settled");
  const reply = sub.transcript.find((item) => item.kind === "text");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2 px-3 py-2">
      <Text variant="eyebrow">{f.copy.dock.topology}</Text>
      <ul className="ui-tree grid grid-cols-[minmax(0,1fr)] gap-px">
        <li
          data-depth={0}
          style={{ paddingLeft: treeInset(0) }}
          className="flex h-7 items-center gap-2 pr-1 text-xs text-fg-muted"
        >
          <AgentTile id={main.id} name={main.name} />
          <span className="min-w-0 flex-1 truncate">{main.name}</span>
          <span className="shrink-0 font-mono text-fg-subtle">{f.session.id.slice(-6)}</span>
        </li>
        {started && (
          <li
            data-depth={1}
            data-last="true"
            data-reveal={arriving(clock, "working")}
            style={{ paddingLeft: treeInset(1) }}
            className="flex h-7 items-center gap-2 rounded-md bg-accent-muted pr-1 text-xs text-fg"
          >
            <AgentTile id={sub.agentId} name={sub.agentName} />
            <span className="min-w-0 flex-1 truncate font-(--ui-weight-medium)">
              {sub.agentName}
            </span>
            {done ? (
              <StatusWord tone="success" icon="circleCheck">
                {f.copy.dock.nodeDone}
              </StatusWord>
            ) : (
              <RunSpinner label={f.copy.chat.runStates.running} />
            )}
          </li>
        )}
      </ul>
      {started && reply?.kind === "text" && (
        <p
          data-reveal={arriving(clock, "working")}
          className="line-clamp-4 font-sans text-xs leading-relaxed text-fg-muted [overflow-wrap:break-word]"
        >
          {reply.markdown}
        </p>
      )}
    </div>
  );
}

/** What the turn cost, as the Trajectories panel reads it off the Trace. */
function TrajectoryPanel({ f }: { f: Fixtures }) {
  const t = f.copy.traces;
  const s = f.streamedReply.stats;
  const rows: readonly (readonly [string, string])[] = [
    [t.toolCalls, String(s.toolCalls)],
    [t.inputTokens, tokens(s.inputTokens)],
    [t.cacheHits, tokens(s.cacheReadTokens)],
    [t.outputTokens, tokens(s.outputTokens)],
    [t.cost, usd(s.costUsd)],
    [t.elapsed, duration(s.elapsedMs)],
  ];
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] content-start gap-x-3 gap-y-1.5 px-3 py-2 text-xs">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="min-w-0 truncate text-fg-muted">{label}</dt>
          <dd className="text-right font-mono tabular-nums text-fg">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Every file this Session changed, which the Files panel marks added or modified. */
function changedFiles(node: FileNode): FileNode[] {
  if (node.kind === "file") return node.change === undefined ? [] : [node];
  return (node.children ?? []).flatMap(changedFiles);
}

function FilesPanel({ f }: { f: Fixtures }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] content-start gap-px px-2 py-2">
      {changedFiles(f.fileTree).map((file) => (
        <li key={file.path} className="flex h-7 items-center gap-1.5 rounded-sm px-1 text-xs">
          <GlyphIcon name="file" size={13} className="text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate text-fg">{file.name}</span>
          <span
            title={file.change === "added" ? f.copy.files.added : f.copy.files.modified}
            className={`shrink-0 font-mono ${
              file.change === "added" ? "text-tone-success-fg" : "text-tone-attention-fg"
            }`}
          >
            {file.change === "added" ? "A" : "M"}
          </span>
          <span className="shrink-0 tabular-nums text-fg-subtle">{bytes(file.sizeBytes ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A panel by its place in the tab row, which is the order the panel menu lists them in. */
function DockPanel({ f, open }: { f: Fixtures; open: number }) {
  if (open === 1) return <TrajectoryPanel f={f} />;
  if (open >= 2) return <FilesPanel f={f} />;
  return <SubagentsPanel f={f} />;
}

function DockTabs({
  panels,
  open,
  drive,
}: {
  panels: readonly { icon: IconName; label: string }[];
  open: number;
  drive: HeroDrive;
}) {
  return (
    <span role="tablist" className="flex min-w-0 items-center gap-1">
      {panels.map((panel, index) => (
        <button
          key={panel.label}
          type="button"
          role="tab"
          aria-selected={index === open}
          onClick={() => drive.openPanel(index)}
          className={`flex h-7 min-w-0 items-center gap-1.5 rounded-control px-2 text-xs transition-colors duration-150 ${
            index === open ? "bg-accent-muted text-fg" : "text-fg-muted"
          }`}
        >
          {/* The label names the panel, so the glyph only decorates it and a theme may drop it. */}
          <GlyphIcon name={panel.icon} size={13} decor="nav" />
          <span className="truncate">{panel.label}</span>
        </button>
      ))}
    </span>
  );
}

function DockFrame({ f, drive }: { f: Fixtures; drive: HeroDrive }) {
  const panels = f.menus.panels
    .flatMap((entry) => (entry === "separator" ? [] : [entry]))
    .slice(0, 3);
  const open = Math.min(Math.max(0, drive.panel), panels.length - 1);
  return (
    <section
      data-slot="dock"
      className="ui-frame flex h-40 shrink-0 flex-col border-t border-line bg-canvas @3xl:h-auto @3xl:w-64 @3xl:border-t-0 @3xl:border-l"
    >
      <div
        data-slot="head"
        className="flex shrink-0 items-center gap-1 border-b border-line px-1.5 py-1.5"
      >
        <DockTabs panels={panels} open={open} drive={drive} />
        <span className="min-w-0 flex-1" />
        <IconButton label={f.copy.dock.hideDock} icon="cross" size="sm" />
      </div>
      <div data-slot="body" className="min-h-0 flex-1 overflow-hidden">
        <DockPanel f={f} open={open} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The two windows
// ---------------------------------------------------------------------------------------------

const FRAME =
  "flex h-[30rem] flex-col overflow-hidden rounded-lg border border-line bg-canvas @3xl:h-[34rem] @3xl:flex-row";

/** The window with a Task in it: what the scene plays, and what a reader drives. */
export function HeroWindow({ f, drive }: { f: Fixtures; drive: HeroDrive }) {
  const clock = useScene();
  const sessions = f.sessionGroups[0]?.items ?? [];
  const open = Math.min(Math.max(0, drive.session), Math.max(0, sessions.length - 1));
  const phase = heroTurn(clock);
  const running = open === 0 && (phase === "working" || phase === "answering");
  return (
    <AppShell className={FRAME}>
      <HeroSidebar f={f} sessions={sessions} open={open} running={running} drive={drive} />
      <div data-slot="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHead f={f} title={sessions[open]?.title ?? f.session.title} running={running} />
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 @2xl:px-6">
          <div>
            <Reading f={f} drive={drive} />
          </div>
        </div>
        <ComposerCard f={f} drive={drive} />
      </div>
      <DockFrame f={f} drive={drive} />
    </AppShell>
  );
}

/**
 * The window before a Session exists: an empty list, the two prompts the product offers, and the
 * picks a first Task starts on. The labelled rows are where the themes' form layouts show —
 * Primer's label above a full-width control, Frost's roomier, Console's in a fixed label column.
 */
export function HeroStart({ f, drive }: { f: Fixtures; drive: HeroDrive }) {
  const model = f.models.find((candidate) => candidate.modelId === f.session.model.modelId);
  const skill = f.plugins.find((plugin) => plugin.enabled);
  return (
    <AppShell className={FRAME}>
      <HeroSidebar f={f} sessions={[]} open={-1} running={false} drive={drive} />
      <div data-slot="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHead f={f} title={f.copy.nav.newChat} running={false} />
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 px-6 text-center">
          <Heading level={4}>{f.hero.empty.title}</Heading>
          <p className="mx-auto max-w-sm font-sans text-sm leading-relaxed text-fg-muted">
            {f.hero.empty.body}
          </p>
          <div className="mx-auto grid w-full max-w-md grid-cols-[minmax(0,1fr)] gap-2">
            {f.hero.empty.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => drive.write(example)}
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-sm text-fg-muted transition-colors duration-150"
              >
                <GlyphIcon name="sparkle" size={13} decor="empty" className="text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{example}</span>
              </button>
            ))}
          </div>
          <div className="mx-auto grid w-full max-w-md grid-cols-[minmax(0,1fr)] gap-3 text-left @2xl:grid-cols-2">
            <Field label={f.forms.search.label}>
              <Select value={model?.displayName ?? f.session.model.modelId} />
            </Field>
            <Field label={f.copy.chat.skills}>
              <Select value={skill?.name ?? f.copy.chat.skills} />
            </Field>
          </div>
        </div>
        <ComposerCard f={f} drive={drive} />
      </div>
    </AppShell>
  );
}
