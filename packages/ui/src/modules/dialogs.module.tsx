/**
 * Dialogs & confirmation: what the product lays over a page when it has to ask.
 *
 * - Confirm: the Agents page, an Agent about to be deleted — the card's mark says how serious it
 *   is and its body names the Agent and what deleting it costs. The reader answers it: cancel,
 *   or delete and see the toast, then ask again from another card's delete;
 * - Form: the manual path to the same object, a form inside a dialog — a name, a model and how it
 *   asks before it acts;
 * - Full screen: the Workspace browser, the dialog that takes the whole window;
 * - Sheet: the same dialog at phone width, where it comes up from the bottom edge instead.
 *
 * Static stand-ins for W3's `Modal`, `ConfirmModal`, `PagedDialog` and `Drawer` / `Sheet`, and
 * W7's `FileTree`.
 */
import { useCallback, useState } from "react";
import { fixturesFor } from "../fixtures";
import type { FileNode, FixtureAgent, Fixtures } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import { bytes } from "../screens/format";
import { Markdown } from "../screens/markdown";
import { UserBubble } from "../screens/transcript";
import {
  AgentCard,
  AgentsHeader,
  Backdrop,
  Breadcrumbs,
  Button,
  ConfirmModal,
  Field,
  GlyphIcon,
  Heading,
  IconButton,
  Input,
  MenuItem,
  MenuSeparator,
  Modal,
  Presence,
  Radio,
  Select,
  Toast,
  treeInset,
  useDismiss,
  useLater,
} from "./parts";

/** Every dialog here opens over the same page, so the four cards read as one language. */
const STAGE = "relative h-[32rem] overflow-hidden rounded-lg border border-line bg-canvas";

/** The scrim and the box that centres a dialog on the stage. */
const OVER = "absolute inset-0 flex bg-[var(--ui-overlay-backdrop)]";

/** The approval modes the new-Agent form offers, in the order it lists them. */
const APPROVALS = ["always-ask", "read-only", "allow-all"] as const;

/** The Agents page the dialogs open over: its two create paths, a search and one card per Agent. */
function AgentsPage({
  f,
  target,
  pressed = false,
  agents = f.agents,
  onDelete,
}: {
  f: Fixtures;
  /** The Agent the dialog is about. */
  target: string;
  /** The pointer is on that Agent's destructive action. */
  pressed?: boolean;
  /** The cards to list: the fixtures' Agents, less any the reader has deleted. */
  agents?: readonly FixtureAgent[];
  /** Makes each card's delete a real button asking about that Agent. */
  onDelete?: (agentId: string) => void;
}) {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 p-6">
      <AgentsHeader f={f} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            f={f}
            agent={agent}
            deleting={pressed && agent.id === target}
            onDelete={onDelete && (() => onDelete(agent.id))}
          />
        ))}
      </div>
    </div>
  );
}

/** How long the toast a confirmed delete leaves stays before it goes. */
const TOAST_MS = 4000;

/**
 * Confirm, as the reader uses it. It opens as the still does — the reviewer's delete under the
 * pointer, the scrim and the card over the page — and from there Cancel, Esc or a press on the
 * scrim closes it, Delete removes the card from the page and leaves a toast in the corner, and
 * any other deletable card's delete asks about that Agent. The card enters from the centre and
 * the scrim fades; each theme animates those words its own way.
 */
function Confirm({ f }: { f: Fixtures }) {
  const a = f.copy.agents;
  const later = useLater();
  // The reviewer, not the Project's own Agent: a confirmation is worth reading when the thing
  // behind it is one of several.
  const [target, setTarget] = useState(f.agents[f.agents.length - 1]!.id);
  const [open, setOpen] = useState(true);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const agent = f.agents.find((candidate) => candidate.id === target)!;
  const close = useCallback(() => setOpen(false), []);
  const card = useDismiss<HTMLDivElement>(open, close);
  const confirm = () => {
    setGone((now) => new Set(now).add(agent.id));
    setOpen(false);
    setToast(a.deleted(agent.name));
    later(() => setToast(null), TOAST_MS);
  };
  return (
    <div className={STAGE}>
      <div className="h-full overflow-hidden">
        <AgentsPage
          f={f}
          target={target}
          pressed={open}
          agents={f.agents.filter((candidate) => !gone.has(candidate.id))}
          onDelete={(id) => {
            setTarget(id);
            setOpen(true);
          }}
        />
      </div>
      <Backdrop show={open} appear={false} />
      <div
        className={`absolute inset-0 flex items-center justify-center p-6 ${open ? "" : "pointer-events-none"}`}
      >
        <Presence show={open} side="center" appear={false} className="w-full max-w-sm">
          <div ref={card}>
            <ConfirmModal
              tone="danger"
              title={a.deleteTitle(agent.name)}
              body={a.deleteBody}
              cancel={f.copy.common.cancel}
              confirm={f.copy.common.delete}
              onCancel={close}
              onConfirm={confirm}
            />
          </div>
        </Presence>
      </div>
      <Presence show={toast !== null} side="bottom" className="absolute bottom-4 right-4 w-80">
        <Toast tone="success" title={toast ?? ""} />
      </Presence>
    </div>
  );
}

