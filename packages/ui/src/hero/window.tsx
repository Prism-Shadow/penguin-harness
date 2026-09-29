/**
 * The app window a reader can use: the sidebar, the main column and the dock, at the app's own
 * proportions, composed from the same fixtures and parts as the rest of the gallery.
 *
 * - The sidebar's page entries switch the main column between the chat and the product's pages
 *   (hero/pages.tsx), and the user row at its foot opens Settings;
 * - session rows open their Session's transcript;
 * - the collapse button folds the sidebar to the icon rail, and the rail's expand button opens it;
 * - the composer takes typing and sends, which plays the scripted reply (hero/scene.ts);
 * - the dock's tabs switch panels, and the model trigger opens the model picker.
 *
 * All of it is local state (hero/shell.ts); nothing moves until the reader sends.
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
import { Fragment, useReducer, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type {
  ChatItem,
  ChatTurn,
  FileNode,
  FixtureLang,
  Fixtures,
  SessionListItem,
  SubagentRef,
  ThinkingItem,
  ToolCallItem,
  UserMessageItem,
} from "../fixtures";
import { module as composer } from "../modules/composer.module";
import {
  arriving,
  Field,
  GlyphIcon,
  Heading,
  IconButton,
  Presence,
  RunSpinner,
  Select,
  StatusWord,
  StreamText,
  Text,
  Tooltip,
  treeInset,
  useFrameProgress,
} from "../modules/parts";
import type { IconName } from "../modules/parts";
import { at, reached, SceneContext, SceneControlsContext, useScene } from "../scene";
import { bytes, duration, tokens, usd } from "../screens/format";
import {
  AgentTile,
  AppShell,
  NEUTRAL_FILL,
  RailBody,
  SidebarBody,
  StatChip,
} from "../screens/parts";
import type { SidebarPage } from "../screens/parts";
import {
  ComposerToolbar,
  StatsLine,
  StopButton,
  ToolbarTrigger,
  Turn,
  UserBubble,
  WorkGroup,
} from "../screens/transcript";
import type { WorkItem } from "../screens/transcript";
import type { ThemeModeName } from "../tokens";
import { ShellPageView } from "./pages";
import { heroComposer, heroTurn, useReplyClock } from "./scene";
import { SHELL_START, shellReducer } from "./shell";
import type { ShellAction, ShellPage, ShellState } from "./shell";

/** The reader's hold on the window: the state, the moves, and send, which also starts the reply. */
interface Drive {
  shell: ShellState;
  dispatch: (action: ShellAction) => void;
  send: (prompt: string) => void;
}

/** An item of the fixture story by its id; the dataset is fixed, so a miss is a bug. */
function turnItem<T extends ChatItem = ChatItem>(turn: ChatTurn, id: string): T {
  const found = turn.items.find((item) => item.id === id);
  if (!found) throw new Error(`fixture item ${id} is missing`);
  return found as T;
}

