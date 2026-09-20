/**
 * Overlays: what opens over the chat, each on the same settled transcript.
 *
 * - Menu: a message's context menu (compact rows, separators, a danger item, shortcuts), the dock's
 *   add-panel menu (rows with descriptions), an info popover and a tooltip;
 * - Dialog: the paged settings dialog over the dimmed chat, a discard confirmation above it;
 * - Drawer: a Trace file's details in a side drawer;
 * - Toasts: the stack in the corner;
 * - Palette: the command palette as it opens — its commands and recent chats, and key hints.
 *
 * Static stand-ins for W3's `Menu`, `FloatingPanel`, `InfoPopover`, `Tooltip`, `Modal`,
 * `PagedDialog`, `ConfirmModal`, `Drawer` and `Toaster`, and W8's `CommandPalette`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { ChatTurn, Fixtures } from "../fixtures";
import { defineModule, viewFor } from "../module";
import { bytes } from "../screens/format";
import { AgentTile } from "../screens/parts";
import { Turn } from "../screens/transcript";
import {
  Button,
  FloatingPanel,
  GlyphIcon,
  IconButton,
  Kbd,
  KeyValue,
  Link,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Modal,
  PrefRow,
  Segmented,
  Switch,
  Toast,
  Tooltip,
} from "./parts";

/**
 * The quiet part of the conversation — prompts and short replies, no code or tables — so an
 * overlay reads against the page it covers instead of competing with it.
 */
function quietTurns(f: Fixtures): ChatTurn[] {
  const [turn1, turn2] = f.session.turns;
  const pick = (turn: ChatTurn | undefined, ids: readonly string[]): ChatTurn[] =>
    turn
      ? [{ index: turn.index, running: false, items: turn.items.filter((i) => ids.includes(i.id)) }]
      : [];
  return [...pick(turn1, ["u1", "tx1", "tx2"]), ...pick(turn2, ["u2", "tx4"])];
}

/** The chat every overlay opens over; `dim` lays the modal backdrop on it. */
function Stage({
  f,
  dim = false,
  className,
  children,
}: {
  f: Fixtures;
  dim?: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className="relative h-[36rem] overflow-hidden rounded-lg border border-line bg-canvas">
      <div aria-hidden className="h-full overflow-hidden px-10 py-4">
        <div className="mx-auto max-w-2xl">
          {quietTurns(f).map((turn) => (
            <Turn key={turn.index} turn={turn} f={f} />
          ))}
        </div>
      </div>
      {dim && <div className="absolute inset-0 bg-[var(--ui-overlay-backdrop)]" />}
      <div className={`absolute inset-0 flex p-6 ${className}`}>{children}</div>
    </div>
  );
}

/**
 * W3's `InfoPopover`, open: the circled "?" that sits after the title it explains, and the panel it
 * discloses. The app portals the panel; here it hangs below the row that holds the title (the
 * nearest positioned box).
 */
function InfoPopover({ f }: { f: Fixtures }) {
  const s = f.copy.settings;
  return (
    <>
      <GlyphIcon name="help" size={14} />
      <FloatingPanel className="absolute right-0 top-[calc(100%+0.375rem)] w-72">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2 py-1.5 text-sm font-(--ui-weight-body)">
          <p className="text-fg-muted">{s.toolAliasesInfo}</p>
          <p className="pt-1">
            <Link external>{f.copy.common.learnMore}</Link>
          </p>
        </div>
      </FloatingPanel>
    </>
  );
}

function Menus({ f }: { f: Fixtures }) {
  const tooltip = f.copy.chat.sendToBackground;
  return (
    <Stage f={f} className="items-start justify-between">
      <div className="grid grid-cols-[minmax(0,1fr)] w-60 gap-6">
        <FloatingPanel>
          {f.menus.message.map((item, i) =>
            item === "separator" ? (
              <MenuSeparator key={i} />
            ) : (
              <MenuItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                shortcut={item.shortcut}
                danger={item.danger}
                active={i === 1}
              />
            ),
          )}
        </FloatingPanel>
        <span className="flex items-center gap-2">
          <IconButton label={tooltip} icon="arrowDownLine" hovered />
          <Tooltip label={tooltip} />
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] w-80 justify-items-end gap-6">
        <FloatingPanel className="w-full">
          <MenuLabel>{f.copy.dock.newPanel}</MenuLabel>
          {f.menus.panels.map((panel, i) =>
            panel === "separator" ? (
              <MenuSeparator key={i} />
            ) : (
              <MenuItem
                key={panel.label}
                icon={panel.icon}
                label={panel.label}
                description={panel.description}
                active={i === 0}
              />
            ),
          )}
        </FloatingPanel>
        {/* Where this "?" lives in the app: the Appearance row it explains. */}
        <div className="relative flex w-full items-center justify-between gap-4 rounded-md border border-line bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1 text-sm font-(--ui-weight-medium) text-fg">
            {f.copy.settings.toolAliases}
            <InfoPopover f={f} />
          </div>
          <Switch on={false} />
        </div>
      </div>
    </Stage>
  );
}

