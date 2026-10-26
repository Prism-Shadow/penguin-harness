/** Optional wallpaper layers. Layout and controls keep their theme; only opted-in fills give way. */
import { createContext, useContext } from "react";
import type { CSSProperties, HTMLAttributes, Ref } from "react";

export type WallpaperStyle = Pick<
  CSSProperties,
  "backgroundImage" | "backgroundSize" | "backgroundPosition" | "backgroundRepeat" | "opacity"
>;

export const WallpaperContext = createContext<WallpaperStyle | undefined>(undefined);

/** Shared by the window and a maximized dock, which must cover the conversation beneath it. */
export function WallpaperLayer() {
  const wallpaper = useContext(WallpaperContext);
  return wallpaper === undefined ? null : (
    <div aria-hidden="true" data-wallpaper-layer style={wallpaper} />
  );
}

/**
 * What a pinned row of the transcript paints under its words while it is stuck: the page colour
 * and, over it, the image again, laid against the window exactly as the shell's own layer is. The
 * row then looks as clear as every activity row on the image, yet hides the text scrolling under
 * it. `wallpaper.css` shows it only while the row is stuck; with no wallpaper it renders nothing.
 */
export function WallpaperBackdrop() {
  const wallpaper = useContext(WallpaperContext);
  return wallpaper === undefined ? null : (
    <span aria-hidden="true" data-wallpaper-backdrop>
      <span data-wallpaper-layer style={wallpaper} />
    </span>
  );
}

/** Filtering a separate layer leaves navigation menus outside the filter's stacking context. */
export function NavigationBackdrop() {
  const wallpaper = useContext(WallpaperContext);
  return wallpaper === undefined ? null : (
    <div aria-hidden="true" className="ui-glass" data-glass="navigation" />
  );
}

/**
 * A surface's role on a custom background (`data-wallpaper-surface`, read by wallpaper.css), one
 * of three kinds: `canvas` turns clear; `panel` keeps a light fill; `tone`, a strip tinted with a
 * tone it names in `data-tone` as a notice does, keeps that tint at half strength. Shared cards
 * and strips declare the attribute themselves, including outside the chat dock.
 */
export function WallpaperSurface({
  variant = "canvas",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  variant?: "canvas" | "panel" | "tone";
}) {
  return <div {...props} data-wallpaper-surface={variant} />;
}
