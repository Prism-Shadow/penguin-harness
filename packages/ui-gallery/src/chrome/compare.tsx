/**
 * Framed previews: one `/embed` frame per theme — real roots, so `:root[data-theme]`, the root
 * font size, fonts and scrollbars behave as in the app — each reporting its content height so a
 * frame never scrolls. Two views use them:
 *
 * - compare: all three themes. A `narrow` module's frames sit side by side; a `wide` module's
 *   stack at full width, because three transcripts or tables at a third of the column are
 *   unreadable.
 * - phone: a 390 px frame per theme (one, or three when comparing), a plain frame with no device
 *   drawing, so a composition lays out at phone width — a real viewport, which is the only thing
 *   the responsive classes answer to — and the themes can be compared there too.
 *
 * Outside the phone view, a module designed at the app's width (`viewport`) gets a frame that wide,
 * scaled down to the figure, so each theme's copy lays out as the section's does.
 *
 * An animated variant's frames all follow the section's clock (`sync=1`): each frame says when it
 * is listening, and gets the section's timeline then and on every change after; a composition's
 * own move inside a frame comes back as a command the section's clock runs. An interactive or
 * static variant's frames own themselves.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import { useEffect, useRef, useState } from "react";
import type { Module, ModuleVariant } from "../../../ui/src/module";
import { isSettled } from "../../../ui/src/scene";
import type { SceneClock, SceneCommand } from "../../../ui/src/scene";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { embedWidth, naturalWidth } from "../lib/fit";
import { clockMessage, CLOCK_READY, readControlMessage } from "../lib/live";
import { BASE } from "../lib/location";
import { formatGalleryQuery, PHONE_WIDTH } from "../lib/url-state";
import { useText } from "../preview";
import { useGallery } from "../state";
import { Breadcrumb } from "./crumb";
import { Fit } from "./fit";

export function ThemeFrames({
  module,
  variant,
  clock = null,
  control,
  themes,
  phone,
}: {
  module: Module;
  variant: ModuleVariant;
  /** An animated variant's clock, owned by the section; the frames follow it. Null: none. */
  clock?: SceneClock | null;
  /** Runs a command a framed composition sends up for that clock. */
  control?: (command: SceneCommand) => void;
  /** The active theme alone, or all three when comparing. */
  themes: readonly ThemeId[];
  /** Frame each theme at phone width. */
  phone: boolean;
}) {
  return (
    <div
      className="g-framed"
      data-width={module.width}
      data-compare={themes.length > 1 || undefined}
      data-phone={phone || undefined}
    >
      {themes.map((theme) => (
        <ThemeFrame
          key={theme}
          module={module}
          variant={variant}
          clock={clock}
          control={control}
          theme={theme}
          phone={phone}
          captioned={themes.length > 1}
        />
      ))}
    </div>
  );
}

function ThemeFrame({
  module,
  variant,
  clock,
  control,
  theme,
  phone,
  captioned,
}: {
  module: Module;
  variant: ModuleVariant;
  clock: SceneClock | null;
  control?: (command: SceneCommand) => void;
  theme: ThemeId;
  phone: boolean;
  /** Name the theme above the frame: only when there is more than one to tell apart. */
  captioned: boolean;
}) {
  const { S, state } = useGallery();
  const text = useText();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(432);
  // A module designed at the app's width gets a frame that wide, scaled to the figure like the
  // section's own preview; at phone width the 390 px frame is the point, so it is never scaled.
  const natural = naturalWidth(module);
  const fitted = phone || natural === null ? null : embedWidth(module.id, natural);
  /** Whether the frame follows this section's clock. Fixed for the variant: it is in the src. */
  const [synced] = useState(clock !== null);
  /** What the frame should hold now, re-sent when the frame says it is listening. */
  const message = useRef<ReturnType<typeof clockMessage> | null>(null);
  message.current = clock ? clockMessage(module.id, variant.key, clock) : null;
  /** The section's reducer, for a command the frame's composition sends up. */
  const relay = useRef(control);
  relay.current = control;
  const post = () => {
    if (message.current)
      frame.current?.contentWindow?.postMessage(message.current, window.location.origin);
  };
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number };
      if (data?.type === "gallery:height" && typeof data.height === "number")
        setHeight(Math.ceil(data.height));
      else if (data?.type === CLOCK_READY) post();
      else {
        const command = readControlMessage(data, module.id, variant.key);
        if (command) relay.current?.(command);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // `post` and `relay` read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, module.id, variant.key, fitted]);
  // Every change of the section's clock reaches the frame at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(post, [clock]);
  const paused = clock && !clock.playing && !isSettled(clock.frames, clock);
  const currentFrame = clock?.frames[clock.index];
  const crumb = formatBreadcrumb({
    theme: text.theme(theme),
    module: text.module(module).title,
    variant: [text.variant(module, variant)],
    frame: paused && currentFrame ? text.frame(module, variant, currentFrame) : undefined,
    tier: state.tier,
    ...text.qualifiers(),
  });
  // Nothing about the clock goes into the src: a new frame must not reload the document.
  const src = `${BASE}/embed${formatGalleryQuery(
    { ...state, theme, compare: false, variants: {} },
    { module: module.id, variant: variant.key, ...(synced ? { sync: "1" } : {}) },
  )}`;
  const iframe = (
    <iframe
      ref={frame}
      className="g-embed-frame"
      data-theme={theme}
      title={S.section.compareFrame(text.theme(theme))}
      src={src}
      loading="lazy"
      style={{ height, width: phone ? PHONE_WIDTH : undefined }}
    />
  );
  return (
    <figure className="g-framed-item">
      {captioned && (
        <figcaption>
          <span className="g-framed-theme">{text.theme(theme)}</span>
          <Breadcrumb text={crumb} className="g-crumb-compact" />
        </figcaption>
      )}
      {fitted === null ? iframe : <Fit natural={fitted}>{iframe}</Fit>}
    </figure>
  );
}
