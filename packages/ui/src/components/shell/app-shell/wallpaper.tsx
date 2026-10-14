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

/** Filtering a separate layer leaves navigation menus outside the filter's stacking context. */
export function NavigationBackdrop() {
  const wallpaper = useContext(WallpaperContext);
  return wallpaper === undefined ? null : (
    <div aria-hidden="true" className="ui-glass" data-glass="navigation" />
  );
}

/** A page canvas or panel. Shared cards opt in themselves, including outside the chat dock. */
export function WallpaperSurface({
  variant = "canvas",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  variant?: "canvas" | "panel";
}) {
  return <div {...props} data-wallpaper-surface={variant} />;
}
