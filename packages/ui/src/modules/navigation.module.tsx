/**
 * Sidebar & navigation: how the app is moved through.
 *
 * - Sidebar: the pinned sidebar beside the chat, as the app lays it out — the collapse button and
 *   the Project switcher, New chat, the page entries and the seam that folds them, the Sessions
 *   header, two Workspace groups of session rows with their marks (running, pinned, unread,
 *   scheduled), one row showing its hover actions, and the user row — with the launcher ball on
 *   the chat's right edge, since no dock is open there. The reader drives it: the collapse button
 *   folds it to the icon rail and the rail's expand button unfolds it, a rail icon under the
 *   pointer shows its tooltip, a row under the pointer shows its actions, and a clicked row
 *   becomes the open Session;
 * - Tabs & crumbs: a page header under its breadcrumbs, with underline tabs;
 * - Dock & rail: the chat with the bottom dock open — dock tabs, the panel actions and a panel;
 * - Collapsed: the sidebar folded to the icon rail, one icon showing its tooltip.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures } from "../fixtures";
import { APP_WINDOW_WIDTH, defineModule } from "../module";
import {
  AgentTile,
  AppShell,
  ChatHeader,
  LauncherBall,
  RailBody,
  SidebarBody,
} from "../screens/parts";
import type { SidebarPage } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import {
  Badge,
  Breadcrumbs,
  Button,
  GlyphIcon,
  IconButton,
  KeyValue,
  PageHeader,
  Presence,
  RunSpinner,
  Tabs,
  Tooltip,
} from "./parts";
import type { IconName } from "./parts";

/**
 * A mock app window the compositions sit in: the product's own frame (the app shell), at a fixed
 * height. Its children name their slots — the sidebar or rail `nav`, the chat column `main`.
 */
function Window({
  children,
  height = "h-[32rem]",
  column = false,
}: {
  children: ReactNode;
  height?: string;
  column?: boolean;
}) {
  return (
    <AppShell
      className={`flex ${column ? "flex-col" : ""} ${height} overflow-hidden rounded-lg border border-line bg-canvas`}
    >
      {children}
    </AppShell>
  );
}

/**
 * The chat's latest exchange, quietly, so a frame has something in it. With no dock open on the
 * right, the launcher ball rests on the body's right edge, as it does in the app.
 */
function ChatBody({ f, launcher = false }: { f: Fixtures; launcher?: boolean }) {
  const items = f.session.turns[1]!.items;
  const prompt = items.find((i) => i.kind === "user");
  const reply = items.find((i) => i.kind === "text");
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-hidden px-6 py-6">
        {prompt?.kind === "user" && (
          <p className="ml-auto max-w-[75%] rounded-lg bg-surface-muted px-4 py-2 font-sans text-base text-fg">
            {prompt.text}
          </p>
        )}
        {reply?.kind === "text" && (
          <p className="font-sans text-base leading-relaxed text-fg">{reply.markdown}</p>
        )}
      </div>
      {launcher && <LauncherBall f={f} />}
    </div>
  );
}

/** The rail entry the Collapsed still shows the tooltip of. */
const TIP: SidebarPage = "plugins";

/**
 * The sidebar as the reader drives it. It opens as the app shows it — unfolded, the fixtures'
 * Session open, one row of the second group under the pointer — and from there the collapse
 * button folds the column to the icon rail and the rail's first button unfolds it again. The
 * width moves through `data-layout-motion` while one body leaves and the other arrives, each laid
 * out at its own width so neither reflows on the way; the column clips while it moves, and stops
 * clipping while a rail tooltip is out, so that can hang over the chat. A clicked row becomes the
 * open Session, and the chat's header takes its title.
 */
