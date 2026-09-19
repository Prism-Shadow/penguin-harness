/**
 * Building blocks the Foundations boards share. A board renders INSIDE the themed preview, so it is
 * themed: every specimen reads the bare token (an undefined token must look broken), and the names
 * printed beside a specimen are labels in the caption rung, not token rows — the resolved values
 * live in the module's tokens drawer.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useGallery } from "../state";

/** A titled group on a board: a label rung and its content, ruled from the group above. */
export function BoardGroup({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="gf-group">
      <div className="gf-group-head">
        <h3>{title}</h3>
        {aside !== undefined && <span className="gf-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Resolving() {
  const { S } = useGallery();
  return <p className="gf-muted">{S.intro.resolving}</p>;
}

/** Renders its child and prints the child's rendered height in px, re-measured on resize. */
export function Measured({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style: CSSProperties;
  className: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(Math.round(el.getBoundingClientRect().height * 10) / 10);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <span className="gf-measured">
      <span ref={ref} className={className} style={style}>
        {children}
      </span>
      <span className="gf-caption gf-mono">{height === null ? "…" : `${height}px`}</span>
    </span>
  );
}

/** A 24-grid line icon at the theme's stroke, cap and join. */
export function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  const style: CSSProperties = {
    strokeWidth: "var(--ui-icon-stroke)",
    strokeLinecap: "var(--ui-icon-cap)" as CSSProperties["strokeLinecap"],
    strokeLinejoin: "var(--ui-icon-join)" as CSSProperties["strokeLinejoin"],
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      style={style}
      aria-hidden
      className="gf-glyph"
    >
      <path d={d} />
    </svg>
  );
}
