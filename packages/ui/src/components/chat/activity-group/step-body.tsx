import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createStreamFollow, followToBottom } from "../stream-text/stream-follow";

/** Long live output follows its tail until the reader scrolls back; an older page opens at its start. */
export function StepBody({ live, children }: { live: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [follow] = useState(createStreamFollow);
  useLayoutEffect(() => {
    const viewport = box.current;
    if (!live || !viewport || !content.current) return;
    const catchUp = () => followToBottom(viewport, follow);
    catchUp();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(catchUp);
    observer.observe(content.current);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [live, follow]);
  return (
    <div
      ref={box}
      data-step-content=""
      className="max-h-56 overflow-auto"
      onScroll={(event) => follow.scrolled(event.currentTarget)}
      onWheel={(event) => follow.wheel(event.deltaY)}
      onTouchStart={(event) => {
        if (event.touches[0]) follow.touchStart(event.touches[0].clientY);
      }}
      onTouchMove={(event) => {
        if (event.touches[0]) follow.touchMove(event.touches[0].clientY);
      }}
      onTouchEnd={() => follow.touchEnd()}
      onTouchCancel={() => follow.touchEnd()}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}