function Sidebar({ f }: { f: Fixtures }) {
  const rows = f.sessionGroups.flatMap((group) => group.items);
  const [expanded, setExpanded] = useState(true);
  const [open, setOpen] = useState(f.session.id);
  // A row of the second group starts under the pointer: the open Task's own group keeps its marks.
  const [hovered, setHovered] = useState(f.sessionGroups[1]?.items[0]?.id);
  const [tip, setTip] = useState<SidebarPage | undefined>(undefined);
  const row = rows.find((item) => item.id === open);
  const shown =
    row === undefined || row.id === f.session.id
      ? f
      : { ...f, session: { ...f.session, title: row.title, running: row.running === true } };
  return (
    <Window height="h-[40rem]">
      <aside
        data-slot="nav"
        data-layout-motion
        className={`relative flex shrink-0 flex-col border-r border-line bg-surface-muted ${
          expanded ? "w-72" : "w-12"
        } ${expanded || tip === undefined ? "overflow-hidden" : ""}`}
      >
        <Presence
          show={expanded}
          side="left"
          appear={false}
          className="absolute inset-y-0 left-0 flex w-72 flex-col"
        >
          <SidebarBody
            f={f}
            activeSessionId={open}
            hoveredSessionId={hovered}
            onOpenSession={setOpen}
            onHoverSession={setHovered}
            onCollapse={() => {
              setExpanded(false);
              setHovered(undefined);
            }}
          />
        </Presence>
        <Presence
          show={!expanded}
          side="left"
          className="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 py-2.5"
        >
          <RailBody
            f={f}
            hovered={tip}
            onHoverEntry={setTip}
            onExpand={() => {
              setExpanded(true);
              setTip(undefined);
            }}
            renderEntry={(node, page) => (
              <>
                {node}
                <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2">
                  <Presence show={tip === page} side="left" as="span" className="block">
                    <Tooltip label={f.copy.nav[page]} />
                  </Presence>
                </span>
              </>
            )}
          />
        </Presence>
      </aside>
      <div data-slot="main" className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={shown} dock="none" />
        <ChatBody f={f} launcher />
      </div>
    </Window>
  );
}

function TabsAndCrumbs({ f }: { f: Fixtures }) {
  const m = f.copy.models;
  const model = f.models[0]!;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <Breadcrumbs items={[f.copy.nav.models, model.providerLabel, model.displayName]} />
        <PageHeader
          title={model.displayName}
          info={m.pageInfo}
          actions={
            <>
              <Button variant="secondary">{m.setDefault}</Button>
              <Button variant="primary" leading={<GlyphIcon name="pencil" size={13} />}>
                {f.copy.common.edit}
              </Button>
            </>
          }
        />
        <div className="flex items-center gap-2">
          <Badge tone="success" variant="soft">
            {m.default}
          </Badge>
          <span className="font-mono text-xs text-fg-muted">
            {model.provider}/{model.modelId}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Tabs
          items={[m.tabs.overview, m.tabs.pricing, m.tabs.usage, f.copy.traces.filesTitle]}
          active={0}
        />
        <KeyValue
          items={[
            { label: m.provider, value: model.providerLabel },
            { label: m.modelId, value: model.modelId, mono: true },
            { label: m.context, value: tokens(model.contextWindow) },
            { label: m.perMTok(m.cacheRead), value: usd(model.pricing.cacheRead) },
            { label: m.perMTok(m.output), value: usd(model.pricing.output) },
            { label: m.usedBy, value: f.agents.map((a) => a.name).join(", ") },
          ]}
        />
      </div>
    </div>
  );
}

