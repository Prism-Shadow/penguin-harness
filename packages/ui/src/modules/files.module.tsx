/**
 * Files & trees: the Workspace's Files panel.
 *
 * - Tree: the tree pane — search, refresh and upload in its header, folders open to the files this
 *   session changed (marked added or modified), the selected file — beside an empty preview;
 * - Preview: the same tree beside `src/rag.ts` previewed as source, under its breadcrumbs and
 *   actions;
 * - Drop: files dragged over the preview, the drop overlay naming the target folder;
 * - Expand a folder (live): the Workspace folder opening, then `src/` and the file in it selected.
 *
 * Static stand-ins for W7's `TreePane`, `FileTree`, `PreviewPane`, `Breadcrumbs`, `DropOverlay` and
 * `ResizeHandle`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FileNode, Fixtures } from "../fixtures";
import { defineModule } from "../module";
import type { SceneSpec } from "../module";
import { reached, useScene } from "../scene";
import { bytes } from "../screens/format";
import { DisclosureBody } from "../screens/parts";
import { Breadcrumbs, EmptyState, GlyphIcon, IconButton, SearchInput } from "./parts";

/** Folders shown open: the ones leading to this session's changes. */
const OPEN = new Set(["claude-code-expert", "claude-code-expert/src", "claude-code-expert/test"]);

/** What a live tree shows: the folders open, and the file selected, if any. */
interface TreeState {
  open: ReadonlySet<string>;
  selected: string | null;
}

function TreeRow({
  node,
  depth,
  f,
  live,
}: {
  node: FileNode;
  depth: number;
  f: Fixtures;
  /**
   * A live scene's tree: every folder's children sit in a disclosure body that opens and folds by
   * height, and the scene says which folders are open and which file is selected.
   */
  live?: TreeState;
}) {
  const copy = f.copy.files;
  const open = node.kind === "dir" && (live ? live.open : OPEN).has(node.path);
  const selected = node.path === (live ? live.selected : f.filePreview.path);
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
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} f={f} live={live} />
          ))}
        </DisclosureBody>
      ) : (
        open &&
        node.children?.map((child) => (
          <TreeRow key={child.path} node={child} depth={depth + 1} f={f} />
        ))
      )}
    </>
  );
}

function TreePane({ f, live }: { f: Fixtures; live?: TreeState }) {
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
        <TreeRow node={f.fileTree} depth={0} f={f} live={live} />
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
        <Breadcrumbs items={f.filePreview.path.split("/")} />
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
          {copy.lines(lines.length)}
        </span>
        <span className="min-w-0 flex-1" />
        <IconButton label={copy.copyPath} icon="copy" size="sm" />
        <IconButton label={f.copy.common.download} icon="download" size="sm" />
      </div>
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

function Panel({ f, live, children }: { f: Fixtures; live?: TreeState; children: ReactNode }) {
  return (
    <div className="flex h-[34rem] overflow-hidden rounded-lg border border-line bg-canvas">
      <TreePane f={f} live={live} />
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
        <DropOverlay folder="claude-code-expert/src" f={f} />
      </div>
    </Panel>
  );
}

const LIVE_EXPAND: SceneSpec = {
  frames: [
    { key: "closed", title: "Closed", hold: 1000 },
    { key: "open", title: "Open", hold: 1600 },
    { key: "selected", title: "Selected", hold: 1400 },
  ],
};

/**
 * Expand a folder: the Workspace folder, closed; opened, its folders and files arriving through
 * its disclosure body; then the previewed file's folder opens and the file is selected, and its
 * preview arrives beside the tree. The loop back to the first frame folds it all away again.
 */
function LiveExpand({ f }: { f: Fixtures }) {
  const clock = useScene();
  const copy = f.copy.files;
  const file = f.filePreview.path;
  const selected = reached(clock, "selected");
  const open = new Set<string>();
  if (reached(clock, "open")) open.add(f.fileTree.path);
  if (selected) open.add(file.slice(0, file.lastIndexOf("/")));
  return (
    <Panel f={f} live={{ open, selected: selected ? file : null }}>
      {selected ? (
        <div data-reveal className="flex min-w-0 flex-1">
          <PreviewPane f={f} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center p-6">
          <EmptyState variant="slot" title={copy.empty.title} description={copy.empty.body} />
        </div>
      )}
    </Panel>
  );
}

const VARIANTS = {
  tree: Tree,
  preview: Preview,
  drop: Drop,
  "live-expand": LiveExpand,
} as const;

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
    { key: "live-expand", title: "Expand a folder", scene: LIVE_EXPAND },
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
