/**
 * Shell pieces shared by the screen mock-ups: the app shell, marks, the sidebar, the chat
 * header, the dock frame and a disclosure body. Static JSX on token utilities and the declared
 * style hooks only — no palette class, no `dark:` pair, no state — so the three themes differ
 * purely through their tokens.
 *
 * Each piece names the web app component it imitates. When that component moves into this
 * package (the wave is noted), the screen swaps the piece for the real thing.
 */
import type { ReactNode } from "react";
import { Spinner } from "../components/icons/spinner/spinner";
import type { Fixtures, RunState, SessionGroup, SessionListItem } from "../fixtures";
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
// Shell (W7: AppShell; W4: DisclosureRow's body)
// ---------------------------------------------------------------------------

/**
 * The product's own window: a navigation column and a main column, and at times a dock. `.ui-shell`
 * lets a theme lay the three out as its own — Frost floats the main column as a sheet on a colour
 * field, Console rules them apart edge to edge, Primer leaves the classes as they are — so the
 * children say which is which, `data-slot="nav"`, `"main"` or `"dock"`, and the nav's selected
 * row carries `aria-current="page"`.
 */
export function AppShell({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`ui-shell ${className}`}>{children}</div>;
}

/**
 * A body that opens and folds by height: a one-row grid between `0fr` and `1fr`, which the theme
 * animates through `data-layout-motion`, around a box that clips what the row has not opened yet.
 * `list` makes it a list item holding a list, for a tree's children.
 */
export function DisclosureBody({
  open,
  list = false,
  children,
}: {
  open: boolean;
  list?: boolean;
  children: ReactNode;
}) {
  const rows = open ? "grid-rows-[1fr]" : "grid-rows-[0fr]";
  return list ? (
    <li data-layout-motion aria-hidden={open ? undefined : true} className={`grid ${rows}`}>
      <ul className="min-h-0 overflow-hidden">{children}</ul>
    </li>
  ) : (
    <div data-layout-motion aria-hidden={open ? undefined : true} className={`grid ${rows}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marks (W1: Spinner, Dot, StatusIcon, AgentAvatar)
// ---------------------------------------------------------------------------

/**
 * The one Spinner already lives in the component set (rule 11 gives it the only `animate-spin`);
 * the screens re-export it so W1 removes this line rather than rewriting call sites.
 */
export { Spinner };

/** A 6 px state dot. Dots stay round in every theme; that is what `rounded-full` is kept for. */
export function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
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
  hovered = false,
  glyphSize,
}: {
  icon: GlyphName;
  label: string;
  /** 32 px in a header or toolbar, 24 px in a dense row. */
  size?: "sm" | "md";
  pressed?: boolean;
  /** Drawn as if under the pointer: the ink deepened, still no fill. */
  hovered?: boolean;
  /** The glyph's own size where the app draws it larger or smaller than the box's default. */
  glyphSize?: number;
}) {
  const box = size === "md" ? "h-8 w-8" : "h-6 w-6";
  return (
    <span
      title={label}
      aria-label={label}
      role="button"
      className={`flex ${box} shrink-0 items-center justify-center rounded-control ${
        pressed ? "bg-accent-muted text-fg" : hovered ? "text-fg" : "text-fg-subtle hover:text-fg"
      }`}
    >
      <Glyph name={icon} size={glyphSize ?? (size === "md" ? 15 : 14)} />
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
  children,
}: {
  tone?: ToneName;
  variant?: "soft" | "outline" | "solid";
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
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[var(--ui-radius-pill)] px-2 py-0.5 text-xs font-(--ui-weight-medium) ${look}`}
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
  mono = true,
}: {
  glyph: GlyphName;
  value: string;
  title?: string;
  /** The chat header sets its figures in mono; the stats line under a reply does not. */
  mono?: boolean;
}) {
  return (
    <span
      title={title}
      className={`flex shrink-0 items-center gap-1 text-xs tabular-nums ${mono ? "font-mono" : ""}`}
    >
      <Glyph name={glyph} size={13} />
      {value}
    </span>
  );
}

/**
 * A group label above a list (W4: GroupHeader), with the group's own actions on the right. The
 * `.ui-eyebrow` hook decides a group label's case, weight and colour — Console uppercases it, the
 * others do not — so the markup carries only the caption rung as a floor for a theme with no
 * recipe yet. A `name` (a Workspace folder) is set as written instead, after its folder glyph,
 * with its count and the chevron that folds it.
 */