/** Form: the manual path — the same object, asked for field by field. */
function FormDialog({ f }: { f: Fixtures }) {
  const d = f.dialogs.form;
  const a = f.copy.agents;
  const model = f.models.find((m) => m.isDefault) ?? f.models[0]!;
  return (
    <div className={STAGE}>
      <div className="h-full overflow-hidden">
        <AgentsPage f={f} target={f.agents[0]!.id} />
      </div>
      <div className={`${OVER} items-start justify-center px-6 py-10`}>
        <Modal
          className="w-full max-w-lg"
          title={a.newAgent}
          description={a.info}
          footer={
            <>
              <Button variant="secondary" size="sm">
                {f.copy.common.cancel}
              </Button>
              <Button variant="primary" size="sm">
                {d.submit}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-5 py-2">
            <Field label={d.nameLabel} required hint={d.nameHint}>
              <Input value={d.nameValue} state="focus" />
            </Field>
            <Field label={f.copy.models.model}>
              <Select value={model.displayName} />
            </Field>
            <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-2">
              <legend className="mb-1 text-sm font-(--ui-weight-medium) text-fg">
                {d.approvalLabel}
              </legend>
              <p className="text-xs text-fg-muted">{d.approvalHint}</p>
              {APPROVALS.map((mode) => (
                <Radio
                  key={mode}
                  checked={mode === f.session.composer.approvalMode}
                  label={f.copy.chat.approvalModes[mode]}
                />
              ))}
            </fieldset>
          </div>
        </Modal>
      </div>
    </div>
  );
}

/**
 * One row of the browser. The folder and file marks are what tell the two apart, so they are
 * never decorative and stay in every theme; a file adds its size and a folder its way in.
 */
function BrowserRow({
  node,
  depth = 0,
  last = false,
  selected = false,
}: {
  node: FileNode;
  depth?: number;
  /** The last row of its level, where a theme's connector rule turns the corner. */
  last?: boolean;
  selected?: boolean;
}) {
  return (
    <li
      data-depth={depth}
      data-last={last ? "true" : undefined}
      style={{ paddingLeft: treeInset(depth) }}
      className={`flex h-8 items-center gap-2 rounded-sm pr-2 text-sm ${
        selected ? "bg-accent-muted text-fg" : "text-fg-muted"
      }`}
    >
      <GlyphIcon
        name={node.kind === "dir" ? "folder" : "file"}
        size={14}
        className={selected ? "text-fg" : "text-fg-subtle"}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {node.kind === "file" && node.sizeBytes !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
          {bytes(node.sizeBytes)}
        </span>
      )}
      {node.kind === "dir" && (
        <GlyphIcon name="chevronRight" size={12} className="text-fg-subtle" />
      )}
    </li>
  );
}

/**
 * The browser's folder rail (W7: `FileTree`). Its rows nest, so the list wears `ui-tree` and each
 * row carries its depth and whether it closes its level; a theme draws the connector rules from
 * those, and the indent comes from its own tree ladder rather than from a number written here.
 */
function FileTree({ root, folders }: { root: FileNode; folders: readonly FileNode[] }) {
  return (
    <ul className="ui-tree w-56 shrink-0 overflow-hidden py-2 pr-2">
      <BrowserRow node={root} last={folders.length === 0} selected />
      {folders.map((node, i) => (
        <BrowserRow key={node.path} node={node} depth={1} last={i === folders.length - 1} />
      ))}
    </ul>
  );
}

/**
 * Full screen: the Workspace browser. A dialog this size is a page in every way but one — it has
 * a way out and nothing behind it is reachable — so it keeps the dialog's scrim, its Esc and its
 * two closing buttons rather than becoming a route of its own.
 */