/** The settings dialog: its grouped rail and the Appearance page. */
function PagedDialog({ f }: { f: Fixtures }) {
  const s = f.copy.settings;
  const groups = [
    {
      label: s.groupPersonal,
      pages: [s.pages.profile, s.pages.general, s.pages.appearance, s.pages.account],
    },
    { label: s.groupServer, pages: [s.pages.proxy, s.pages.uploads] },
  ];
  return (
    <Modal className="flex h-[28rem] w-full max-w-3xl">
      <nav className="grid grid-cols-[minmax(0,1fr)] w-44 shrink-0 content-start gap-4 border-r border-line p-3">
        {groups.map((group) => (
          <div key={group.label} className="grid grid-cols-[minmax(0,1fr)] gap-px">
            <p className="ui-eyebrow px-2 pb-1 text-xs font-(--ui-weight-medium) text-fg-muted">
              {group.label}
            </p>
            {group.pages.map((page) => (
              <span
                key={page}
                className={`rounded-md px-2 py-1.5 text-sm ${
                  page === s.pages.appearance
                    ? "bg-accent-muted font-(--ui-weight-medium) text-fg"
                    : "text-fg-muted"
                }`}
              >
                {page}
              </span>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1 px-6 py-4">
        <p className="pb-2 text-base font-(--ui-weight-medium) text-fg">{s.pages.appearance}</p>
        <div className="divide-y divide-line-muted">
          <PrefRow
            label={s.theme}
            control={<Segmented options={[s.light, s.dark, s.system]} value={2} />}
          />
          <PrefRow
            label={s.fontSize}
            control={
              <Segmented options={[s.fontSizes.sm, s.fontSizes.md, s.fontSizes.lg]} value={2} />
            }
          />
          <PrefRow label={s.launcher} control={<Switch on />} />
        </div>
      </div>
    </Modal>
  );
}

function Dialogs({ f }: { f: Fixtures }) {
  const c = f.copy.settings.discard;
  return (
    <Stage f={f} dim className="items-center justify-center">
      <PagedDialog f={f} />
      <div className="absolute inset-0 flex items-center justify-center bg-[var(--ui-overlay-backdrop)] p-6">
        <Modal
          className="w-full max-w-sm"
          title={c.title}
          description={c.body}
          footer={
            <>
              <Button variant="secondary" size="sm">
                {c.keep}
              </Button>
              <Button variant="danger" size="sm">
                {c.confirm}
              </Button>
            </>
          }
        />
      </div>
    </Stage>
  );
}

function DrawerPanel({ f }: { f: Fixtures }) {
  const t = f.copy.traces;
  const file = f.trace.files[f.trace.activeFile]!;
  const turn = f.trace.turns[0]!;
  const { written, size, events, model } = t.fileFacts;
  return (
    <aside className="absolute inset-y-0 right-0 flex w-96 flex-col border-l border-line bg-overlay shadow-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-base font-(--ui-weight-medium) text-fg">
          {t.file(file.label)}
        </p>
        <IconButton label={f.copy.dock.hideDock} icon="cross" size="sm" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] min-h-0 flex-1 content-start gap-6 overflow-hidden p-4">
        <KeyValue
          columns={2}
          items={[
            { label: written, value: file.dateIso, mono: true },
            { label: size, value: bytes(file.sizeBytes), mono: true },
            { label: events, value: String(turn.events.length), mono: true },
            { label: model, value: f.session.model.modelId, mono: true },
          ]}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <p className="text-xs text-fg-muted">{t.latestEvents}</p>
          {turn.events.slice(-5).map((event) => (
            <p
              key={event.time}
              className="flex items-center gap-2 border-t border-line-muted py-1.5 text-xs"
            >
              <span className="font-mono tabular-nums text-fg-subtle">
                {event.time.slice(0, 8)}
              </span>
              <span className="font-mono text-fg">{event.payloadType}</span>
              <span className="min-w-0 flex-1 truncate text-fg-muted">{event.summary}</span>
            </p>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <Button variant="secondary">{f.copy.common.delete}</Button>
        <Button variant="primary" leading={<GlyphIcon name="download" size={13} />}>
          {t.export}
        </Button>
      </div>
    </aside>
  );
}

function Drawer({ f }: { f: Fixtures }) {
  return (
    <Stage f={f} dim className="">
      <DrawerPanel f={f} />
    </Stage>
  );
}

function Toasts({ f }: { f: Fixtures }) {
  return (
    <Stage f={f} className="flex-col items-end gap-2">
      {f.notices.toasts.map((toast) => (
        <Toast
          key={toast.title}
          tone={toast.tone}
          title={toast.title}
          description={toast.body}
          action={toast.action ? <Link>{toast.action}</Link> : undefined}
        />
      ))}
    </Stage>
  );
}

function CommandPalette({ f }: { f: Fixtures }) {
  const p = f.copy.palette;
  let index = 0;
  return (
    <Modal className="w-full max-w-xl self-start">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <GlyphIcon name="search" size={16} className="text-fg-subtle" />
        <span className="flex min-w-0 flex-1 items-center text-base text-fg-subtle">
          <span aria-hidden className="mr-px inline-block h-5 w-px bg-fg" />
          <span className="truncate">{p.placeholder}</span>
        </span>
        <Kbd keys={["Esc"]} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 p-2 [--radius-inner:max(var(--ui-radius-xs),calc(var(--ui-radius-lg)-0.5rem))]">
        {f.commandPalette.map((group) => (
          <div key={group.label}>
            <p className="px-2 pb-1 pt-1.5 text-xs text-fg-muted">{group.label}</p>
            {group.items.map((item) => {
              const active = index++ === 0;
              return (
                <span
                  key={item.label}
                  className={`flex items-center gap-2 rounded-[var(--radius-inner)] px-2 py-1.5 text-sm text-fg ${active ? "bg-surface-muted" : ""}`}
                >
                  {item.agentId ? (
                    <AgentTile
                      id={item.agentId}
                      name={f.agents.find((a) => a.id === item.agentId)?.name ?? item.agentId}
                      size={16}
                    />
                  ) : (
                    item.icon && <GlyphIcon name={item.icon} size={15} className="text-fg-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="text-xs text-fg-subtle">{item.hint}</span>}
                  {item.keys && <Kbd keys={item.keys} />}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-fg-muted">
        <span className="flex items-center gap-1.5">
          <Kbd keys={["↑", "↓"]} />
          {p.keyHints.navigate}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys={["↵"]} />
          {p.keyHints.open}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys={["Esc"]} />
          {p.keyHints.close}
        </span>
      </div>
    </Modal>
  );
}

function Palette({ f }: { f: Fixtures }) {
  return (
    <Stage f={f} dim className="justify-center pt-12">
      <CommandPalette f={f} />
    </Stage>
  );
}

const VARIANTS = {
  menu: Menus,
  dialog: Dialogs,
  drawer: Drawer,
  toasts: Toasts,
  palette: Palette,
} as const;

export const module = defineModule({
  id: "overlays",
  title: "Overlays",
  description:
    "What opens over the chat: a context menu, an info popover and a tooltip; a dialog; a drawer; the toast stack; the command palette.",
  width: "wide",
  variants: [
    { key: "menu", title: "Menu" },
    { key: "dialog", title: "Dialog" },
    { key: "drawer", title: "Drawer" },
    { key: "toasts", title: "Toasts" },
    { key: "palette", title: "Palette" },
  ],
  parts: [
    "overlays-modal",
    "overlays-confirm-modal",
    "overlays-paged-dialog",
    "overlays-drawer",
    "overlays-floating-panel",
    "overlays-menu",
    "overlays-dropdown",
    "overlays-portal-panel",
    "overlays-info-popover",
    "overlays-tooltip",
    "overlays-lightbox",
    "overlays-toaster",
    "navigation-command-palette",
  ],
  render: (variant, { lang }) => {
    const View = viewFor(VARIANTS, variant);
    return <View f={fixturesFor(lang)} />;
  },
});
