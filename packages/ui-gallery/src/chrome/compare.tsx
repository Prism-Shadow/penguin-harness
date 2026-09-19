/**
 * Compare: one `/embed` frame per theme — real roots, so `:root[data-theme]`, fonts and scrollbars
 * behave as in the app — each reporting its content height so a frame never scrolls. A `narrow`
 * module's frames sit side by side; a `wide` module's stack at full width, because three
 * transcripts or tables at a third of the column are unreadable.
 *
 * A live variant's frames all follow the card's clock (`sync=1`): each frame says when it is
 * listening, and gets the card's timeline then and on every change after.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { useEffect, useRef, useState } from "react";
import type { Module, ModuleVariant } from "../../../ui/src/module";
import type { SceneClock } from "../../../ui/src/scene";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { clockMessage, CLOCK_READY } from "../lib/live";
import { BASE } from "../lib/location";
import { THEME_NAMES } from "../lib/themes";
import { formatGalleryQuery } from "../lib/url-state";
import { useGallery } from "../state";
import { Breadcrumb } from "./pills";

export function CompareFrames({
  module,
  variant,
  clock = null,
  frames,
}: {
  module: Module;
  variant: ModuleVariant;
  /** A live variant's clock, owned by the card; the frames follow it. */
  clock?: SceneClock | null;
  /** Filled with each theme's frame, for the tokens drawer to measure the active theme's copy. */
  frames?: Map<ThemeId, HTMLIFrameElement>;
}) {
  return (
    <div className="g-compare" data-width={module.width}>
      {THEME_IDS.map((theme) => (
        <CompareFrame
          key={theme}
          module={module}
          variant={variant}
          clock={clock}
          theme={theme}
          frames={frames}
        />
      ))}
    </div>
  );
}

function CompareFrame({
  module,
  variant,
  clock,
  theme,
  frames,
}: {
  module: Module;
  variant: ModuleVariant;
  clock: SceneClock | null;
  theme: ThemeId;
  frames?: Map<ThemeId, HTMLIFrameElement>;
}) {
  const { S, state, mode } = useGallery();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(432);
  /** What the frame should hold now, re-sent when the frame says it is listening. */
  const message = useRef<ReturnType<typeof clockMessage> | null>(null);
  message.current = clock ? clockMessage(module.id, variant.key, clock) : null;
  const post = () => {
    if (message.current)
      frame.current?.contentWindow?.postMessage(message.current, window.location.origin);
  };
  useEffect(() => {
    const el = frame.current;
    if (el && frames) frames.set(theme, el);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number };
      if (data?.type === "gallery:height" && typeof data.height === "number")
        setHeight(Math.ceil(data.height));
      else if (data?.type === CLOCK_READY) post();
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (frames?.get(theme) === el) frames?.delete(theme);
    };
    // `post` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, theme]);
  // Every change of the card's clock reaches the frame at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(post, [clock]);
  const crumb = formatBreadcrumb({
    theme,
    module: module.title,
    variant: [variant.title],
    frame: clock && !clock.playing ? clock.frames[clock.index]?.title : undefined,
    mode,
    lang: state.lang,
    tier: state.tier,
  });
  // Nothing about the clock goes into the src: a new frame must not reload the document.
  const src = `${BASE}/embed${formatGalleryQuery(
    { ...state, theme, compare: false, variants: {} },
    { module: module.id, variant: variant.key, ...(variant.scene ? { sync: "1" } : {}) },
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
