/**
 * Shell pieces shared by the screen mock-ups: marks, the sidebar, the chat header and the dock
 * frame. Static JSX on token utilities and the declared style hooks only — no palette class,
 * no `dark:` pair, no state — so the three themes differ purely through their tokens.
 *
 * Each piece names the web app component it imitates. When that component moves into this
 * package (the wave is noted), the screen swaps the piece for the real thing.
 */
import type { ReactNode } from "react";
import { Spinner } from "../components/icons/spinner/spinner";
import type { Fixtures, RunState, SessionListItem } from "../fixtures";
import type { ToneName } from "../tokens";
import { usd, duration, tokens } from "./format";
import { Glyph } from "./glyph";
import type { GlyphName } from "./glyph";

/**
 * A neutral fill for wells that must read as filled in every theme: bubbles, chips, inline code,
 * segmented tracks, timeline lanes. It is derived from the ink rather than taken from
 * `--ui-tone-neutral-bg`, because that token is a badge tint a theme may set to transparent
 * (Console outlines its badges), and the contract has no opaque neutral-fill token.
 */
export const NEUTRAL_FILL = "bg-[color-mix(in_oklab,var(--ui-fg)_7%,transparent)]";

// ---------------------------------------------------------------------------
// Marks (W1: Spinner, Dot, StatusIcon, AgentAvatar)
// ---------------------------------------------------------------------------

/**
 * The one Spinner already lives in the component set (rule 11 gives it the only `animate-spin`);
 * the screens re-export it so W1 removes this line rather than rewriting call sites.
 */
export { Spinner };

/**
 * A 6 px state dot — W1's `Dot` at its `xs` size (K-redesign §5.1), so a call site swaps by name.
 * It takes a tone, never a raw class, and paints the tone's **ink**: an emphasis fill is for a
 * box, not for a 6 px disc. `accent` is the one addition, because the unread mark is the accent
 * and §5.1's Tone list has no name for it. `size`, `live`, `label` and `knockout` arrive with W1.
 */