function FullDialog({ f }: { f: Fixtures }) {
  const d = f.dialogs.full;
  // The Workspace root is what a folder picker opens on and what it would pick; the rail below it
  // is where the reader goes to pick something else.
  const picked = f.fileTree;
  const folders = (picked.children ?? []).filter((node) => node.kind === "dir");
  return (
    <div className={STAGE}>
      <div className="h-full overflow-hidden">
        <AgentsPage f={f} target={f.agents[0]!.id} />
      </div>
      <div className={`${OVER} p-4`}>
        <Modal className="flex min-h-0 w-full flex-col">
          <header className="flex shrink-0 items-start gap-2 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1">
              <Heading level={3}>{d.title}</Heading>
              <p className="mt-0.5 text-sm text-fg-muted">{d.hint}</p>
            </div>
            <IconButton label={f.copy.common.close} icon="cross" />
          </header>
          <div className="flex min-h-0 flex-1 divide-x divide-line">
            <FileTree root={picked} folders={folders} />
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2 px-5 py-3">
              <Breadcrumbs items={picked.path.split("/")} />
              <ul className="overflow-hidden">
                {(picked.children ?? []).map((node) => (
                  <BrowserRow key={node.path} node={node} />
                ))}
              </ul>
            </div>
          </div>
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
              {picked.path}
            </span>
            <Button variant="secondary" size="sm">
              {f.copy.common.cancel}
            </Button>
            <Button variant="primary" size="sm">
              {d.choose}
            </Button>
          </footer>
        </Modal>
      </div>
    </div>
  );
}

/**
 * Sheet: the same dialog at phone width. A centred card with a scrim around it wastes a phone's
 * screen and sits under the thumb, so below `sm` the dialog comes up from the bottom edge, keeps
 * its rows at a finger's height and drops the keyboard shortcuts nobody can press.
 */
function SheetDialog({ f }: { f: Fixtures }) {
  const turn = f.session.turns[1]!;
  const prompt = turn.items.find((item) => item.id === "u2");
  const reply = turn.items.find((item) => item.id === "tx4");
  return (
    <div className="flex h-[32rem] justify-center overflow-hidden bg-surface-muted py-4">
      <div className="relative flex w-[24.375rem] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-canvas">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
          <IconButton label={f.copy.nav.sessions} icon="chevronLeft" size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-medium) text-fg">
            {f.session.title}
          </span>
          <IconButton label={f.copy.common.more} icon="more" size="sm" pressed />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-3">
          {prompt?.kind === "user" && <UserBubble item={prompt} dense />}
          {reply?.kind === "text" && <Markdown text={reply.markdown} size="sm" />}
        </div>
        <div className="absolute inset-0 flex flex-col justify-end bg-[var(--ui-overlay-backdrop)]">
          <Modal className="w-full rounded-b-none [--radius-inner:max(var(--ui-radius-xs),calc(var(--ui-radius-lg)-0.5rem))]">
            <div className="flex justify-center pt-2">
              <span
                aria-hidden
                className="h-1 w-10 rounded-[var(--ui-radius-pill)] bg-line-emphasis"
              />
            </div>
            <p className="px-4 pb-1 pt-3 text-sm font-(--ui-weight-medium) text-fg">
              {f.dialogs.sheet.title}
            </p>
            <div className="px-2 pb-1">
              {f.menus.message.map((item, i) =>
                item === "separator" ? (
                  <MenuSeparator key={i} />
                ) : (
                  <MenuItem
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    danger={item.danger}
                  />
                ),
              )}
            </div>
            <div className="flex justify-end px-4 pb-4 pt-1">
              <Button variant="secondary" size="md">
                {f.copy.common.cancel}
              </Button>
            </div>
          </Modal>
        </div>
      </div>
    </div>
  );
}

const VARIANTS = {
  confirm: Confirm,
  form: FormDialog,
  full: FullDialog,
  sheet: SheetDialog,
} as const;

export const module = defineModule({
  id: "dialogs",
  title: "Dialogs & confirmation",
  description:
    "What the product lays over a page to ask: the destructive confirmation, a dialog holding a form, the full-screen browser, and the sheet a phone gets instead of a centred card.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "confirm", title: "Confirm", kind: "interactive" },
    { key: "form", title: "Form", kind: "static" },
    { key: "full", title: "Full screen", kind: "static" },
    { key: "sheet", title: "Sheet", kind: "static" },
  ],
  parts: [
    "overlays-modal",
    "overlays-confirm-modal",
    "overlays-paged-dialog",
    "overlays-drawer",
    "overlays-lightbox",
    "actions-button",
    "forms-field",
    "forms-input",
    "forms-select",
    "forms-radio",
    "overlays-toaster",
    "files-file-browser",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Confirm;
    return <View f={fixturesFor(lang)} />;
  },
});
