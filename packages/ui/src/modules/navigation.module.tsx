/**
 * Sidebar & navigation: how the app is moved through.
 *
 * - Sidebar: the session sidebar beside the chat header — the account switcher, nav rows with
 *   counts, the Sessions group label, a Workspace group and a time group of session rows with their
 *   marks (running, pinned, unread, scheduled), one row showing its hover actions, the user row;
 * - Tabs & crumbs: a page header under its breadcrumbs, with underline tabs;
 * - Dock & rail: the chat with the right dock open — dock tabs, the panel actions and a panel;
 * - Collapsed: the sidebar folded to the icon rail, one icon showing its tooltip.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, SessionListItem } from "../fixtures";
import { defineModule } from "../module";
import { AgentTile, UserAvatar } from "../screens/parts";
import { duration, tokens, usd } from "../screens/format";
import {
  Badge,
  Breadcrumbs,
  Button,
  Dot,
  GlyphIcon,
  GroupHeader,
  IconButton,
  KeyValue,
  NavRow,
  PageHeader,
  RunSpinner,
  Tabs,
  Tooltip,
} from "./parts";
import type { IconName } from "./parts";

const NAV: readonly {
  key: "agents" | "plugins" | "models" | "usage" | "benchmark";
  icon: IconName;
}[] = [
  { key: "agents", icon: "agents" },
  { key: "plugins", icon: "plugins" },
  { key: "models", icon: "models" },
  { key: "usage", icon: "usage" },
  { key: "benchmark", icon: "benchmark" },
];

/** A mock app window the compositions sit in: the product's own frame, at a fixed height. */
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
    <div
      className={`flex ${column ? "flex-col" : ""} ${height} overflow-hidden rounded-lg border border-line bg-canvas`}
    >
      {children}
    </div>
  );
}

