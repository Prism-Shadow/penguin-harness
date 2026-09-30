/** 文件: the app's FileTree over a demo workspace, and the read-only FileBrowser previewing its README. */
import { useState } from "react";
import { FileBrowser } from "../../../../web/src/components/ui/file-browser";
import type { FileBrowserPreview } from "../../../../web/src/components/ui/file-browser";
import { FileTree } from "../../../../web/src/components/ui/file-tree";
import type { TreeToggle } from "../../../../web/src/components/ui/file-tree";
import type { FileTreeRow } from "../../../../web/src/lib/file-tree";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";
import { DEMO_OPEN_DIRS, DEMO_TREE, demoSize, flattenTree } from "../demo-tree";

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
  const preview: FileBrowserPreview | null =
    browser.selected === null
      ? null
      : {
          path: browser.selected,
          name: browser.selected.split("/").pop() ?? browser.selected,
          kind: browser.selected.endsWith(".md") ? "md" : "text",
          content: browser.selected === "README.md" ? t.readme : `// ${browser.selected}\n`,
        };
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
            treeMaxHeight={40}
            previewHeight={40}
            onToggleDir={browser.toggle}
            onOpenFile={browser.setSelected}
          />
        </div>
      </BoardGroup>
    </div>
  );
}
