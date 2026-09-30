/**
 * A component library board in a frame: one `lib.html` document (src/library/main.tsx) — its
 * own root for the theme attributes, its own storage, the app's own stylesheet — opened on a
 * topic with the page's preferences in the URL (src/library/frame.ts). Laid out at the column's
 * width, unscaled, and as tall as the board: the frame reports its content height through a
 * window message and the page sizes it to match, so the page scrolls, never the frame, and a
 * dialog opened inside sits over the board it belongs to.
 *
 * As with the app frames, a change of theme, mode, size or fonts changes the frame's URL and
 * the frame reloads with the new preferences.
 */
import { useEffect, useRef, useState } from "react";
import { LIBRARY_HEIGHT_MESSAGE, libraryFrameSrc } from "../library/frame";
import type { TopicId } from "../library/topics";
import { topicById } from "../library/topics";
import { BASE } from "../lib/location";
import { useGallery } from "../state";
import { useText } from "../text";

/** The height a frame shows at until its board has reported one. */
const PENDING_HEIGHT = 240;

/** The frame's URL for a topic under the page's preferences. */
export function useLibraryFrameSrc(topic: TopicId): string {
  const { state } = useGallery();
  return libraryFrameSrc(
    BASE,
    {
      theme: state.theme,
      mode: state.mode,
      accent: state.accent,
      size: state.size,
      latin: state.latin,
      cjk: state.cjk,
      lang: state.lang,
    },
    topic,
  );
}

export function LibraryFrame({ topic, reloadKey = 0 }: { topic: TopicId; reloadKey?: number }) {
  const text = useText();
  const src = useLibraryFrameSrc(topic);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const room = topicById(topic).room ?? 0;

  useEffect(() => {
    setHeight(null);
  }, [src, reloadKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const { type, height: reported } = data as { type?: unknown; height?: unknown };
      if (type !== LIBRARY_HEIGHT_MESSAGE || typeof reported !== "number") return;
      setHeight(Math.ceil(reported));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="g-lib" data-loaded={height !== null || undefined}>
      <iframe
        key={`${src}#${reloadKey}`}
        ref={frame}
        className="g-lib-frame"
        title={text.topic(topic).title}
        src={src}
        style={{ height: Math.max(height ?? PENDING_HEIGHT, room) }}
      />
    </div>
  );
}