function DockTabs({ f }: { f: Fixtures }) {
  const tabs = [f.copy.dock.agentsPanel, f.copy.nav.traces, f.copy.dock.filesPanel];
  const glyphs: readonly IconName[] = ["bot", "eye", "folder"];
  return (
    <span role="tablist" className="flex min-w-0 items-center gap-1">
      {tabs.map((tab, i) => (
        <span
          key={tab}
          role="tab"
          aria-selected={i === 0}
          className={`flex h-7 min-w-0 items-center gap-1.5 rounded-control pl-2 pr-1 text-xs ${
            i === 0 ? "bg-accent-muted text-fg" : "text-fg-muted"
          }`}
        >
          <GlyphIcon name={glyphs[i] ?? "eye"} size={13} />
          <span className="truncate">{tab}</span>
          {i === 0 && (
            <span title={f.copy.dock.closeTab}>
              <GlyphIcon name="cross" size={11} className="text-fg-subtle" />
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * The Session that started the run and the child Sessions hanging off it: a `ui-tree`, so Console
 * rules the child to its parent and drops the indent, while Primer keeps today's step in.
 */
function CallGraph({ f }: { f: Fixtures }) {
  const call = f.session.turns[1]!.items.find((i) => i.kind === "tool_call" && i.subagent);
  const subagent = call?.kind === "tool_call" ? call.subagent : undefined;
  const main = f.agents.find((a) => a.id === f.session.agentId)!;
  return (
    <div className="ui-tree grid grid-cols-[minmax(0,1fr)] content-start gap-1 border-r border-line p-3 text-sm">
      <p className="pb-1 text-xs text-fg-muted">{f.copy.dock.topology}</p>
      <span data-depth={0} className="flex items-center gap-2 px-1 py-1 text-fg-muted">
        <AgentTile id={main.id} name={main.name} />
        <span className="truncate">{main.name}</span>
        <span className="font-mono text-xs text-fg-subtle">{f.session.id.slice(-6)}</span>
      </span>
      {subagent && (
        <span
          data-depth={1}
          data-last="true"
          className="ml-4 flex items-center gap-2 rounded-md bg-accent-muted px-2 py-1 text-fg"
        >
          <AgentTile id={subagent.agentId} name={subagent.agentName} />
          <span className="min-w-0 flex-1 truncate font-(--ui-weight-medium)">
            {subagent.agentName}
          </span>
          <RunSpinner label={f.copy.chat.runStates.running} />
        </span>
      )}
    </div>
  );
}

/** The bottom dock: its tabs and panel actions in the head, the Agents panel in the body. */
function DockFrame({ f }: { f: Fixtures }) {
  const d = f.copy.dock;
  const call = f.session.turns[1]!.items.find((i) => i.kind === "tool_call" && i.subagent);
  const subagent = call?.kind === "tool_call" ? call.subagent : undefined;
  const reply = subagent?.transcript.find((i) => i.kind === "text");
  return (
    <section className="ui-frame flex h-64 shrink-0 flex-col border-t border-line bg-canvas">
      <div data-slot="head" className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <DockTabs f={f} />
        <span className="min-w-0 flex-1" />
        <IconButton label={d.newPanel} icon="plus" size="sm" />
        <IconButton label={d.moveToRight} icon="panelRight" size="sm" />
        <IconButton label={d.hideDock} icon="cross" size="sm" />
      </div>
      <div data-slot="body" className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)]">
        <CallGraph f={f} />
        {reply?.kind === "text" && (
          <p className="overflow-hidden p-3 font-sans text-sm leading-relaxed text-fg-muted">
            {reply.markdown}
          </p>
        )}
      </div>
    </section>
  );
}

function DockAndRail({ f }: { f: Fixtures }) {
  return (
    <Window height="h-[36rem]">
      <Rail f={f} />
      <div data-slot="main" className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={f} dock="bottom" />
        <ChatBody f={f} />
        <DockFrame f={f} />
      </div>
    </Window>
  );
}

/** The collapsed rail; `tooltip` shows the entry's tooltip, as a still. */
function Rail({ f, tooltip = false }: { f: Fixtures; tooltip?: boolean }) {
  return (
    <nav
      data-slot="nav"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-muted py-2.5"
    >
      <RailBody
        f={f}
        hovered={tooltip ? TIP : undefined}
        renderEntry={(node, page) =>
          tooltip && page === TIP ? (
            <>
              {node}
              <span className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2">
                <Tooltip label={f.copy.nav[page]} />
              </span>
            </>
          ) : (
            node
          )
        }
      />
    </nav>
  );
}

function Collapsed({ f }: { f: Fixtures }) {
  return (
    <Window height="h-[32rem]">
      <Rail f={f} tooltip />
      <div data-slot="main" className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={f} dock="none" />
        <ChatBody f={f} launcher />
      </div>
    </Window>
  );
}

const VARIANTS = {
  sidebar: Sidebar,
  "tabs-crumbs": TabsAndCrumbs,
  "dock-rail": DockAndRail,
  collapsed: Collapsed,
} as const;

export const module = defineModule({
  id: "navigation",
  title: "Sidebar & navigation",
  description:
    "The pinned sidebar — Project switcher, page entries, Workspace groups of marked session rows — beside the chat and its launcher ball; a page header with breadcrumbs and underline tabs; the dock with its tabs and the icon rail.",
  width: "wide",
  viewport: APP_WINDOW_WIDTH,
  variants: [
    { key: "sidebar", title: "Sidebar", kind: "interactive" },
    { key: "tabs-crumbs", title: "Tabs & crumbs", kind: "static" },
    { key: "dock-rail", title: "Dock & rail", kind: "static" },
    { key: "collapsed", title: "Collapsed", kind: "static" },
  ],
  parts: [
    "navigation-tabs",
    "navigation-nav-list",
    "navigation-group-header",
    "navigation-breadcrumbs",
    "navigation-rail",
    "navigation-dock-tabs",
    "shell-app-shell",
    "shell-sidebar",
    "shell-dock-frame",
    "shell-dock-picker",
    "shell-launcher",
    "shell-panels-toolbar",
    "shell-mobile-top-bar",
    "shell-terminal-appearance",
    "icons-avatars",
    "icons-activity-icon",
    "feedback-count",
    "overlays-tooltip",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Sidebar;
    return <View f={fixturesFor(lang)} />;
  },
});
