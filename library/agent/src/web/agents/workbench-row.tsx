/**
 * The pieces of a workbench's row (the Plugins tab's Workbenches sub-page, agent-workbenches.tsx)
 * that say what they do: the workbench's mark, its switches with their words beside them, and the
 * "More" menu in its file details.
 *
 * - The mark is the workbench's own App Center icon when its manifest names one that reads clean
 *   (an image the server serves; a monochrome one drawn in the tile's ink), else its plugin's
 *   icon on the tile, else the anvil tile.
 * - The Enable label toggles its switch. "More" offers reload, version history, export and removal.
 */
import type { ReactNode } from "react";
import type { IconRef, WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { ICONS, ImageIcon } from "@prismshadow/penguin-ui";
import { SkillTile } from "@prismshadow/penguin-web/internal";

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
  disabled,
  children,
}: {
  text: string;
  disabled: boolean;
  /** The switch. */
  children: ReactNode;
}) {
  return (
    <label
      className={`mr-2 flex items-center gap-1.5 text-xs text-fg-muted ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {text}
      {children}
    </label>
  );
}
