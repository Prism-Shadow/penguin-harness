/**
 * Sidebar & navigation: how the app is moved through.
 *
 * - Sidebar: the pinned sidebar beside the chat, as the app lays it out — the collapse button and
 *   the Project switcher, New chat, the page entries and the seam that folds them, the Sessions
 *   header, two Workspace groups of session rows with their marks (running, pinned, unread,
 *   scheduled), one row showing its hover actions, and the user row — with the launcher ball on
 *   the chat's right edge, since no dock is open there. Its scene opens it: the icon rail, a rail
 *   icon's tooltip, then the sidebar unfolding;
 * - Tabs & crumbs: a page header under its breadcrumbs, with underline tabs;
 * - Dock & rail: the chat with the bottom dock open — dock tabs, the panel actions and a panel;
 * - Collapsed: the sidebar folded to the icon rail, one icon showing its tooltip.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures } from "../fixtures";
import { APP_WINDOW_WIDTH, defineModule } from "../module";
import type { SceneSpec } from "../module";
import { at, reached, useScene } from "../scene";
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

const EXPAND: SceneSpec = {
  frames: [
    { key: "rail", title: "Rail", hold: 1400 },
    { key: "tooltip", title: "Tooltip", hold: 1400 },
    { key: "expanded", title: "Expanded", hold: 1600 },
  ],
};

/** The rail entry the tooltip frames point at. */
const TIP: SidebarPage = "plugins";

/**
 * The sidebar, and the scene that opens it: the icon rail; one rail icon's tooltip; then the
 * column widens to the sidebar — its width moves through `data-layout-motion` while the rail's
 * contents leave and the sidebar's arrive, each laid out at its own width so neither reflows on
 * the way. The column clips while the width moves and stops clipping for the tooltip, so that can
 * hang over the chat. Settled, it is the sidebar the variant shows when nothing is playing.
 */
function Sidebar({ f }: { f: Fixtures }) {
  const clock = useScene();
  const expanded = reached(clock, "expanded");
  const tooltip = at(clock, "tooltip");
  // A row of the second group, under the pointer: the open Task's own group keeps its marks.
  const hovered = f.sessionGroups[1]?.items[0]?.id;
  return (
    <Window height="h-[40rem]">
      <aside
        data-slot="nav"
        data-layout-motion
        className={`relative flex shrink-0 flex-col border-r border-line bg-surface-muted ${
          expanded ? "w-72" : "w-12"
        } ${tooltip ? "" : "overflow-hidden"}`}
      >
        {/*
          The sidebar's contents are laid out at their own width from the moment they mount and
          the column clips them, so the widening column is what uncovers them — no entrance of
          their own, and a settled card draws them at rest.
        */}
        {expanded && (
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col">
            <SidebarBody f={f} activeSessionId={f.session.id} hoveredSessionId={hovered} />
          </div>
        )}
        <Presence
          show={!expanded}
          side="left"
          className="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 py-2.5"
        >
          <RailBody
            f={f}
            hovered={tooltip ? TIP : undefined}
            renderEntry={(node, page) =>
              page === TIP ? (
                <>
                  {node}
                  <span className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2">
                    <Presence show={tooltip} side="left" as="span" className="block">
                      <Tooltip label={f.copy.nav[page]} />
                    </Presence>
                  </span>
                </>
              ) : (
                node
              )
            }
          />
        </Presence>
      </aside>
      <div data-slot="main" className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={f} dock="none" />
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

/** The collapsed rail; `tooltip` shows the named entry's tooltip, as a still. */
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
    { key: "sidebar", title: "Sidebar", scene: EXPAND },
    { key: "tabs-crumbs", title: "Tabs & crumbs" },
    { key: "dock-rail", title: "Dock & rail" },
    { key: "collapsed", title: "Collapsed" },
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