/** The prompt of turn 2, the one the open Task is answering. */
function storyPrompt(f: Fixtures): string {
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
 * Where a sidebar or rail entry goes: New chat to the chat, a page entry to its page. The app's
 * New chat opens an empty Session; here it returns to the chat, which is the one the window has.
 */
function pageOf(entry: SidebarPage | "new-chat"): ShellPage {
  return entry === "new-chat" ? "chat" : entry;
}

/**
 * The session sidebar, or the icon rail it folds to. The column's width moves through
 * `data-layout-motion` while the rail comes and goes; the sidebar's contents are laid out at their
 * own width and clipped by the column, so the widening column uncovers them rather than reflowing
 * them. It steps out below the `@3xl` mark: at phone width the window is one column, and the rail
 * would be a second one.
 *
 * The user row at the sidebar's foot and the avatar at the rail's open Settings, as they do in
 * the app. Neither piece takes a handler for it, so the column reads a click that lands inside
 * the last child of either — that row, that avatar.
 *
 * The pointer is local state too: a session row under it shows its actions, and a rail icon
 * under it its tooltip. The column clips only while it holds the sidebar, whose width it
 * uncovers; folded to the rail it lets the tooltip hang over the main column.
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
  /** Which row reads as the open one; -1 when no Session is open. */
  open: number;
  running: boolean;
  drive: Drive;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [hoveredRow, setHoveredRow] = useState<string>();
  const [hoveredEntry, setHoveredEntry] = useState<SidebarPage>();
  const { shell, dispatch } = drive;
  const collapsed = shell.collapsed;
  const group = f.sessionGroups[0];
  // Only the open row's Task runs, and only while its reply plays.
  const items = sessions.map((item, index) => ({ ...item, running: index === open && running }));
  const page = shell.page === "chat" || shell.page === "settings" ? undefined : shell.page;
  const navigate = (entry: SidebarPage | "new-chat") =>
    dispatch({ type: "page", page: pageOf(entry) });
  // A column that folds or unfolds under the pointer never sends the leave of what it unmounts.
  const fold = (next: boolean) => {
    setHoveredRow(undefined);
    setHoveredEntry(undefined);
    dispatch({ type: "collapse", collapsed: next });
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const foot = body.current?.lastElementChild;
    if (event.target instanceof Node && foot?.contains(event.target)) {
      dispatch({ type: "page", page: "settings" });
    }
  };
  return (
    <aside
      data-slot="nav"
      data-layout-motion
      onClick={onClick}
      className={`relative hidden shrink-0 flex-col border-r border-line bg-surface-muted @3xl:flex ${
        collapsed ? "w-12" : "w-72 overflow-hidden"
      }`}
    >
      {!collapsed && (
        <div ref={body} className="absolute inset-y-0 left-0 flex w-72 flex-col">
          <SidebarBody
            f={f}
            activePage={page}
            activeSessionId={shell.page === "chat" ? sessions[open]?.id : undefined}
            groups={group ? [{ ...group, items }] : []}
            onOpenSession={(id) =>
              dispatch({ type: "session", index: sessions.findIndex((item) => item.id === id) })
            }
            hoveredSessionId={hoveredRow}
            onHoverSession={setHoveredRow}
            onCollapse={() => fold(true)}
            onNavigate={navigate}
          />
        </div>
      )}
      <Presence
        show={collapsed}
        side="left"
        className="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 py-2"
      >
        <div ref={collapsed ? body : undefined} className="contents">
          <RailBody
            f={f}
            activePage={page}
            hovered={hoveredEntry}
            onHoverEntry={setHoveredEntry}
            onExpand={() => fold(false)}
            onNavigate={navigate}
            renderEntry={(node, entry) => (
              <>
                {node}
                <span className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2">
                  <Presence show={entry === hoveredEntry} side="left" as="span" className="block">
                    <Tooltip label={f.copy.nav[entry]} />
                  </Presence>
                </span>
              </>
            )}
          />
        </div>
      </Presence>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// The chat
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
 * The work group through the reply: a live Thinking row, then the read and the edit arriving on
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
 * The open Session: turn 1 settled on its answer, then turn 2 — the prompt, the work group, the
 * reply and the stats line. At rest it is the story's own finished turn; once the reader sends,
 * the prompt is theirs and the rest plays in again.
 */
function TaskReading({ f, drive }: { f: Fixtures; drive: Drive }) {
  const clock = useScene();
  const [turn1, turn2] = f.session.turns;
  const { reply, stats } = f.streamedReply;
  return (
    <>
      <Turn turn={turn1!} f={f} from="tx3" dense />
      <div data-reveal={arriving(clock, "working")}>
        <UserBubble item={{ text: drive.shell.sent ?? storyPrompt(f) }} dense />
      </div>
      <HeroWork f={f} turn={turn2!} />
      {reached(clock, "answer") && (
        <p className="my-3 font-sans text-sm leading-relaxed text-fg [overflow-wrap:break-word]">
          <StreamText text={reply.markdown} frame="answer" />
        </p>
      )}
      {heroTurn(clock) === "settled" && (
        <div data-reveal={arriving(clock, "settled")}>
          <StatsLine stats={stats} f={f} />
        </div>
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
 * the reviewer's child Session. Only the first answers the composer; the other two are settled.
 */
function Reading({ f, open, drive }: { f: Fixtures; open: number; drive: Drive }) {
  if (open === 1) return <FailedReading f={f} />;
  if (open >= 2) return <ReviewReading f={f} />;
  return <TaskReading f={f} drive={drive} />;
}

/** The composer's model trigger, pressable: it opens the picker the composer module draws. */
function ModelTrigger({ f, drive }: { f: Fixtures; drive: Drive }) {
  const s = f.session;
  const c = f.copy.chat;
  const model = f.models.find((m) => m.modelId === s.model.modelId);
  const open = drive.shell.picker;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => drive.dispatch({ type: "picker", open: !open })}
      className="flex shrink-0 rounded-md"
    >
      <ToolbarTrigger
        lead={<AgentTile id={s.model.provider} name={model?.providerLabel ?? "?"} size={16} />}
        label={model?.displayName ?? s.model.modelId}
        name={`${c.model} ${s.model.modelId}`}
        chevron={false}
      />
    </button>
  );
}

/**
 * The composer, with a real input. Sending plays the reply; while it plays the button stops
 * instead, until the reader writes again.
 */
function ComposerCard({ f, drive }: { f: Fixtures; drive: Drive }) {
  const clock = useScene();
  const c = f.copy.chat;
  const value = drive.shell.draft;
  const state = heroComposer(clock, value);
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
          onChange={(event) => drive.dispatch({ type: "write", draft: event.target.value })}
          placeholder={c.inputPlaceholder}
          aria-label={c.inputPlaceholder}
          className="w-full min-w-0 bg-transparent px-1 py-0.5 font-sans text-base leading-6 text-fg outline-none placeholder:text-fg-subtle"
        />
        <ComposerToolbar
          f={f}
          modelTrigger={<ModelTrigger f={f} drive={drive} />}
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

/**
 * The model picker over the composer: the composer module's own `model-picker` composition — the
 * picker above the card it hangs off — laid over the chat's composer, bottom edges together. A
 * click anywhere, a pick included, or Escape closes it. It renders with no clock over it, like
 * every composition the window borrows.
 */
function ModelPickerLayer({
  drive,
  lang,
  mode,
}: {
  drive: Drive;
  lang: FixtureLang;
  mode: ThemeModeName;
}) {
  const open = drive.shell.picker;
  const close = () => drive.dispatch({ type: "picker", open: false });
  return (
    <>
      {open && <div aria-hidden onClick={close} className="absolute inset-0" />}
      <Presence show={open} side="bottom" className="absolute inset-x-0 bottom-0 px-3 pb-3">
        <div onClick={close}>
          <SceneContext.Provider value={null}>
            <SceneControlsContext.Provider value={null}>
              {composer.render("model-picker", { lang, mode })}
            </SceneControlsContext.Provider>
          </SceneContext.Provider>
        </div>
      </Presence>
    </>
  );
}

/**
 * The chat before any Session exists: the question it opens with, the prompts the product offers
 * (a pick lands in the composer), and the picks a first Task starts on. The labelled rows are
 * where the themes' form layouts show — Primer's label above a full-width control, Frost's
 * roomier, Console's in a fixed label column.
 */
function HeroStart({ f, drive }: { f: Fixtures; drive: Drive }) {
  const model = f.models.find((candidate) => candidate.modelId === f.session.model.modelId);
  const skill = f.plugins.find((plugin) => plugin.enabled);
  return (
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
            onClick={() => drive.dispatch({ type: "write", draft: example })}
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
  );
}

// ---------------------------------------------------------------------------------------------
// The dock
// ---------------------------------------------------------------------------------------------

/** The call graph, as a tree: the Session's own Agent, and the child it started under it. */
function SubagentsPanel({ f }: { f: Fixtures }) {
  const clock = useScene();
  const sub = subagentOf(f);
  const main = f.agents.find((agent) => agent.id === f.session.agentId)!;
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
        <li
          data-depth={1}
          data-last="true"
          data-reveal={arriving(clock, "working")}
          style={{ paddingLeft: treeInset(1) }}
          className="flex h-7 items-center gap-2 rounded-md bg-accent-muted pr-1 text-xs text-fg"
        >
          <AgentTile id={sub.agentId} name={sub.agentName} />
          <span className="min-w-0 flex-1 truncate font-(--ui-weight-medium)">{sub.agentName}</span>
          {done ? (
            <StatusWord tone="success" icon="circleCheck">
              {f.copy.dock.nodeDone}
            </StatusWord>
          ) : (
            <RunSpinner label={f.copy.chat.runStates.running} />
          )}
        </li>
      </ul>
      {reply?.kind === "text" && (
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
  drive: Drive;
}) {
  return (
    <span role="tablist" className="flex min-w-0 items-center gap-1">
      {panels.map((panel, index) => (
        <button
          key={panel.label}
          type="button"
          role="tab"
          aria-selected={index === open}
          onClick={() => drive.dispatch({ type: "panel", index })}
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

function DockFrame({ f, drive }: { f: Fixtures; drive: Drive }) {
  const panels = f.menus.panels
    .flatMap((entry) => (entry === "separator" ? [] : [entry]))
    .slice(0, 3);
  const open = Math.min(Math.max(0, drive.shell.panel), panels.length - 1);
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
// The window
// ---------------------------------------------------------------------------------------------

/**
 * A window at the app's proportions: one column on a phone, and at the `@3xl` mark the sidebar,
 * the main column and the dock side by side, as tall as a laptop window is for its width.
 */
const FRAME =
  "flex h-[30rem] flex-col overflow-hidden rounded-lg border border-line bg-canvas @3xl:h-[44rem] @3xl:flex-row";

/**
 * The whole window with its state. `start` opens it before any Session exists — an empty list and
 * the new-chat page — until the reader's first send starts one; `page` is the page it opens on.
 * Remounting it (a new `key`) is the one way back to how it opened.
 */
export function ShellWindow({
  f,
  lang,
  mode,
  start = false,
  page = "chat",
}: {
  f: Fixtures;
  lang: FixtureLang;
  mode: ThemeModeName;
  start?: boolean;
  page?: ShellPage;
}) {
  const [shell, dispatch] = useReducer(shellReducer, page, (first) => ({
    ...SHELL_START,
    page: first,
  }));
  const { clock, controls } = useReplyClock();
  const drive: Drive = {
    shell,
    dispatch,
    send: (prompt) => {
      if (prompt.trim() === "") return;
      dispatch({ type: "send", prompt });
      controls.playFrom("working");
    },
  };
  // Before the first send the window has no Session: the list is empty and the chat is new.
  const fresh = start && shell.sent === null;
  const sessions = fresh ? [] : (f.sessionGroups[0]?.items ?? []);
  const open = Math.min(Math.max(0, shell.session), Math.max(0, sessions.length - 1));
  const running = !fresh && open === 0 && heroTurn(clock) !== "settled";
  return (
    <div
      className="@container"
      onKeyDown={(event) => {
        if (event.key === "Escape" && shell.picker) dispatch({ type: "picker", open: false });
      }}
    >
      <SceneContext.Provider value={clock}>
        <SceneControlsContext.Provider value={controls}>
          <AppShell className={FRAME}>
            <HeroSidebar
              f={f}
              sessions={sessions}
              open={fresh ? -1 : open}
              running={running}
              drive={drive}
            />
            {shell.page === "chat" ? (
              <>
                <div data-slot="main" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  <ChatHead
                    f={f}
                    title={fresh ? f.copy.nav.newChat : (sessions[open]?.title ?? f.session.title)}
                    running={running}
                  />
                  {fresh ? (
                    <HeroStart f={f} drive={drive} />
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 @2xl:px-6">
                      <div>
                        <Reading f={f} open={open} drive={drive} />
                      </div>
                    </div>
                  )}
                  <ComposerCard f={f} drive={drive} />
                  <ModelPickerLayer drive={drive} lang={lang} mode={mode} />
                </div>
                {!fresh && <DockFrame f={f} drive={drive} />}
              </>
            ) : (
              <ShellPageView f={f} page={shell.page} lang={lang} mode={mode} />
            )}
          </AppShell>
        </SceneControlsContext.Provider>
      </SceneContext.Provider>
    </div>
  );
}
