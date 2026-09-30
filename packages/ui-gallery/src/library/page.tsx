/**
 * The board page inside a library frame: the topic's board on the theme's canvas, and the
 * height report the page around the frame sizes it by — the board's own box, measured as it
 * lays out and re-measured as it changes (a dialog opening, a list expanding), never the
 * document's, whose scroll height can only grow while the frame is as tall as it was.
 */
import { useEffect, useRef } from "react";
import { BOARDS } from "./boards";
import { LIBRARY_HEIGHT_MESSAGE } from "./frame";
import type { TopicId } from "./topics";

export function LibraryBoardPage({ topic }: { topic: TopicId }) {
  const Board = BOARDS[topic];
  const page = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = page.current;
    if (!el || window.parent === window) return;
    const report = () =>
      window.parent.postMessage(
        { type: LIBRARY_HEIGHT_MESSAGE, height: el.getBoundingClientRect().height },
        "*",
      );
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    void document.fonts.ready.then(report);
    return () => observer.disconnect();
  }, []);

  // What the screenshot script waits for: the board mounted and its fonts loaded.
  useEffect(() => {
    void document.fonts.ready.then(() => {
      document.documentElement.dataset.galleryReady = "1";
    });
  }, []);

  return (
    <main ref={page} className="lib-page" data-topic={topic}>
      <Board />
    </main>
  );
}
