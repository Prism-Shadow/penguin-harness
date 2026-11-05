/**
 * The board page inside a library frame: the topic's board on the theme's canvas, and the
 * height report the page around the frame sizes it by. The height is what is painted
 * (frame-height.ts): the board, and any overlay open over it — a menu, a tooltip, a toast, a
 * dialog — measured again whenever the board lays out differently or anything is added to,
 * removed from or moved in the body (the app's overlays are portals on the body). The reports
 * are coalesced to one per animation frame, and one is sent only when the height changed.
 *
 * A report that will resize the frame is announced to the resize guard first (frame-resize.ts),
 * so the app's panels do not take the frame's own growth for a window resize and close; the
 * growth itself is heard back through the guard and measured once more, since a dialog's body
 * opens up to the taller viewport and the panel may then need a little more.
 */
import { useEffect, useRef } from "react";
import { BOARDS } from "./boards";
import { LIBRARY_HEIGHT_MESSAGE } from "./frame";
import { measureFrameHeight } from "./frame-height";
import { expectSelfResize, onSelfResize } from "./frame-resize";
import type { TopicId } from "./topics";

export function LibraryBoardPage({ topic }: { topic: TopicId }) {
  const Board = BOARDS[topic];
  const page = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = page.current;
    const root = document.getElementById("root");
    if (!main || !root || window.parent === window) return;
    let frame = 0;
    let reported = -1;
    const report = () => {
      frame = 0;
      const height = measureFrameHeight(document, main, root);
      if (height === reported) return;
      reported = height;
      if (height !== window.innerHeight) expectSelfResize();
      window.parent.postMessage({ type: LIBRARY_HEIGHT_MESSAGE, height }, "*");
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(report);
    };
    schedule();
    const sizes = new ResizeObserver(schedule);
    sizes.observe(main);
    // Portals come and go as direct children of the body; a panel that moves or grows changes
    // its style or its contents.
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    void document.fonts.ready.then(schedule);
    const unsubscribe = onSelfResize(schedule);
    return () => {
      sizes.disconnect();
      mutations.disconnect();
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
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
