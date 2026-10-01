/**
 * 文件: the file tree over a demo workspace, the read-only file browser previewing its README,
 * the Files panel's two panes with the draggable split between them, the path strip at a width
 * that folds it, the file menu's rows for a file and a folder, the in-place editor and the two
 * shapes of drop feedback.
 */
import { useState } from "react";
import {
  Breadcrumbs,
  DropOverlay,
  FileBrowser,
  FileTree,
  GlyphIcon,
  ICONS,
  IconButton,
  PreviewPane,
  SplitPane,
  TreePane,
  WorkspaceFileEditor,
  WorkspaceFileMenuRows,
  menuPanelClass,
} from "@prismshadow/penguin-ui";
import type {
  FileBrowserPreview,
  FileTreeRow,
  PreviewView,
  TreeToggle,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";
import { DEMO_OPEN_DIRS, DEMO_TREE, demoSize, flattenTree } from "../demo-tree";

/** The demo's source file: code, the same in every language. */
const DEMO_SOURCE = `import { bm25 } from "./embed";

export function search(query: string, limit = 5) {
  return bm25(query).slice(0, limit);
}
`;

/** The drop feedback's glyph, the paperclip the app passes (its attachment mark). */
const PAPERCLIP_GLYPH =
  "M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48";

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/** The open directories and the last toggle, as the app keeps them for a tree. */
function useDemoTree() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(DEMO_OPEN_DIRS));
  const [toggled, setToggled] = useState<TreeToggle | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (dir: string) => {
    const next = new Set(open);
    const opening = !next.has(dir);
    if (opening) next.add(dir);
    else next.delete(dir);
    setOpen(next);
    setToggled({ dir, open: opening, serial: (toggled?.serial ?? 0) + 1 });
  };
  return { rows: flattenTree(DEMO_TREE, open), toggled, selected, setSelected, toggle };
}

const trailing = (row: FileTreeRow) => {
  const size = demoSize(row.path);
  return size === null ? null : <span className="lib-caption">{formatSize(size)}</span>;
};

