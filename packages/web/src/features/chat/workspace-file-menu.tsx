/**
 * The Files panel's context-menu body: the rows a secondary click offers, shared by the two
 * surfaces that raise one — a tree row, and the preview of the file a tree row opened. Both
 * act on a single Workspace entry, so both draw the same rows from one place and cannot
 * drift into naming the same action two ways.
 *
 * The two entries that hold for either kind come first — copy the relative path, add a
 * reference to the conversation — and the kind-specific one comes last: a folder takes an
 * upload, a file gives a download. Download is an `<a download>` rather than a button, the
 * same shape the preview header already uses: it is the browser's own save, not a fetch this
 * app has to run.
 *
 * The rows reuse the session row menu's compact styling (see its module header, which already
 * declares itself shared beyond that row), so every overflow menu in the app reads the same.
 */
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import {
  ADD_TO_CHAT_ICON,
  DOWNLOAD_ICON,
  FILE_EDIT_ICON,
  UPLOAD_ICON,
} from "../../components/ui/icons";
import {
  TRASH_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";

/** The one Workspace entry a menu is acting on. */
export interface FileMenuTarget {
  path: string;
  kind: "dir" | "file";
}

export function WorkspaceFileMenuRows({
  target,
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
   * Agent's work cannot be stated for one.
   */
  onRename?: (target: FileMenuTarget) => void;
  /** Deletes the file, behind a confirmation and the same precondition. */
  onDelete?: (target: FileMenuTarget) => void;
  /** Dismisses the panel. The button rows close through their own handlers; the download link, which acts by navigating, has only this. */
  onClose: () => void;
}) {
  return (
    <>
      <button type="button" className={overflowMenuRowClass} onClick={() => onCopyPath(target)}>
        {overflowMenuGlyph(STAT_ICONS.copy)}
        {S.files.copyPath}
      </button>
      <button type="button" className={overflowMenuRowClass} onClick={() => onAddToChat(target)}>
        {overflowMenuGlyph(ADD_TO_CHAT_ICON)}
        {S.files.addToChat}
      </button>
      {onAddSelection !== undefined && (
        <button type="button" className={overflowMenuRowClass} onClick={onAddSelection}>
          {overflowMenuGlyph(ADD_TO_CHAT_ICON)}
          {S.files.addSelectionToChat}
        </button>
      )}
      {target.kind === "dir" ? (
        <button
          type="button"
          className={overflowMenuRowClass}
          onClick={() => onUploadInto(target.path)}
        >
          {overflowMenuGlyph(UPLOAD_ICON)}
          {S.files.uploadHere}
        </button>
      ) : (
        <>
          <a
            href={downloadHref(target.path)}
            download={downloadName(target.path)}
            onClick={onClose}
            className={overflowMenuRowClass}
          >
            {overflowMenuGlyph(DOWNLOAD_ICON)}
            {S.files.download}
          </a>
          {/* The two that change the Workspace come last, after everything that only reads it,
              and the destructive one is last of all — the furthest row from where the pointer
              lands, in the red every other overflow menu gives a delete. */}
          {onRename !== undefined && (
            <button type="button" className={overflowMenuRowClass} onClick={() => onRename(target)}>
              {overflowMenuGlyph(FILE_EDIT_ICON)}
              {S.files.renameTitle}
            </button>
          )}
          {onDelete !== undefined && (
            <button
              type="button"
              className={overflowMenuDangerClass}
              onClick={() => onDelete(target)}
            >
              {overflowMenuGlyph(TRASH_ICON)}
              {S.common.delete}
            </button>
          )}
        </>
      )}
    </>
  );
}
