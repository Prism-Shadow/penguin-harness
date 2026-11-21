/**
 * The rounded square an app's icon is drawn in, and a folder of apps too: the launcher's one mask,
 * as a phone's home screen gives every icon the same outline whatever the artwork brings.
 *
 * At the home-screen size (`APP_ICON_PX`) the corner is the theme's large radius, capped at 12px so
 * the square keeps straight sides between its corners: Frost and Doodle draw the 12px cap, Primer
 * its own smaller radius, and Console's square edge stays square. Any other size scales that
 * corner by `size / APP_ICON_PX`,
 * so a 20px preview is the same shape as its 56px icon, only smaller. That is what lets a preview
 * grow into its full icon with a transform and arrive on the very same outline.
 *
 * By default the square clips what it holds (an image, a letter tile, four previews). `clip={false}`
 * keeps only the outline, for a box whose marks overhang the corner (an install ring, a warning
 * badge) while an outline or a background still follows the shape.
 */
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";

/** Edge of an app icon at home-screen size, in px: large enough to read a glyph in. */
export const APP_ICON_PX = 56;

/** The corner of an app icon `size` px wide: the home-screen corner, scaled to that size. */
export function appIconRadius(size: number): string {
  return `calc(min(12px, var(--ui-radius-lg)) * ${size / APP_ICON_PX})`;
}

export function AppIconShape({
  size = APP_ICON_PX,
  clip = true,
  className = "",
  style,
  ref,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  /** Edge of the square, in px. */
  size?: number;
  /** Clip the content to the shape (the default), or only give the box its outline. */
  clip?: boolean;
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
}) {
  const box: CSSProperties = { width: size, height: size, borderRadius: appIconRadius(size) };
  return (
    <span
      ref={ref}
      data-app-icon-shape=""
      {...(clip ? { "data-clip-surface": "" } : {})}
      {...rest}
      className={`block shrink-0 ${className}`}
      style={{ ...box, ...style }}
    >
      {children}
    </span>
  );
}
