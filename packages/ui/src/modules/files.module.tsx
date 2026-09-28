/**
 * Files & trees: the Workspace's Files panel.
 *
 * - Tree: the tree pane — search, refresh and upload in its header, folders open to the files this
 *   session changed (marked added or modified), the selected file — beside an empty preview. The
 *   reader drives it: a folder's row opens and folds it, and a file's row picks it and previews it;
 * - Preview: the same tree beside `src/rag.ts` previewed as source, under its breadcrumbs and
 *   actions;
 * - Drop: files dragged over the preview, the drop overlay naming the target folder.
 *
 * Static stand-ins for W7's `TreePane`, `FileTree`, `PreviewPane`, `Breadcrumbs`, `DropOverlay` and
 * `ResizeHandle`.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FileNode, FilePreview, Fixtures } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import { bytes } from "../screens/format";
import { DisclosureBody } from "../screens/parts";
import { Breadcrumbs, EmptyState, GlyphIcon, IconButton, SearchInput, treeInset } from "./parts";

/** Folders shown open: the ones leading to this session's changes. */
const OPEN = new Set(["claude-code-expert", "claude-code-expert/src", "claude-code-expert/test"]);

/** What a live tree shows — the folders open and the file selected — and what its rows do. */
interface TreeState {
  open: ReadonlySet<string>;
  selected: string | null;
  /** A folder's row: open it, or fold it. */
  toggle: (path: string) => void;
  /** A file's row: pick it. */
  select: (path: string) => void;
}

function TreeRow({
  node,
  depth,
  last,
  f,
  live,
}: {
  node: FileNode;
  depth: number;
  /** The last child of its level, where a connector rule turns the corner. */
  last: boolean;
  f: Fixtures;
  /**
   * The reader's tree: every folder's children sit in a disclosure body that opens and folds by
   * height, and the rows are buttons that open, fold and pick.
   */
  live?: TreeState;
}) {
  const copy = f.copy.files;
  const open = node.kind === "dir" && (live ? live.open : OPEN).has(node.path);
  const selected = node.path === (live ? live.selected : f.filePreview.path);
  const press =
    live === undefined
      ? undefined
      : node.kind === "dir"
        ? () => live.toggle(node.path)
        : () => live.select(node.path);
  return (
    <>
      <li
        data-depth={depth}
        data-last={last ? "true" : undefined}
        role={press && "treeitem"}
        aria-expanded={node.kind === "dir" && press ? open : undefined}
        aria-selected={node.kind === "file" && press ? selected : undefined}
        tabIndex={press && 0}
        onClick={press}
        onKeyDown={
          press &&
          ((event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              press();
            }
          })
        }
        className={`flex h-7 items-center gap-1.5 rounded-sm pr-2 text-sm ${selected ? "bg-accent-muted text-fg" : "text-fg"} ${
          press && !selected ? "transition-colors duration-150 hover:bg-surface-muted" : ""
        }`}
        style={{ paddingLeft: treeInset(depth) }}
      >
        {node.kind === "dir" ? (
          <GlyphIcon
            name={open ? "chevronDown" : "chevronRight"}
            size={12}
            className="text-fg-subtle"
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <GlyphIcon
          name={node.kind === "dir" ? "folder" : "file"}
          size={14}
          className="text-fg-muted"
        />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.change && (
          <span
            title={node.change === "added" ? copy.added : copy.modified}
            className={`font-mono text-xs ${node.change === "added" ? "text-tone-success-fg" : "text-tone-attention-fg"}`}
          >
            {node.change === "added" ? "A" : "M"}
          </span>
        )}
        {node.kind === "file" && node.sizeBytes !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
            {bytes(node.sizeBytes)}
          </span>
        )}
      </li>
      {live && node.children ? (
        <DisclosureBody open={open} list>
          {node.children.map((child, i) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              last={i === node.children!.length - 1}
              f={f}
              live={live}
            />
          ))}
        </DisclosureBody>
      ) : (
        open &&
        node.children?.map((child, i) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            last={i === node.children!.length - 1}
            f={f}
          />
        ))
      )}
    </>
  );
}

/**
 * The tree itself: rows that nest, so it wears `ui-tree` and each row says how deep it sits and
 * whether it closes its level. Rows indent on the hook's ladder, and each theme draws the columns
 * that ladder gives — Console connector rules, Frost a soft guide, Primer nothing.
 */
function FileTree({ f, live }: { f: Fixtures; live?: TreeState }) {
  return (
    <ul className="ui-tree min-h-0 flex-1 overflow-hidden p-1">
      <TreeRow node={f.fileTree} depth={0} last f={f} live={live} />
    </ul>
  );
}

function TreePane({ f, live }: { f: Fixtures; live?: TreeState }) {
  const copy = f.copy.files;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line">
      <div className="flex items-center gap-1 border-b border-line p-2">
        <span className="min-w-0 flex-1">
          <SearchInput placeholder={copy.search} />
        </span>
        <IconButton label={f.copy.common.refresh} icon="refresh" size="sm" />
        <IconButton label={copy.upload} icon="upload" size="sm" />
      </div>
      <FileTree f={f} live={live} />
    </aside>
  );
}