export function GroupHeader({
  label,
  actions,
  name = false,
  icon,
  count,
  subtle = false,
}: {
  label: string;
  actions?: ReactNode;
  name?: boolean;
  icon?: GlyphName;
  count?: number;
  /** The faintest ink, as the sidebar's Sessions label is set. */
  subtle?: boolean;
}) {
  if (!name) {
    return (
      <div className="flex items-center gap-1">
        <span
          className={`ui-eyebrow min-w-0 flex-1 px-1 text-xs font-(--ui-weight-strong) ${
            subtle ? "text-fg-subtle" : "text-fg-muted"
          }`}
        >
          {label}
        </span>
        {actions}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 px-1 pb-px">
      <span className="flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5">
        {icon && <Glyph name={icon} size={15} decor="group" className="text-fg-subtle" />}
        <span className="min-w-0 truncate text-xs font-(--ui-weight-strong) text-fg-muted">
          {label}
        </span>
        {count !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{count}</span>
        )}
        <Glyph name="chevronDown" size={12} className="text-fg-subtle" />
      </span>
      {actions}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar (W7: SidebarFrame, SessionRow; W4: NavList, GroupHeader)
// ---------------------------------------------------------------------------

/** The page entries under New chat, in the app's order. */
export const SIDEBAR_NAV = [
  { key: "agents", glyph: "agents" },
  { key: "plugins", glyph: "plugins" },
  { key: "models", glyph: "models" },
  { key: "usage", glyph: "usage" },
  { key: "benchmark", glyph: "benchmark" },
] as const satisfies ReadonlyArray<{ key: keyof Fixtures["copy"]["nav"]; glyph: GlyphName }>;

export type SidebarPage = (typeof SIDEBAR_NAV)[number]["key"];

/**
 * A nav row. The app's rest ink is a step between the muted and the primary ink, which the token
 * contract has no name for; the muted ink is the nearer.
 */
function NavRow({
  glyph,
  label,
  active = false,
  strong = false,
}: {
  glyph: GlyphName;
  label: string;
  active?: boolean;
  /** New chat: the one pinned entry, set in the medium weight. */
  strong?: boolean;
}) {
  return (
    <span
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
        active
          ? "bg-accent-muted font-(--ui-weight-medium) text-fg"
          : `text-fg-muted ${strong ? "font-(--ui-weight-medium)" : ""}`
      }`}
    >
      <Glyph name={glyph} size={16} decor="nav" className="text-fg-muted" />
      {label}
    </span>
  );
}

/**
 * What a session row says about its Task after the title: a turning hourglass in the attention
 * ink while it runs, a dot in the success ink once it finished with a reply not yet read, and an
 * empty slot otherwise — the slot is kept so a title never reflows when a run starts.
 */
function ActivityMark({ item, f }: { item: SessionListItem; f: Fixtures }) {
  if (item.running) {
    return (
      <span title={f.copy.chat.runStates.running} className="text-tone-attention-fg">
        <Glyph name="hourglass" size={12} />
      </span>
    );
  }
  if (item.unread) {
    return (
      <span className="flex h-3 w-3 shrink-0 items-center justify-center">
        <Dot className="bg-tone-success-emphasis" />
      </span>
    );
  }
  return <span aria-hidden className="block h-3 w-3 shrink-0" />;
}

/**
 * A session row: the Agent's tile, the title, the standing marks, the activity mark, then a slot
 * that holds the last-active time at rest and the row's own actions on hover. The slot is as wide
 * as the widest time the language prints, so the marks before it line up from row to row.
 */
function SessionRow({
  item,
  active,
  hovered,
  f,
  onOpen,
}: {
  item: SessionListItem;
  active: boolean;
  hovered: boolean;
  f: Fixtures;
  onOpen?: () => void;
}) {
  const agent = f.agents.find((a) => a.id === item.agentId);
  const body = (
    <>
      <AgentTile id={item.agentId} name={agent?.name ?? item.agentId} />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          active ? "font-(--ui-weight-medium) text-fg" : "text-fg"
        }`}
      >
        {item.title}
      </span>
      {item.pinned && <Glyph name="pin" size={12} className="text-fg-muted" />}
      {item.scheduled && <Glyph name="calendarClock" size={12} className="text-fg-muted" />}
      <ActivityMark item={item} f={f} />
    </>
  );
  const main = "flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left";
  return (
    <li
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-md pr-1 ${
        active ? "bg-accent-muted" : hovered ? NEUTRAL_FILL : ""
      }`}
    >
      {onOpen ? (
        <button type="button" onClick={onOpen} className={main}>
          {body}
        </button>
      ) : (
        <span className={main}>{body}</span>
      )}
      <span
        className={`flex h-6 shrink-0 items-center justify-end ${
          f.lang === "zh" ? "w-[4.5rem]" : "w-14"
        }`}
      >
        {hovered ? (
          <>
            <IconButton icon="pin" size="sm" label={f.copy.nav.pin} />
            <IconButton icon="more" size="sm" label={f.copy.common.more} />
          </>
        ) : (
          <span className="whitespace-nowrap px-1 text-xs tabular-nums text-fg-subtle">
            {item.timeLabel}
          </span>
        )}
      </span>
    </li>
  );
}

export interface SidebarProps {
  f: Fixtures;
  /** The open Session, whose row reads as current. */
  activeSessionId?: string;
  /** The page the app is on, whose nav row reads as current instead. */
  activePage?: SidebarPage;
  /** One row caught under the pointer, showing its actions. */
  hoveredSessionId?: string;
  /** The groups to list; the fixtures' own by default. */
  groups?: readonly SessionGroup[];
  /** Rows become buttons that open their Session. */
  onOpenSession?: (id: string) => void;
}

/**
 * The pinned sidebar's contents, top to bottom as the app lays them out: the collapse button and
 * the Project switcher; New chat, pinned; then one scroll area with the page entries, the seam
 * that folds them, the Sessions header with its three controls, and the Workspace groups; and
 * the user row — the avatar, the name and the role — at the foot.
 */
export function SidebarBody({
  f,
  activeSessionId,
  activePage,
  hoveredSessionId,
  groups = f.sessionGroups,
  onOpenSession,
}: SidebarProps) {
  const c = f.copy.nav;
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <IconButton icon="collapseLeft" label={c.collapseSidebar} glyphSize={18} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-(--ui-weight-strong) text-fg">
          <span className="min-w-0 flex-1 truncate">{f.project.name}</span>
          <Glyph name="chevronDown" size={14} className="text-fg-subtle" />
        </span>
      </div>
      <div className="shrink-0 px-2 pb-2 pt-2">
        <NavRow glyph="newChat" label={c.newChat} strong />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
        <nav className="space-y-px">
          {SIDEBAR_NAV.map((item) => (
            <NavRow
              key={item.key}
              glyph={item.glyph}
              label={c[item.key]}
              active={item.key === activePage}
            />
          ))}
          <span
            title={c.collapseGroup}
            className={`flex h-4 w-full items-center justify-center rounded-md text-fg-subtle ${NEUTRAL_FILL}`}
          >
            <Glyph name="chevronUp" size={12} />
          </span>
        </nav>
        <div className="mt-3 px-1 pt-2">
          <GroupHeader
            label={c.sessions}
            subtle
            actions={
              <span className="flex items-center">
                <IconButton icon="search" size="sm" label={c.search} glyphSize={14} />
                <IconButton icon="sliders" size="sm" label={c.filterSessions} glyphSize={14} />
                <IconButton icon="folderPlus" size="sm" label={c.newFolder} glyphSize={15} />
              </span>
            }
          />
        </div>
        {groups.map((group) => (
          <div key={group.key} className="pt-2.5">
            <GroupHeader
              name
              icon="folder"
              label={group.label}
              count={group.items.length}
              actions={<IconButton icon="plus" size="sm" label={c.newChat} />}
            />
            <ul className="space-y-px">
              {group.items.map((item) => (
                <SessionRow
                  key={item.id}
                  item={item}
                  active={item.id === activeSessionId}
                  hovered={item.id === hoveredSessionId}
                  f={f}
                  onOpen={onOpenSession ? () => onOpenSession(item.id) : undefined}
                />
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
          {f.user.isAdmin && <span className="text-xs text-fg-subtle">{f.copy.auth.admin}</span>}
        </span>
      </div>
    </>
  );
}

/** The pinned sidebar at the app's width beside a 1024 px or wider window (`lg:w-72`). */
export function Sidebar(props: SidebarProps) {
  return (
    <aside
      data-slot="nav"
      className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface-muted"
    >
      <SidebarBody {...props} />
    </aside>
  );
}

/**
 * The collapsed rail's entries, top to bottom: expand, the last conversation, New chat, the page
 * entries, and the account avatar at the foot. `renderEntry` wraps each page entry, so a caller can
 * hang a tooltip or a scene off one; every entry is an icon, named by its label.
 */
export function RailBody({
  f,
  activePage,
  hovered,
  renderEntry = (node) => node,
}: {
  f: Fixtures;
  activePage?: SidebarPage;
  /** A page entry caught under the pointer. */
  hovered?: SidebarPage;
  renderEntry?: (node: ReactNode, page: SidebarPage) => ReactNode;
}) {
  const c = f.copy.nav;
  return (
    <>
      <IconButton icon="expandRight" label={c.expandSidebar} glyphSize={18} />
      <span className="mt-1 flex flex-col items-center gap-1">
        <IconButton icon="history" label={c.lastConversation} glyphSize={18} />
        <IconButton icon="newChat" label={c.newChat} glyphSize={18} />
        {SIDEBAR_NAV.map((item) => (
          <span key={item.key} className="relative">
            {renderEntry(
              <IconButton
                icon={item.glyph}
                label={c[item.key]}
                glyphSize={18}
                pressed={item.key === activePage}
                hovered={item.key === hovered}
              />,
              item.key,
            )}
          </span>
        ))}
      </span>
      <span className="min-h-0 flex-1" />
      <span title={c.userSettings} className="flex h-8 w-8 items-center justify-center">
        <UserAvatar name={f.user.name} />
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Launcher (W7: LauncherBall)
// ---------------------------------------------------------------------------

/**
 * The floating ball on the chat body's right edge while no dock is open there, resting halfway
 * down with its caption under it: a round button with the workbench glyph that fans out the
 * dock's panels. Its caller places it (`absolute` in the chat body's own box).
 */
export function LauncherBall({ f }: { f: Fixtures }) {
  const label = f.copy.dock.launcher;
  return (
    <span className="pointer-events-none absolute right-8 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1">
      <span
        role="button"
        aria-label={label}
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-[var(--ui-radius-pill)] border border-line bg-surface text-fg-muted shadow-lg"
      >
        <Glyph name="workbench" size={22} />
      </span>
      <span
        aria-hidden
        className="whitespace-nowrap rounded-md border border-line bg-surface px-2 py-0.5 text-sm font-(--ui-weight-medium) text-fg shadow-sm"
      >
        {label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Chat header (W7: PanelsToolbar; W4: StatChip)
// ---------------------------------------------------------------------------

/** A dock toggle: a short labelled-by-tooltip button, filled while its dock is open. */
function DockToggle({ glyph, label, open }: { glyph: GlyphName; label: string; open: boolean }) {
  return (
    <span
      role="button"
      aria-label={label}
      aria-pressed={open}
      title={label}
      className={`flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-(--ui-weight-medium) ${
        open ? "bg-accent-muted text-fg" : "text-fg-muted"
      }`}
    >
      <Glyph name={glyph} size={15} />
    </span>
  );
}

/**
 * The chat's toolbar: the Session title, a running Task's hourglass and word, the two dock
 * toggles, and the Session's totals — tokens, cost, elapsed — on one button that opens its info
 * card.
 */
export function ChatHeader({
  f,
  dock,
}: {
  f: Fixtures;
  /** Which dock toggle reads as pressed. */
  dock: "none" | "bottom" | "right";
}) {
  const s = f.session;
  const c = f.copy.chat;
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-(--ui-weight-strong) text-fg">{s.title}</h1>
        {s.running && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
            <span className="text-tone-attention-fg">
              <Glyph name="hourglass" size={12} />
            </span>
            {c.runStates.running}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1">
        <DockToggle glyph="panelBottom" label={f.copy.dock.bottomDock} open={dock === "bottom"} />
        <DockToggle glyph="panelRight" label={f.copy.dock.rightDock} open={dock === "right"} />
      </span>
      <span className="flex h-7 items-center gap-3 rounded-md px-2 text-fg-muted">
        <StatChip
          glyph="tokens"
          value={tokens(s.totals.tokens)}
          title={`${c.statTokens}（Token）`}
        />
        <StatChip
          glyph="cost"
          value={usd(s.totals.costUsd)}
          title={`${f.copy.traces.cost}（USD）`}
        />
        <StatChip
          glyph="clock"
          value={duration(s.totals.elapsedMs)}
          title={f.copy.traces.elapsed}
        />
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
          <span
            title={f.copy.dock.closeTab}
            className="flex h-4 w-4 items-center justify-center rounded-sm text-fg-subtle"
          >
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
