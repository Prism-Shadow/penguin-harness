/**
 * An icon that is an image — a plugin's, a Skill's, a hook package's, a Workbench's — drawn from
 * the URL it is served at, never from markup. A monochrome SVG (`tint`) is a CSS mask filled with
 * the text colour, so a line icon follows the ink around it the way a glyph does; any other icon
 * is an `<img>`, fitted inside the square without cropping. Drawn either way, the image runs no
 * script and loads nothing else.
 *
 * Without an icon, or once its URL fails to load, the caller's `fallback` stands in its place:
 * the uniform glyph of the subject's kind. The essentials are inline styles rather than classes,
 * so the mark draws the same on a host whose stylesheet does not scan this package.
 */
import { useState, type CSSProperties, type ReactNode } from "react";

/** Where an icon's image is, and whether it takes the text colour (a monochrome SVG). */
export interface ImageIconSource {
  url: string;
  tint: boolean;
}

/** A URL as a CSS `url()`: a quote, a backslash or a line break in it is escaped. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
}

export function ImageIcon({
  icon,
  size,
  fallback,
  className = "",
}: {
  icon?: ImageIconSource | null;
  /** Edge of the square, in px. */
  size: number;
  /** Drawn without an icon, or when its image does not load: the kind's glyph. */
  fallback: ReactNode;
  className?: string;
}) {
  // Keyed by URL: a new icon (a new revision) is tried afresh.
  const [failed, setFailed] = useState<string | null>(null);
  if (icon == null || failed === icon.url) return <>{fallback}</>;
  const fail = () => setFailed(icon.url);
  const box: CSSProperties = { width: size, height: size, display: "block", flexShrink: 0 };
  if (!icon.tint) {
    return (
      <img
        src={icon.url}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={fail}
        style={{ ...box, objectFit: "contain" }}
        className={className}
      />
    );
  }
  const mask = cssUrl(icon.url);
  return (
    <span
      aria-hidden
      className={className}
      style={{
        ...box,
        backgroundColor: "currentColor",
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    >
      {/* A mask that fails to load says nothing; this request for the same image is what does. */}
      <img src={icon.url} alt="" hidden onError={fail} />
    </span>
  );
}