function SessionRow({
  item,
  f,
  active = false,
  hovered = false,
}: {
  item: SessionListItem;
  f: Fixtures;
  active?: boolean;
  hovered?: boolean;
}) {
  const agent = f.agents.find((a) => a.id === item.agentId);
  return (
    <li
      className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm ${
        active ? "bg-accent-muted text-fg" : hovered ? "bg-surface-muted text-fg" : "text-fg-muted"
      }`}
    >
      <AgentTile id={item.agentId} name={agent?.name ?? item.agentId} />
      <span className={`min-w-0 flex-1 truncate ${active ? "font-(--ui-weight-medium)" : ""}`}>
        {item.title}
      </span>
      {hovered ? (
        <span className="flex items-center">
          <IconButton label={f.copy.nav.pin} icon="pin" size="sm" />
          <IconButton label={f.copy.common.more} icon="more" size="sm" hovered />
        </span>
      ) : (
        <>
          {item.pinned && <GlyphIcon name="pin" size={12} className="text-fg-subtle" />}
          {item.scheduled && (
            <GlyphIcon name="calendarClock" size={12} className="text-fg-subtle" />
          )}
          {item.unread && <Dot tone="info" size="xs" />}
          {item.running ? (
            <RunSpinner label={f.copy.chat.runStates.running} />
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{item.timeLabel}</span>
          )}
        </>
      )}
    </li>
  );
}

function SidebarFrame({ f }: { f: Fixtures }) {
  const c = f.copy.nav;
  const [workspace, earlier] = f.sessionGroups;
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface-muted">
      <div className="flex items-center gap-1 px-2 pt-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5">
          <UserAvatar name={f.user.name} size={22} />
          <span className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-medium) text-fg">
            {f.user.name}
          </span>
          <GlyphIcon name="chevronDown" size={14} className="text-fg-subtle" />
        </span>
        <IconButton label={c.collapseSidebar} icon="sidebar" />
      </div>
      <nav className="grid grid-cols-[minmax(0,1fr)] gap-px px-2 pt-2">
        <NavRow icon="newChat" label={c.newChat} />
        {NAV.map((row) => (
          <NavRow
            key={row.key}
            icon={row.icon}
            label={c[row.key]}
            count={row.key === "agents" ? f.agents.length : row.key === "plugins" ? 4 : undefined}
          />
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-hidden px-2 pt-3">
        <GroupHeader
          label={c.sessions}
          actions={
            <span className="flex items-center">
              <IconButton label={c.search} icon="search" size="sm" />
              <IconButton label={c.filterSessions} icon="sliders" size="sm" />
            </span>
          }
        />
        {workspace && (
          <>
            <GroupHeader
              icon="folder"
              label={workspace.label}
              name
              count={workspace.items.length}
            />
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-px">
              {workspace.items.map((row, i) => (
                <SessionRow
                  key={row.id}
                  item={row}
                  f={f}
                  active={row.id === f.session.id}
                  hovered={i === 1}
                />
              ))}
            </ul>
          </>
        )}
        {earlier && (
          <>
            <GroupHeader icon="clock" label={earlier.label} count={earlier.items.length} />
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-px">
              {earlier.items.map((row) => (
                <SessionRow key={row.id} item={row} f={f} />
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <UserAvatar name={f.user.name} size={24} />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.user.name}</span>
        <IconButton label={f.copy.settings.title} icon="settings" size="sm" />
      </div>
    </aside>
  );
}

function ChatHead({ f, dock }: { f: Fixtures; dock?: "bottom" | "right" }) {
  const s = f.session;
  const d = f.copy.dock;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      <span className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-medium) text-fg">
        {s.title}
      </span>
      <span className="flex items-center gap-1 text-xs text-tone-success-fg">
        <RunSpinner />
        {f.copy.chat.running}
      </span>
      {dock && (
        <span className="flex items-center">
          <IconButton label={d.bottomDock} icon="panelBottom" pressed={dock === "bottom"} />
          <IconButton label={d.rightDock} icon="panelRight" pressed={dock === "right"} />
        </span>
      )}
      <span className="flex items-center gap-3 font-mono text-xs tabular-nums text-fg-muted">
        <span>{tokens(s.totals.tokens)}</span>
        <span>{usd(s.totals.costUsd)}</span>
        <span>{duration(s.totals.elapsedMs)}</span>
      </span>
    </header>
  );
}

/** The chat's latest exchange, quietly, so a frame has something in it. */
function ChatBody({ f }: { f: Fixtures }) {
  const items = f.session.turns[1]!.items;
  const prompt = items.find((i) => i.kind === "user");
  const reply = items.find((i) => i.kind === "text");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      {prompt?.kind === "user" && (
        <p className="ml-auto max-w-[80%] rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg">
          {prompt.text}
        </p>
      )}
      {reply?.kind === "text" && (
        <p className="text-sm leading-relaxed text-fg">{reply.markdown}</p>
      )}
    </div>
  );
}

function Sidebar({ f }: { f: Fixtures }) {
  return (
    <Window height="h-[39rem]">
      <SidebarFrame f={f} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHead f={f} />
        <ChatBody f={f} />
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
  const subagents = f.session.turns
    .flatMap((turn) => turn.items)
    .filter((item) => item.kind === "tool_call" && item.subagent !== undefined).length;
  const tabs = [f.copy.dock.subagents(subagents), f.copy.nav.traces, f.copy.nav.files];
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
          {i === 0 && <GlyphIcon name="cross" size={11} className="text-fg-subtle" />}
        </span>
      ))}
    </span>
  );
}

/** The bottom dock: its tabs and panel actions in the head, the Subagents panel in the body. */
function DockFrame({ f }: { f: Fixtures }) {
  const d = f.copy.dock;
  const call = f.session.turns[1]!.items.find((i) => i.kind === "tool_call" && i.subagent);
  const subagent = call?.kind === "tool_call" ? call.subagent : undefined;
  const reply = subagent?.transcript.find((i) => i.kind === "text");
  const main = f.agents.find((a) => a.id === f.session.agentId)!;
  return (
    <section className="ui-frame flex h-64 shrink-0 flex-col border-t border-line bg-canvas">
      <div data-slot="head" className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <DockTabs f={f} />
        <span className="min-w-0 flex-1" />
        <IconButton label={d.newPanel} icon="plus" size="sm" />
        <IconButton label={d.movePanel} icon="panelRight" size="sm" />
        <IconButton label={d.close} icon="cross" size="sm" />
      </div>
      <div data-slot="body" className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)]">
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-1 border-r border-line p-3 text-sm">
          <p className="pb-1 text-xs text-fg-muted">{f.copy.dock.topology}</p>
          <span className="flex items-center gap-2 px-1 py-1 text-fg-muted">
            <AgentTile id={main.id} name={main.name} />
            <span className="truncate">{main.name}</span>
            <span className="font-mono text-xs text-fg-subtle">{f.session.id.slice(-6)}</span>
          </span>
          {subagent && (
            <span className="ml-4 flex items-center gap-2 rounded-md bg-accent-muted px-2 py-1 text-fg">
              <AgentTile id={subagent.agentId} name={subagent.agentName} />
              <span className="min-w-0 flex-1 truncate font-(--ui-weight-medium)">
                {subagent.agentName}
              </span>
              <RunSpinner label={f.copy.chat.runStates.running} />
            </span>
          )}
        </div>
        {reply?.kind === "text" && (
          <p className="overflow-hidden p-3 text-sm leading-relaxed text-fg-muted">
            {reply.markdown}
          </p>
        )}
      </div>
    </section>
  );
}

function DockAndRail({ f }: { f: Fixtures }) {
  return (
    <Window height="h-[32rem]">
      <Rail f={f} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHead f={f} dock="bottom" />
        <ChatBody f={f} />
        <DockFrame f={f} />
      </div>
    </Window>
  );
}

function Rail({ f, tooltip = false }: { f: Fixtures; tooltip?: boolean }) {
  const c = f.copy.nav;
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-muted py-2">
      <IconButton label={c.expandSidebar} icon="sidebar" />
      <IconButton label={c.newChat} icon="newChat" />
      <span className="my-1 h-px w-6 bg-line" />
      {NAV.map((row, i) => (
        <span key={row.key} className="relative">
          <IconButton
            label={c[row.key]}
            icon={row.icon}
            pressed={i === 2}
            hovered={tooltip && i === 1}
          />
          {tooltip && i === 1 && (
            <span className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2">
              <Tooltip label={c[row.key]} />
            </span>
          )}
        </span>
      ))}
      <span className="min-h-0 flex-1" />
      <UserAvatar name={f.user.name} size={24} />
    </nav>
  );
}

function Collapsed({ f }: { f: Fixtures }) {
  return (
    <Window height="h-[28rem]">
      <Rail f={f} tooltip />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHead f={f} />
        <ChatBody f={f} />
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
    "The session sidebar with nav rows, counts and marked session rows; a page header with breadcrumbs and underline tabs; the dock with its tabs and the icon rail.",
  width: "wide",
  variants: [
    { key: "sidebar", title: "Sidebar" },
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
