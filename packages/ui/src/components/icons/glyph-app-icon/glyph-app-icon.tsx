/** A system application's mark. The shared shape and the active theme's glyph also fit folder
 * previews and window titles. Built-in applications have their own colour fields. */
import { AppIconShape, APP_ICON_PX } from "../app-icon-shape/app-icon-shape";
import { sessionToolArt } from "./session-tool-art";
import { GlyphIcon } from "../glyph-icon/glyph-icon";

const colors = new Map<string, readonly [string, string]>([
  ["models", ["violet", "blue"]],
  ["plugins", ["pink", "red"]],
  ["machines", ["teal", "blue"]],
  ["usage", ["green", "teal"]],
  ["benchmark", ["amber", "orange"]],
]);

export function GlyphAppIcon({
  appKey,
  d,
  size = APP_ICON_PX,
  className = "",
}: {
  appKey?: string;
  /** The registry glyph; each icon theme supplies its own drawing. */
  d: string;
  size?: number;
  className?: string;
}) {
  const artwork = appKey && sessionToolArt.get(appKey);
  const palette = appKey ? colors.get(appKey) : undefined;
  const style = palette && {
    background: `linear-gradient(155deg, color-mix(in oklab, var(--ui-icon-tint-${palette[0]}) 85%, var(--ui-accent)), color-mix(in oklab, var(--ui-icon-tint-${palette[1]}) 64%, var(--ui-accent)))`,
    boxShadow: "inset 0 1px 0 rgb(255 255 255 / 22%), inset 0 -1px 0 rgb(0 0 0 / 12%)",
  };
  return (
    <AppIconShape
      aria-hidden
      data-system-app-icon={artwork || palette ? appKey : undefined}
      size={size}
      style={style}
      className={`flex items-center justify-center ${palette ? "text-accent-fg" : "bg-fill-neutral text-fg"} ${className}`}
    >
      {artwork || (
        <GlyphIcon d={d} size={Math.max(10, Math.round(size * (palette ? 0.69 : 0.5)))} />
      )}
    </AppIconShape>
  );
}
