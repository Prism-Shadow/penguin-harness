import { useState } from "react";
import { Dropdown, GlyphIcon, ICONS, Menu, MenuItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export function GroupOverflowMenu({
  onBrowse,
  onRename,
  onDelete,
}: {
  onBrowse: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Close first, then act (the rename modal opens on top; the delete is immediate). */
  const item = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-max min-w-32"
      className="shrink-0"
      button={
        /* No hover pill on this trigger (user: color, not background, should carry the
           hover hint) — feedback is the glyph deepening in light / brightening in dark,
           the session-row ellipsis treatment. Geometry: the same h-7 w-7 square as the
           sibling "+" and the LAST action in the header, flush at GroupHeader's px-1
           inset — which equals the session rows' pr-1, so with the row trigger's 16px
           glyph the dot columns line up with the rows' trailing slot below. */
        <button
          type="button"
          data-tooltip={S.chat.workspaceMenu}
          aria-label={S.chat.workspaceMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
        >
          {/* Filled: the stroked dots read too faint at this size. */}
          <GlyphIcon d={ICONS.ellipsis} size={16} filled />
        </button>
      }
    >
      <Menu density="sm">
        <MenuItem
          glyph={ICONS.folderOpen}
          label={S.chat.browseWorkspaceFiles}
          onSelect={item(onBrowse)}
        />
        {onRename !== undefined && (
          <MenuItem glyph={ICONS.pencil} label={S.chat.renameWorkspace} onSelect={item(onRename)} />
        )}
        {onDelete !== undefined && (
          <MenuItem
            glyph={ICONS.trash}
            label={S.chat.deleteWorkspace}
            danger
            onSelect={item(onDelete)}
          />
        )}
      </Menu>
    </Dropdown>
  );
}
