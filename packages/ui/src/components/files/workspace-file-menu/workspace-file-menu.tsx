/**
 * The Files panel's context-menu body: the rows a secondary click offers, shared by the two
 * surfaces that raise one — a tree row, and the preview of the file a tree row opened. Both
 * act on a single Workspace entry, so both draw the same rows from one place and cannot
 * drift into naming the same action two ways.
 *
 * The two entries that hold for either kind come first — copy the relative path, add a
 * reference to the conversation — and the kind-specific one comes last: a folder takes an
 * upload, a file gives a download. Download is an `<a download>` rather than a button, the
 * same shape the preview header already uses: it is the browser's own save, not a fetch the
 * app has to run.
 *
 * The rows are the Menu rows at the small density, the one every overflow and context menu in
 * the app uses, so they read the same as the Session row's menu.
 */
import { ICONS } from "../../icons/icons";
import { Menu, MenuItem } from "../../overlays/menu/menu";

/** The one Workspace entry a menu is acting on. */
export interface FileMenuTarget {
  path: string;
  kind: "dir" | "file";
}

/** The rows' words, from the caller's dictionary. */
export interface WorkspaceFileMenuLabels {
  copyPath: string;
  addToChat: string;
  addSelectionToChat: string;
  uploadHere: string;
  download: string;
  rename: string;
  delete: string;
}

export function WorkspaceFileMenuRows({
  target,
  labels,
  downloadHref,
  downloadName,
  onCopyPath,
  onAddToChat,
  onUploadInto,
  onAddSelection,
  onRename,
  onDelete,
  onClose,
}: {
  target: FileMenuTarget;
  labels: WorkspaceFileMenuLabels;
  /** The file's download URL; never asked for a directory. */
  downloadHref: (path: string) => string;
  downloadName: (path: string) => string;
  onCopyPath: (target: FileMenuTarget) => void;
  onAddToChat: (target: FileMenuTarget) => void;
  onUploadInto: (dir: string) => void;
  /**
   * Adds the text selected in the preview rather than the whole file. Offered only by the
   * preview, and only while a selection actually sits inside it — a tree row has nothing
   * selected to add.
   */
  onAddSelection?: () => void;
  /**
   * Renames or moves the file — one action, because both are the same write of a new path, and
   * offering them separately would mean asking which one the user meant. Files only: a
   * directory has no version marker, so the precondition that keeps this from overwriting the
   * agent's work cannot be stated for one.
   */
  onRename?: (target: FileMenuTarget) => void;
  /** Deletes the file, behind a confirmation and the same precondition. */
  onDelete?: (target: FileMenuTarget) => void;
  /** Dismisses the panel. The button rows close through their own handlers; the download link, which acts by navigating, has only this. */
  onClose: () => void;
}) {
  return (
    <Menu density="sm">
      <MenuItem glyph={ICONS.copy} label={labels.copyPath} onSelect={() => onCopyPath(target)} />
      <MenuItem
        glyph={ICONS.messagePlus}
        label={labels.addToChat}
        onSelect={() => onAddToChat(target)}
      />
      {onAddSelection !== undefined && (
        <MenuItem
          glyph={ICONS.messagePlus}
          label={labels.addSelectionToChat}
          onSelect={onAddSelection}
        />
      )}
      {target.kind === "dir" ? (
        <MenuItem
          glyph={ICONS.upload}
          label={labels.uploadHere}
          onSelect={() => onUploadInto(target.path)}
        />
      ) : (
        <>
          <MenuItem
            glyph={ICONS.download}
            label={labels.download}
            href={downloadHref(target.path)}
            download={downloadName(target.path)}
            onSelect={onClose}
          />
          {/* The two that change the Workspace come last, after everything that only reads it,
              and the destructive one is last of all — the furthest row from where the pointer
              lands, in the red every other overflow menu gives a delete. */}
          {onRename !== undefined && (
            <MenuItem
              glyph={ICONS.penLine}
              label={labels.rename}
              onSelect={() => onRename(target)}
            />
          )}
          {onDelete !== undefined && (
            <MenuItem
              glyph={ICONS.trash}
              label={labels.delete}
              danger
              onSelect={() => onDelete(target)}
            />
          )}
        </>
      )}
    </Menu>
  );
}
