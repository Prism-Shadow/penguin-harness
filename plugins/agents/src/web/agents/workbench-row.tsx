/**
 * The pieces of a workbench's row (the Plugins tab, agent-workbenches.tsx) that say what they do:
 * the workbench's mark, its switches with their words beside them, and the "More" menu that holds
 * the row's less frequent actions.
 *
 * - The mark is the workbench's own App Center icon when its manifest names one that reads clean
 *   (an image the server serves; a monochrome one drawn in the tile's ink), else its plugin's
 *   icon on the tile, else the anvil tile.
 * - A switch sits in a `<label>` whose word flips it too ("Enable", "App Center"); a longer hint
 *   — what the App Center switch does to the package.json — is the label's tooltip.
 * - "More" is the portaled `Dropdown` with the `Menu` family's rows, as every row menu in the
 *   app: Reload (while the workbench runs), Version history and Export, then Remove in the danger
 *   tone. Opening focuses the first row, the arrow keys move, Enter picks, and Esc closes this
 *   menu only and hands focus back to its button. The menu acts through the rows' owner: Remove
 *   still asks there first.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { IconRef, WorkbenchInfo } from "@prismshadow/penguin-server/api";
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

/**
 * The row's mark: the declared App Center icon, else (and when its image fails to load) the
 * plugin's icon on the tile, else the anvil tile.
 */
export function WorkbenchMark({
  workbench,
  pluginIcon,
}: {
  workbench: WorkbenchInfo;
  /** The icon of the plugin the workbench came from, when it came from one. */
  pluginIcon?: IconRef | undefined;
}) {
  const { icon } = workbench;
  const tile = (shown: IconRef | undefined) => (
    <SkillTile name={workbench.id} fallback={ICONS.anvil} {...(shown ? { icon: shown } : {})} />
  );
  // A monochrome icon is a line drawing: it takes the tile's tint, as a skill's icon does.
  if (icon === undefined) return tile(pluginIcon);
  if (icon.tint) return tile(icon);
  return (
    <ImageIcon icon={icon} size={MARK_PX} className="rounded-lg" fallback={tile(pluginIcon)} />
  );
}

/** A switch with its word beside it, in one `<label>`, so a click on the word flips it too. */
export function LabelledSwitch({
  text,
  hint,
  disabled,
  children,
}: {
  text: string;
  /** What the switch does, beyond its word: the label's tooltip. */
  hint?: string;
  disabled: boolean;
  /** The switch. */
  children: ReactNode;
}) {
  return (
    <label
      {...(hint !== undefined ? { "data-tooltip": hint, "data-tooltip-extra": true } : {})}
      className={`mr-2 flex items-center gap-1.5 text-xs text-fg-muted ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {text}
      {children}
    </label>
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
    <LabelledSwitch
      text={S.workbenches.appCenterLabel}
      hint={S.workbenches.showInAppCenterHint}
      disabled={disabled}
    >
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={`${S.workbenches.showInAppCenter} ${title}`}
      />
    </LabelledSwitch>
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
  /** Absent while the workbench does not run: there is nothing to reload. */
  onReload?: (() => void) | undefined;
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
        {onReload !== undefined && (
          <MenuItem glyph={ICONS.refresh} label={S.workbenches.reload} onSelect={pick(onReload)} />
        )}
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