export function FilesBoard() {
  const { S } = useGallery();
  const t = S.library.files;
  const tree = useDemoTree();
  const browser = useDemoTree();
  const panel = useDemoTree();
  const [query, setQuery] = useState("");
  const [treeWidth, setTreeWidth] = useState(200);
  const [wrap, setWrap] = useState(false);
  const [draft, setDraft] = useState(DEMO_SOURCE);

  const preview: FileBrowserPreview | null =
    browser.selected === null
      ? null
      : {
          path: browser.selected,
          name: browser.selected.split("/").pop() ?? browser.selected,
          kind: browser.selected.endsWith(".md") ? "md" : "text",
          content: browser.selected === "README.md" ? t.readme : `// ${browser.selected}\n`,
        };

  const panelView: PreviewView =
    panel.selected === null
      ? { kind: "empty", title: t.selectFile }
      : panel.selected.endsWith(".md")
        ? { kind: "markdown", text: panel.selected === "README.md" ? t.readme : "" }
        : {
            kind: "source",
            code: panel.selected === "src/rag.ts" ? DEMO_SOURCE : `// ${panel.selected}\n`,
            language: "typescript",
            wrap,
          };
  const crumbs = [t.root, ...(panel.selected ?? "").split("/").filter((part) => part !== "")];
  const menuLabels = {
    copyPath: t.copyPath,
    addToChat: t.addToChat,
    addSelectionToChat: t.addSelection,
    uploadHere: t.uploadHere,
    download: t.download,
    rename: t.rename,
    delete: t.delete,
    newTextFile: t.newTextFile,
    newFolder: t.newFolder,
  };
  const noop = () => undefined;

  return (
    <div className="gf-board">
      <BoardGroup title={t.tree}>
        <div className="lib-box" data-narrow>
          <FileTree
            rows={tree.rows}
            label={t.treeLabel}
            selectedPath={tree.selected}
            toggled={tree.toggled}
            rowTrailing={trailing}
            emptyLabel={t.emptyDir}
            className="py-1"
            onToggleDir={tree.toggle}
            onOpenFile={tree.setSelected}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.browser}>
        <div className="lib-box">
          <FileBrowser
            rows={browser.rows}
            treeLabel={t.treeLabel}
            selectedPath={browser.selected}
            toggled={browser.toggled}
            rowTrailing={trailing}
            headerFallback={t.header}
            preview={preview}
            emptyPreview={t.emptyPreview}
            emptyDirLabel={t.emptyDir}
            truncatedLabel={t.truncated}
            unsupportedLabel={t.unsupported}
            downloadLabel={t.download}
            treeMaxHeight={40}
            previewHeight={40}
            onToggleDir={browser.toggle}
            onOpenFile={browser.setSelected}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.panel} aside={t.panelHint}>
        {/* The panel as the dock draws it: the path row, then the tree and the preview on a
            split whose handle drags (and steps with the arrow keys once focused). */}
        <div className="lib-box flex flex-col" style={{ height: 360 }}>
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
            <Breadcrumbs className="flex-1" items={crumbs.map((label) => ({ label }))} />
          </div>
          <SplitPane
            className="min-h-0 flex-1"
            size={treeWidth}
            min={160}
            max={320}
            label={t.treeWidth}
            onResize={setTreeWidth}
            first={
              <TreePane search={{ value: query, onChange: setQuery, placeholder: t.search }}>
                <FileTree
                  rows={panel.rows}
                  label={t.treeLabel}
                  selectedPath={panel.selected}
                  toggled={panel.toggled}
                  emptyLabel={t.emptyDir}
                  className="min-h-0 flex-1 overflow-auto"
                  onToggleDir={panel.toggle}
                  onOpenFile={panel.setSelected}
                />
              </TreePane>
            }
            second={
              <PreviewPane
                view={panelView}
                actions={
                  panelView.kind === "source" && (
                    <IconButton label={t.wrap} size="sm" onClick={() => setWrap(!wrap)}>
                      <GlyphIcon d={ICONS.wrapText} />
                    </IconButton>
                  )
                }
              />
            }
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.crumbs} aside={t.crumbsHint}>
        <div className="lib-box" data-narrow>
          <div className="flex px-2 py-1.5">
            <Breadcrumbs
              className="flex-1"
              items={[t.root, "corpus", "claude-code-docs", "reference", "hooks-guide.md"].map(
                (label) => ({ label }),
              )}
            />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.menu}>
        <div className="lib-row items-start">
          <div className="lib-stack">
            <span className="lib-caption">{t.menuFile}</span>
            <div className={`${menuPanelClass} w-56`}>
              <WorkspaceFileMenuRows
                target={{ path: "src/rag.ts", kind: "file" }}
                labels={menuLabels}
                downloadHref={() => "#"}
                downloadName={(path) => path.split("/").pop() ?? path}
                onCopyPath={noop}
                onAddToChat={noop}
                onUploadInto={noop}
                onAddSelection={noop}
                onRename={noop}
                onDelete={noop}
                onClose={noop}
              />
            </div>
          </div>
          <div className="lib-stack">
            <span className="lib-caption">{t.menuFolder}</span>
            <div className={`${menuPanelClass} w-56`}>
              <WorkspaceFileMenuRows
                target={{ path: "src", kind: "dir" }}
                labels={menuLabels}
                downloadHref={() => "#"}
                downloadName={(path) => path}
                onCopyPath={noop}
                onAddToChat={noop}
                onUploadInto={noop}
                onNewFile={noop}
                onNewFolder={noop}
                onRename={noop}
                onClose={noop}
              />
            </div>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.editor}>
        <div className="lib-box" style={{ height: 180 }}>
          <WorkspaceFileEditor
            path="src/rag.ts"
            value={draft}
            label={t.editorLabel("rag.ts")}
            wrap={wrap}
            onChange={setDraft}
            onSave={noop}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.drop}>
        <div className="lib-row items-start">
          <div className="lib-box relative w-72" style={{ height: 200 }}>
            <DropOverlay
              variant="veil"
              glyph={PAPERCLIP_GLYPH}
              title={t.dropAttach}
              description={t.dropAttachHint}
            />
          </div>
          <div className="lib-box relative w-72" style={{ height: 200 }}>
            <DropOverlay variant="frame" glyph={PAPERCLIP_GLYPH} title={t.dropUpload("src")} />
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}
