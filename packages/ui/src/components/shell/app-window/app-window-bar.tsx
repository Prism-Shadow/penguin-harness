/**
 * The title bar of a window that holds one app (an `AppWindow` of a `WindowStack`): the app's icon
 * and name, any controls of the app's own (a switch between its pages), then the window's
 * controls at the bar's end — minimize, full screen and close, in the order a desktop window keeps
 * them. Each of those is a flat icon button whose name is also its hint. A window that cannot do
 * one of the first two leaves it out by passing no handler, and the others keep their places.
 *
 * What minimize and close leave behind is the caller's to keep: a minimized window stays mounted
 * and only stops being shown, so the app inside keeps running; a closed one is unmounted. The bar
 * names nothing of the app: the caller passes the words.
 */
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { IconButton } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export interface AppWindowBarProps {
  /** The app's icon at the bar's start, one rung above a line glyph, as an avatar sits. */
  icon?: ReactNode;
  /** The app's name, the bar's heading. */
  title: string;
  /** Controls of the app's own, after the name and before the window's. */
  controls?: ReactNode;
  /** The controls' names, in the interface language. */
  labels: { minimize: string; fullScreen: string; close: string };
  /** Hide the window and keep what it holds running; no button without it. */
  onMinimize?: () => void;
  /** Show the app full screen; no button without it. */
  onFullScreen?: () => void;
  onClose: () => void;
}

export function AppWindowBar({
  icon,
  title,
  controls,
  labels,
  onMinimize,
  onFullScreen,
  onClose,
}: AppWindowBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      {icon}
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{title}</h1>
      {controls}
      {onMinimize !== undefined && (
        <IconButton variant="ghost" size="sm" label={labels.minimize} onClick={onMinimize}>
          <GlyphIcon d={ICONS.minus} size={ICON_SIZE.iconButton} />
        </IconButton>
      )}
      {onFullScreen !== undefined && (
        <IconButton variant="ghost" size="sm" label={labels.fullScreen} onClick={onFullScreen}>
          <GlyphIcon d={ICONS.cornersOut} size={ICON_SIZE.iconButton} />
        </IconButton>
      )}
      <IconButton variant="ghost" size="sm" label={labels.close} onClick={onClose}>
        <GlyphIcon d={ICONS.cross} size={ICON_SIZE.iconButton} />
      </IconButton>
    </div>
  );
}
