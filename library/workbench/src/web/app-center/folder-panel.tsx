/**
 * An open folder: its apps, three across as on a phone, unfolded in place from the folder's icon
 * and titled with the folder's name. The surface (`UnfoldSurface`) places it over the grid,
 * moves it, and closes it on the back arrow, Esc, or a press outside, handing focus back to the
 * folder's tile; a press on another folder switches folders instead (that tile's own click).
 * Renaming is in the folder tile's menu.
 *
 * The apps inside drag like the grid's: beside one another to reorder the folder, and out onto
 * anything outside the panel to take one out of the folder (it lands right after the folder in
 * the grid). While an app of this folder is being dragged, the window hears the drag over
 * anything outside the panel in the capture phase, before a home tile could read it as a drop
 * into that tile. A drop on a tile inside the panel never gets that far: the panel stops it.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { UnfoldSurface } from "@prismshadow/penguin-ui";
import { S } from "@prismshadow/penguin-web/internal";
import { folderPanelId, folderTriggerId } from "./app-tile";
import type { GridFolder } from "./arrangement";

export function FolderPanel({
  folder,
  open,
  onClose,
  onExited,
  draggingOut,
  onTakeOut,
  children,
}: {
  folder: GridFolder;
  /** False folds it back into the folder's icon. */
  open: boolean;
  onClose: () => void;
  /** Folded back: the page unmounts it. */
  onExited: () => void;
  /** An app of this folder is being dragged: a drop outside the panel takes it out. */
  draggingOut: boolean;
  onTakeOut: () => void;
  /** The folder's tiles. */
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const takeOut = useRef(onTakeOut);
  useLayoutEffect(() => {
    takeOut.current = onTakeOut;
  });

  useEffect(() => {
    if (!draggingOut) return;
    const outside = (event: DragEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (event.type === "drop") takeOut.current();
    };
    window.addEventListener("dragover", outside, true);
    window.addEventListener("drop", outside, true);
    return () => {
      window.removeEventListener("dragover", outside, true);
      window.removeEventListener("drop", outside, true);
    };
  }, [draggingOut]);

  return (
    <UnfoldSurface
      ref={panel}
      id={folderPanelId(folder.id)}
      open={open}
      triggerId={folderTriggerId(folder.id)}
      title={folder.name}
      backLabel={S.appCenter.menu.back}
      onClose={onClose}
      onExited={onExited}
      keepOpenWithin="[data-folder]"
      // Its own context-menu target, so a right-click on its empty space is not the grid's.
      data-context-menu
      onDragOver={(event) => event.stopPropagation()}
      onDrop={(event) => event.stopPropagation()}
    >
      <ul aria-label={folder.name} className="grid grid-cols-3 gap-1 p-2 sm:gap-2 sm:p-3">
        {children}
      </ul>
    </UnfoldSurface>
  );
}
