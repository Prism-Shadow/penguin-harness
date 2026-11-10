/**
 * The pieces of a Workbenches-tab row that say what they do: the workbench's mark, the App Center
 * switch with its words beside it, and the "More" menu that holds the row's less frequent actions.
 *
 * - The mark is the workbench's own App Center icon when its manifest names one that reads clean
 *   (an image the server serves; a monochrome one drawn in the tile's ink), else the anvil tile.
 * - The switch sits in a `<label>` whose words ("App Center") flip it too; the longer hint — what
 *   the switch does to the package.json — is the label's tooltip.
 * - "More" is the portaled `Dropdown` with the `Menu` family's rows, as every row menu in the
 *   app: Reload, Version history and Export, then Remove in the danger tone. Opening focuses the
 *   first row, the arrow keys move, Enter picks, and Esc closes this menu only and hands focus
 *   back to its button. The menu acts through the tab: Remove still asks there first.
 */
import { useState } from "react";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import {
  Dropdown,
  GlyphIcon,
  IconButton,
  ICONS,
  ICON_SIZE,
  ImageIcon,
  Menu,
  MenuItem,
  MenuSeparator,
  Switch,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { SkillTile } from "../skills";

/** Edge of the row's mark, in px: the tile every settings row leads with. */
const MARK_PX = 36;

/** The row's mark: the declared icon, else (and when its image fails to load) the anvil tile. */
export function WorkbenchMark({ workbench }: { workbench: WorkbenchInfo }) {
  const { icon } = workbench;
  // A monochrome icon is a line drawing: it takes the tile's tint, as a skill's icon does.
  if (icon === undefined || icon.tint) {
    return <SkillTile name={workbench.id} fallback={ICONS.anvil} {...(icon ? { icon } : {})} />;
  }
  return (
    <ImageIcon
      icon={icon}
      size={MARK_PX}
      className="rounded-lg"
      fallback={<SkillTile name={workbench.id} fallback={ICONS.anvil} />}
    />
  );
}

/** The App Center switch, its words beside it; a click on either flips it. */
export function AppCenterToggle({
  title,
  checked,
  disabled,
  onChange,
}: {
  /** The row's title, for the switch's accessible name. */
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (show: boolean) => void;
}) {
  return (
    <label
      data-tooltip={S.workbenches.showInAppCenterHint}
      data-tooltip-extra
      className={`mr-2 flex items-center gap-1.5 text-xs text-fg-muted ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {S.workbenches.appCenterLabel}
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={`${S.workbenches.showInAppCenter} ${title}`}
      />
    </label>
  );
}

export function WorkbenchRowMenu({
  title,
  disabled,
  onReload,
  onHistory,
  onExport,
  onRemove,
}: {
  /** The row's title, for the button's and the menu's accessible name. */
  title: string;
  disabled: boolean;
  onReload: () => void;
  onHistory: () => void;
  onExport: () => void;
  /** Asks first: the tab's remove confirmation. */
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `${S.workbenches.more} ${title}`;
  /** A row closes the menu, handing focus back to its button, then acts. */
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-48"
      portal={{ direction: "down", align: "right" }}
      button={
        <IconButton
          size="sm"
          label={label}
          // No tooltip while the menu is open: it would sit on top of the panel.
          title={open ? "" : S.workbenches.more}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.iconButton} filled />
        </IconButton>
      }
    >
      <Menu label={label} density="sm" className="py-1">
        <MenuItem glyph={ICONS.refresh} label={S.workbenches.reload} onSelect={pick(onReload)} />
        <MenuItem
          glyph={ICONS.history}
          label={S.workbenches.historyAction}
          onSelect={pick(onHistory)}
        />
        <MenuItem
          glyph={ICONS.download}
          label={S.workbenches.exportWorkbench}
          onSelect={pick(onExport)}
        />
        <MenuSeparator />
        <MenuItem
          glyph={ICONS.trash}
          label={S.workbenches.remove}
          danger
          onSelect={pick(onRemove)}
        />
      </Menu>
    </Dropdown>
  );
}
