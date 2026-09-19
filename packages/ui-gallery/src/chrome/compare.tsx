/**
 * Compare: one `/embed` frame per theme — real roots, so `:root[data-theme]`, fonts and scrollbars
 * behave as in the app — each reporting its content height so a frame never scrolls. A `narrow`
 * module's frames sit side by side; a `wide` module's stack at full width, because three
 * transcripts or tables at a third of the column are unreadable.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { useEffect, useRef, useState } from "react";
import type { Module, ModuleVariant } from "../../../ui/src/module";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { BASE } from "../lib/location";
import { THEME_NAMES } from "../lib/themes";
import { formatGalleryQuery } from "../lib/url-state";
import { useGallery } from "../state";
import { Breadcrumb } from "./pills";

export function CompareFrames({
  module,
  variant,
  frames,
}: {
  module: Module;
  variant: ModuleVariant;
  /** Filled with each theme's frame, for the tokens drawer to measure the active theme's copy. */
  frames?: Map<ThemeId, HTMLIFrameElement>;
}) {
  return (
    <div className="g-compare" data-width={module.width}>
      {THEME_IDS.map((theme) => (
        <CompareFrame key={theme} module={module} variant={variant} theme={theme} frames={frames} />
      ))}
    </div>
  );
}

function CompareFrame({
  module,
  variant,
  theme,
  frames,
}: {
  module: Module;
  variant: ModuleVariant;
  theme: ThemeId;
  frames?: Map<ThemeId, HTMLIFrameElement>;
}) {
  const { S, state, mode } = useGallery();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(432);
  useEffect(() => {
    const el = frame.current;
    if (el && frames) frames.set(theme, el);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number };
      if (data?.type === "gallery:height" && typeof data.height === "number")
        setHeight(Math.ceil(data.height));
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (frames?.get(theme) === el) frames?.delete(theme);
    };
  }, [frames, theme]);
  const crumb = formatBreadcrumb({
    theme,
    module: module.title,
    variant: [variant.title],
    mode,
    lang: state.lang,
    tier: state.tier,
  });
  const src = `${BASE}/embed${formatGalleryQuery(
    { ...state, theme, compare: false, variants: {} },
    { module: module.id, variant: variant.key, frame: "1" },
  )}`;
  return (
    <figure className="g-compare-item">
      <figcaption className="g-chrome">
        <span className="g-compare-theme">{THEME_NAMES[theme]}</span>
        <Breadcrumb text={crumb} className="g-crumb-compact" />
      </figcaption>
      <iframe
        ref={frame}
        title={S.section.compareFrame(THEME_NAMES[theme])}
        src={src}
        loading="lazy"
        style={{ height }}
      />
    </figure>
  );
}