export function Dot({ tone }: { tone: ToneName | "accent" }) {
  const ink: Record<ToneName | "accent", string> = {
    success: "bg-tone-success-fg",
    attention: "bg-tone-attention-fg",
    danger: "bg-tone-danger-fg",
    done: "bg-tone-done-fg",
    neutral: "bg-tone-neutral-fg",
    info: "bg-tone-info-fg",
    accent: "bg-accent",
  };
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${ink[tone]}`} />;
}

const STATE_GLYPH: Record<Exclude<RunState, "running">, GlyphName> = {
  waiting: "hourglass",
  done: "circleCheck",
  failed: "circleCross",
  stopped: "circleCross",
};

const STATE_INK: Record<Exclude<RunState, "running">, string> = {
  waiting: "text-tone-attention-fg",
  done: "text-tone-neutral-fg",
  failed: "text-tone-danger-fg",
  stopped: "text-tone-neutral-fg",
};

/** The sentence-case word for a run state: a status mark always carries one (§1.3 row 15). */
export function stateWord(state: RunState, f: Fixtures): string {
  return f.copy.chat.runStates[state];
}

/** The run-state mark: a spinner while running, a static glyph otherwise, both with their word. */
export function StatusMark({ state, f }: { state: RunState; f: Fixtures }) {
  const label = stateWord(state, f);
  if (state === "running") return <Spinner tone="success" label={label} />;
  return (
    <span title={label} className={STATE_INK[state]}>
      <Glyph name={STATE_GLYPH[state]} size={13} />
    </span>
  );
}

/** Which chart identity colour an id draws its tile in — identity, not judgement. */
const TILE_INKS = [
  "--ui-chart-6",
  "--ui-chart-1",
  "--ui-chart-5",
  "--ui-chart-2",
  "--ui-chart-4",
  "--ui-chart-3",
] as const;

function tileInk(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_INKS[h % TILE_INKS.length]!;
}

/** A letter tile for an Agent (or a provider): the first letter on a tint of its identity colour. */
export function AgentTile({ id, name, size = 14 }: { id: string; name: string; size?: number }) {
  const ink = tileInk(id);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.58),
        color: `var(${ink})`,
        background: `color-mix(in oklab, var(${ink}) 16%, transparent)`,
      }}
      className="inline-flex shrink-0 items-center justify-center rounded-sm font-semibold leading-none"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The signed-in user's round avatar. Avatars follow the pill radius, so Console squares them. */
export function UserAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[var(--ui-radius-pill)] bg-fg font-semibold text-canvas"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * A square icon button in the W1 `IconButton` shape: flat at rest, ink deepening on hover, a fill
 * only while `pressed`. The label is required because an icon alone names nothing — it is the
 * tooltip and the accessible name at once.
 */
export function IconButton({
  icon,
  label,
  size = "md",
  pressed = false,
}: {
  icon: GlyphName;
  label: string;
  /** 32 px in a header or toolbar, 24 px in a dense row. */
  size?: "sm" | "md";
  pressed?: boolean;
}) {
  const box = size === "md" ? "h-8 w-8" : "h-6 w-6";
  return (
    <span
      title={label}
      aria-label={label}
      role="button"
      className={`flex ${box} shrink-0 items-center justify-center rounded-control ${
        pressed ? "bg-accent-muted text-fg" : "text-fg-subtle hover:text-fg"
      }`}
    >
      <Glyph name={icon} size={size === "md" ? 15 : 14} />
    </span>
  );
}

/**
 * A state or kind badge in the W1 `Badge` shape: caption size at the medium weight, the pill
 * radius, and a tone that touches at most two of ink / line / fill — `soft` takes the neutral
 * line so a filled badge is never one hue three times over (rule 9).
 */
export function Badge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  children,
}: {
  tone?: ToneName;
  variant?: "soft" | "outline" | "solid";
  /** 24 px or 20 px, the two K-redesign §5.1 names; the dense rows take `sm`. */
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const soft: Record<ToneName, string> = {
    success: "bg-tone-success-bg text-tone-success-fg",
    attention: "bg-tone-attention-bg text-tone-attention-fg",
    danger: "bg-tone-danger-bg text-tone-danger-fg",
    done: "bg-tone-done-bg text-tone-done-fg",
    neutral: "bg-tone-neutral-bg text-fg-muted",
    info: "bg-tone-info-bg text-tone-info-fg",
  };
  const outline: Record<ToneName, string> = {
    success: "border-tone-success-line text-tone-success-fg",
    attention: "border-tone-attention-line text-tone-attention-fg",
    danger: "border-tone-danger-line text-tone-danger-fg",
    done: "border-tone-done-line text-tone-done-fg",
    neutral: "border-tone-neutral-line text-fg-muted",
    info: "border-tone-info-line text-tone-info-fg",
  };
  const solid: Record<ToneName, string> = {
    success: "bg-tone-success-emphasis text-tone-success-emphasis-fg",
    attention: "bg-tone-attention-emphasis text-tone-attention-emphasis-fg",
    danger: "bg-tone-danger-emphasis text-tone-danger-emphasis-fg",
    done: "bg-tone-done-emphasis text-tone-done-emphasis-fg",
    neutral: "bg-tone-neutral-emphasis text-tone-neutral-emphasis-fg",
    info: "bg-tone-info-emphasis text-tone-info-emphasis-fg",
  };
  const look =
    variant === "outline"
      ? `border ${outline[tone]}`
      : variant === "solid"
        ? solid[tone]
        : `border border-line ${soft[tone]}`;
  const box = size === "sm" ? "h-5 px-1.5" : "h-6 px-2";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[var(--ui-radius-pill)] text-xs font-(--ui-weight-medium) ${box} ${look}`}
    >
      {children}
    </span>
  );
}

