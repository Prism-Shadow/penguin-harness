/**
 * Files & trees: the Workspace's Files panel.
 *
 * - Tree: the tree pane — search, refresh and upload in its header, folders open to the files this
 *   session changed (marked added or modified), the selected file — beside an empty preview;
 * - Preview: the same tree beside `src/rag.ts` previewed as source, under its breadcrumbs and
 *   actions;
 * - Drop: files dragged over the preview, the drop overlay naming the target folder.
 *
 * Static stand-ins for W7's `TreePane`, `FileTree`, `PreviewPane`, `Breadcrumbs`, `DropOverlay` and
 * `ResizeHandle`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FileNode, Fixtures } from "../fixtures";
import { defineModule, viewFor } from "../module";
import { bytes } from "../screens/format";
import { Breadcrumbs, CodeLines, EmptyState, GlyphIcon, IconButton, SearchInput } from "./parts";

/** The folders on the way to a path, `a/b/c.ts` → `a`, `a/b`. */
const ancestors = (path: string): string[] =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** The folder a file sits in, as the drop overlay names it. */
const folderOf = (path: string): string => ancestors(path).at(-1) ?? path;

/**
 * The folders shown open: the root, and the ones leading to what this session touched — the file
 * being previewed and every file a tool call changed. Read off the fixture's own paths, so
 * renaming the project cannot leave the tree collapsed.
 */
function openFolders(f: Fixtures): Set<string> {
  const changed = f.session.turns.flatMap((turn) =>
    turn.items.flatMap((item) =>
      item.kind === "tool_call" && item.diff ? ancestors(item.diff.path) : [],
    ),
  );
  return new Set([f.fileTree.path, ...ancestors(f.filePreview.path), ...changed]);
}

function TreeRow({
  node,
  depth,
  open: shown,
  f,
}: {
  node: FileNode;
  depth: number;
  open: ReadonlySet<string>;
  f: Fixtures;
}) {
  const copy = f.copy.files;
  const open = node.kind === "dir" && shown.has(node.path);
  const selected = node.path === f.filePreview.path;
  return (
    <>
      <li
        className={`flex h-7 items-center gap-1.5 rounded-sm pr-2 text-sm ${selected ? "bg-accent-muted text-fg" : "text-fg"}`}
        style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
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
            {node.change === "added" ? copy.addedMark : copy.modifiedMark}
          </span>
        )}
        {node.kind === "file" && node.sizeBytes !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
            {bytes(node.sizeBytes)}
          </span>
        )}
      </li>
      {open &&
        node.children?.map((child) => (
          <TreeRow key={child.path} node={child} depth={depth + 1} open={shown} f={f} />
        ))}
    </>
  );
}

function TreePane({ f }: { f: Fixtures }) {
  const copy = f.copy.files;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-line p-2">
        <div className="flex items-center gap-1 pl-1">
          <span className="min-w-0 flex-1 text-sm font-(--ui-weight-medium) text-fg">
            {f.copy.nav.files}
          </span>
          <IconButton label={f.copy.common.refresh} icon="refresh" size="sm" />
          <IconButton label={copy.upload} icon="upload" size="sm" />
        </div>
        <SearchInput placeholder={copy.search} />
      </div>
      <ul className="min-h-0 flex-1 overflow-hidden p-1">
        <TreeRow node={f.fileTree} depth={0} open={openFolders(f)} f={f} />
      </ul>
    </aside>
  );
}

function PreviewPane({ f }: { f: Fixtures }) {
  const copy = f.copy.files;
  const lines = f.filePreview.content.split("\n");
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Breadcrumbs items={f.filePreview.path.split("/")} label={f.copy.files.breadcrumbs} />
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
          {copy.lines(lines.length)}
        </span>
        <span className="min-w-0 flex-1" />
        <IconButton label={copy.copyPath} icon="copy" size="sm" />
        <IconButton label={f.copy.common.download} icon="download" size="sm" />
      </div>
      <CodeLines code={lines.slice(0, 26).join("\n")} className="min-h-0 flex-1 overflow-hidden" />
    </section>
  );
}

function Panel({ f, children }: { f: Fixtures; children: ReactNode }) {
  return (
    <div className="flex h-[34rem] overflow-hidden rounded-lg border border-line bg-canvas">
      <TreePane f={f} />
      {children}
    </div>
  );
}

function Tree({ f }: { f: Fixtures }) {
  const copy = f.copy.files;
  return (
    <Panel f={f}>
      <div className="flex min-w-0 flex-1 items-center justify-center p-6">
        <EmptyState variant="slot" title={copy.empty.title} description={copy.empty.body} />
      </div>
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
        <DropOverlay folder={folderOf(f.filePreview.path)} f={f} />
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
  variants: [
    { key: "tree", title: "Tree" },
    { key: "preview", title: "Preview" },
    { key: "drop", title: "Drop" },
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
    const View = viewFor(VARIANTS, variant);
    return <View f={fixturesFor(lang)} />;
  },
});
