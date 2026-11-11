/**
 * An open folder: its apps in a dialog over the grid, as a phone shows a folder — the shared
 * `Modal`, titled with the folder's name, so the backdrop dims the grid, Esc, the close button or
 * a press on the backdrop closes it, and focus stays inside while it is open and goes back to the
 * folder's tile after. Renaming is in the folder tile's menu.
 *
 * The apps inside drag like the grid's: beside one another to reorder the folder, and out onto
 * the backdrop to take one out of the folder (it lands right after the folder in the grid). The
 * backdrop is the dialog's own element, so while an app of this folder is being dragged the
 * window listens for the drag over anything outside the panel. A drop on a tile inside the panel
 * never gets that far: the tile takes it and stops it.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Modal } from "@prismshadow/penguin-ui";
import type { GridFolder } from "./arrangement";

/** The folder's own grid: three across, as on a phone, wider screens included. */
export const FOLDER_GRID = "grid grid-cols-3 gap-4";

export function FolderPanel({
  folder,
  onClose,
  draggingOut,
  onTakeOut,
  children,
}: {
  folder: GridFolder;
  onClose: () => void;
  /** An app of this folder is being dragged: a drop outside the panel takes it out. */
  draggingOut: boolean;
  onTakeOut: () => void;
  /** The folder's tiles. */
  children: ReactNode;
}) {
  const body = useRef<HTMLUListElement>(null);
  const takeOut = useRef(onTakeOut);
  takeOut.current = onTakeOut;

  useEffect(() => {
    if (!draggingOut) return;
    const outside = (e: DragEvent): boolean => {
      const panel = body.current?.closest('[role="dialog"]');
      return panel !== null && panel !== undefined && !panel.contains(e.target as Node | null);
    };
    const over = (e: DragEvent) => {
      if (!outside(e)) return;
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "move";
    };
    const drop = (e: DragEvent) => {
      if (!outside(e)) return;
      e.preventDefault();
      takeOut.current();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [draggingOut]);

  return (
    <Modal open title={folder.name} onClose={onClose}>
      <ul ref={body} className={FOLDER_GRID} aria-label={folder.name}>
        {children}
      </ul>
    </Modal>
  );
}