/** The segmented control: a filled track holding a raised selected option (W2: Segmented). */
export function Segmented({ options, value }: { options: readonly string[]; value: number }) {
  return (
    <div
      className={`grid gap-px rounded-control p-px ${NEUTRAL_FILL} ${
        options.length === 3 ? "grid-cols-3" : "grid-cols-2"
      }`}
    >
      {options.map((label, i) => (
        <span
          key={label}
          className={`rounded-control px-2 py-1 text-center text-xs ${
            i === value ? "bg-surface font-(--ui-weight-medium) text-fg shadow-sm" : "text-fg-muted"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/** A glyph welded to a mono value (the app's StatChip). Figures align, so they are tabular. */
export function StatChip({
  glyph,
  value,
  title,
}: {
  glyph: GlyphName;
  value: string;
  title?: string;
}) {
  return (
    <span title={title} className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
      <Glyph name={glyph} size={13} className="text-fg-subtle" />
      {value}
    </span>
  );
}

/**
 * A group label above a list (W4: GroupHeader), with the group's own actions on the right. The
 * `.ui-eyebrow` hook decides its case, weight and colour — Console uppercases it, the others do
 * not — so the markup carries only the caption rung as a floor for a theme with no recipe yet.
 */
export function GroupHeader({ label, actions }: { label: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="ui-eyebrow min-w-0 flex-1 px-1 text-xs font-(--ui-weight-strong) text-fg-muted">
        {label}
      </span>
      {actions}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar (W7: SidebarFrame, SessionRow; W4: NavList, GroupHeader)
// ---------------------------------------------------------------------------

const NAV: ReadonlyArray<{ key: keyof Fixtures["copy"]["nav"]; glyph: GlyphName }> = [
  { key: "agents", glyph: "agents" },
  { key: "plugins", glyph: "plugins" },
  { key: "models", glyph: "models" },
  { key: "usage", glyph: "usage" },
  { key: "benchmark", glyph: "benchmark" },
];

function SessionRow({ item, active, f }: { item: SessionListItem; active: boolean; f: Fixtures }) {
  const agent = f.agents.find((a) => a.id === item.agentId)!;
  return (
    <li
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${active ? "bg-accent-muted" : ""}`}
    >
      <AgentTile id={item.agentId} name={agent.name} />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          active ? "font-(--ui-weight-medium) text-fg" : "text-fg-muted"
        }`}
      >
        {item.title}
      </span>
      {item.pinned && <Glyph name="pin" size={12} className="text-tone-neutral-fg" />}
      {item.scheduled && <Glyph name="calendarClock" size={12} className="text-tone-neutral-fg" />}
      {item.unread && <Dot tone="accent" />}
      {item.running ? (
        <Spinner size="sm" tone="success" label={f.copy.chat.runStates.running} />
      ) : (
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{item.timeLabel}</span>
      )}
    </li>
  );
}

export function Sidebar({ f, activeSessionId }: { f: Fixtures; activeSessionId?: string }) {
  const c = f.copy.nav;
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface-muted">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <IconButton icon="sidebar" label={c.collapseSidebar} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-(--ui-weight-strong) text-fg">
          <span className="min-w-0 flex-1 truncate">{f.user.name}</span>
          <Glyph name="chevronDown" size={14} className="text-fg-subtle" />
        </span>
      </div>
      <nav className="shrink-0 space-y-1 px-2 pt-2">
        <span className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-(--ui-weight-medium) text-fg">
          <Glyph name="newChat" size={16} className="text-fg-muted" />
          {c.newChat}
        </span>
        <div className="pt-1.5" />
        {NAV.map((item) => (
          <span
            key={item.key}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg-muted"
          >
            <Glyph name={item.glyph} size={16} className="text-fg-subtle" />
            {c[item.key]}
          </span>
        ))}
      </nav>
      <div className="shrink-0 px-2 pt-1.5">
        <span
          className={`flex h-4 w-full items-center justify-center rounded-md text-fg-subtle ${NEUTRAL_FILL}`}
        >
          <Glyph name="chevronUp" size={12} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
        <div className="mt-3 px-1 pt-2">
          <GroupHeader
            label={c.sessions}
            actions={
              <span className="flex items-center gap-1">
                <IconButton icon="search" size="sm" label={c.search} />
                <IconButton icon="sliders" size="sm" label={c.listSettings} />
                <IconButton icon="folderPlus" size="sm" label={c.newWorkspace} />
              </span>
            }
          />
        </div>
        {f.sessionGroups.map((group, gi) => (
          <div key={group.key} className="pt-3">
            <div className="flex items-center gap-1 px-1.5 py-1 text-xs text-fg-subtle">
              <Glyph name={gi === 0 ? "folder" : "clock"} size={15} />
              <span className="font-(--ui-weight-strong) text-fg-muted">{group.label}</span>
              <span className="tabular-nums">{group.items.length}</span>
              <Glyph name="chevronDown" size={12} />
              <span className="min-w-0 flex-1" />
              {gi === 0 && <Glyph name="plus" size={15} />}
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <SessionRow key={item.id} item={item} active={item.id === activeSessionId} f={f} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-line p-2">
        <span className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <UserAvatar name={f.user.name} />
          <span className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-medium) text-fg">
            {f.user.name}
          </span>
        </span>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Chat header (W7: PanelsToolbar; W4: StatChip)
// ---------------------------------------------------------------------------

export function ChatHeader({
  f,
  dock,
}: {
  f: Fixtures;
  /** Which dock toggle reads as pressed. */
  dock: "none" | "bottom" | "right";
}) {
  const s = f.session;
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="truncate text-sm font-(--ui-weight-strong) text-fg">{s.title}</h1>
        {s.running && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-tone-success-fg">
            <Spinner size="sm" label={f.copy.chat.runStates.running} />
            {f.copy.chat.runStates.running}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1">
        <IconButton icon="panelBottom" label={f.copy.dock.bottomDock} pressed={dock === "bottom"} />
        <IconButton icon="panelRight" label={f.copy.dock.rightDock} pressed={dock === "right"} />
      </span>
      <span className="flex items-center gap-3 px-2 text-fg-muted">
        <StatChip glyph="tokens" value={tokens(s.totals.tokens)} />
        <StatChip glyph="cost" value={usd(s.totals.costUsd)} />
        <StatChip glyph="clock" value={duration(s.totals.elapsedMs)} />
      </span>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Dock frame (W7: DockFrame, DockTabs)
// ---------------------------------------------------------------------------

export function DockFrame({
  f,
  tab,
  glyph,
  children,
  edge,
}: {
  f: Fixtures;
  tab: string;
  glyph: GlyphName;
  children: ReactNode;
  edge: "bottom" | "right";
}) {
  return (
    <section
      className={`ui-frame flex min-h-0 w-full flex-col bg-canvas ${
        edge === "right" ? "h-full border-l border-line" : "border-t border-line"
      }`}
    >
      <div
        data-slot="head"
        className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-2 py-1.5 text-xs"
      >
        <span className="flex h-7 max-w-56 items-center gap-1.5 rounded-md bg-accent-muted pl-2 pr-1 text-fg">
          <Glyph name={glyph} size={14} className="text-fg-muted" />
          <span className="min-w-0 truncate">{tab}</span>
          <span className="flex h-4 w-4 items-center justify-center rounded-sm text-fg-subtle">
            <Glyph name="cross" size={11} />
          </span>
        </span>
        <span className="flex items-center gap-1">
          <IconButton icon="plus" size="sm" label={f.copy.dock.newPanel} />
          <IconButton
            icon={edge === "right" ? "panelBottom" : "panelRight"}
            size="sm"
            label={edge === "right" ? f.copy.dock.moveToBottom : f.copy.dock.moveToRight}
          />
          <IconButton icon="cross" size="sm" label={f.copy.dock.hideDock} />
        </span>
      </div>
      <div data-slot="body" className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </section>
  );
}