/** The previewed file: its path, its lines numbered, under its actions. */
function PreviewPane({ f, file = f.filePreview }: { f: Fixtures; file?: FilePreview }) {
  const copy = f.copy.files;
  const lines = file.content.split("\n");
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <PreviewHead f={f} path={file.path}>
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
          {copy.lines(lines.length)}
        </span>
      </PreviewHead>
      <pre className="min-h-0 flex-1 overflow-hidden bg-[var(--ui-code-bg)] py-2 font-mono text-xs leading-relaxed text-fg">
        {lines.slice(0, 26).map((line, i) => (
          <span key={i} className="flex">
            <span className="w-10 shrink-0 select-none pr-3 text-right text-[var(--ui-code-gutter)]">
              {i + 1}
            </span>
            <span className="whitespace-pre">{line}</span>
          </span>
        ))}
      </pre>
    </section>
  );
}

/** The preview's head: the file's breadcrumbs, what the caller adds, and the file's actions. */
function PreviewHead({ f, path, children }: { f: Fixtures; path: string; children?: ReactNode }) {
  const copy = f.copy.files;
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <Breadcrumbs items={path.split("/")} />
      {children}
      <span className="min-w-0 flex-1" />
      <IconButton label={copy.copyPath} icon="copy" size="sm" />
      <IconButton label={f.copy.common.download} icon="download" size="sm" />
    </div>
  );
}

function Panel({ f, live, children }: { f: Fixtures; live?: TreeState; children: ReactNode }) {
  return (
    <div className="flex h-[34rem] overflow-hidden rounded-lg border border-line bg-canvas">
      <TreePane f={f} live={live} />
      {children}
    </div>
  );
}

/** A file in the tree by its path. */
function findNode(node: FileNode, path: string): FileNode | undefined {
  if (node.path === path) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, path);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The tree pane as the reader uses it. It opens as the still does — the folders leading to this
 * session's changes open, the edited file picked out, the preview still empty — and from there a
 * folder's row opens or folds it through its disclosure body, and a file's row picks it and
 * shows it in the preview: its source when the Workspace has it to show, else a line saying so
 * under its path.
 */
function Tree({ f }: { f: Fixtures }) {
  const copy = f.copy.files;
  const [open, setOpen] = useState<ReadonlySet<string>>(OPEN);
  const [selected, setSelected] = useState<string>(f.filePreview.path);
  // The still names the edited file but previews nothing: a pick is what fills the pane.
  const [previewing, setPreviewing] = useState(false);
  const live: TreeState = {
    open,
    selected,
    toggle: (path) =>
      setOpen((now) => {
        const next = new Set(now);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    select: (path) => {
      setSelected(path);
      setPreviewing(true);
    },
  };
  const file = f.filePreviews.find((preview) => preview.path === selected);
  const node = findNode(f.fileTree, selected);
  return (
    <Panel f={f} live={live}>
      {!previewing ? (
        <div className="flex min-w-0 flex-1 items-center justify-center p-6">
          <EmptyState variant="slot" title={copy.empty.title} description={copy.empty.body} />
        </div>
      ) : file !== undefined ? (
        <PreviewPane f={f} file={file} />
      ) : (
        <section className="flex min-w-0 flex-1 flex-col">
          <PreviewHead f={f} path={selected}>
            {node?.sizeBytes !== undefined && (
              <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                {bytes(node.sizeBytes)}
              </span>
            )}
          </PreviewHead>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <EmptyState
              variant="slot"
              title={copy.noPreview.title}
              description={copy.noPreview.body}
            />
          </div>
        </section>
      )}
    </Panel>
  );
}

function Preview({ f }: { f: Fixtures }) {
  return (
    <Panel f={f}>
      <PreviewPane f={f} />
    </Panel>
  );
}

/** The drop target over a pane: an info-toned dashed outline and the folder it uploads to. */
function DropOverlay({ folder, f }: { folder: string; f: Fixtures }) {
  const copy = f.copy.files;
  return (
    <div className="absolute inset-0 flex bg-[color-mix(in_oklab,var(--ui-canvas)_82%,transparent)] p-4">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-tone-info-emphasis text-center">
        <GlyphIcon name="upload" size={24} className="text-tone-info-fg" />
        <p className="text-sm font-(--ui-weight-medium) text-fg">{copy.dropTitle(folder)}</p>
        <p className="text-xs text-fg-muted">{copy.dropBody}</p>
      </div>
    </div>
  );
}

function Drop({ f }: { f: Fixtures }) {
  return (
    <Panel f={f}>
      <div className="relative flex min-w-0 flex-1">
        <PreviewPane f={f} />
        <DropOverlay folder="claude-code-expert/src" f={f} />
      </div>
    </Panel>
  );
}

const VARIANTS = { tree: Tree, preview: Preview, drop: Drop } as const;

export const module = defineModule({
  id: "files",
  title: "Files & trees",
  description:
    "The Workspace's Files panel: the tree with search, refresh and upload; a file preview with breadcrumbs; the drop overlay.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "tree", title: "Tree", kind: "interactive" },
    { key: "preview", title: "Preview", kind: "static" },
    { key: "drop", title: "Drop", kind: "static" },
  ],
  parts: [
    "files-file-tree",
    "files-file-browser",
    "files-tree-pane",
    "files-preview-pane",
    "files-drop-overlay",
    "files-workspace-file-menu",
    "content-workspace-file-editor",
    "layout-resize-handle",
    "navigation-breadcrumbs",
    "forms-search-input",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Tree;
    return <View f={fixturesFor(lang)} />;
  },
});
