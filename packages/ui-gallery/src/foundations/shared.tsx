/**
 * Building blocks the Foundations boards share. A board renders INSIDE the themed preview, so it is
 * themed: every specimen reads the bare token (an undefined token must look broken), and the names
 * printed beside a specimen are labels in the caption rung, not token rows — the resolved values
 * live in the module's tokens drawer.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FIXTURES } from "../../../ui/src/fixtures";
import { useGallery } from "../state";
import { SPECIMENS } from "./specimens";

/** A titled group on a board: a label rung and its content, ruled from the group above. */
export function BoardGroup({
  title,
  aside,
  action,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  /** A control at the end of the head row: the motion board's replay. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="gf-group">
      <div className="gf-group-head">
        <h3>{title}</h3>
        {aside !== undefined && <span className="gf-aside">{aside}</span>}
        {action !== undefined && <span className="gf-group-action">{action}</span>}
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
  children?: ReactNode;
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

/** A small themed control that replays a motion specimen. */
export function ReplayButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { S } = useGallery();
  return (
    <button type="button" className="gf-replay" onClick={onClick}>
      {label ?? S.foundations.replay}
    </button>
  );
}

/**
 * The app window through `.ui-shell`: a navigation column with three rows (the first selected) and
 * a main column with a title and a line of text, in the anatomy the recipes select on. Frost lays
 * its field behind it and floats the main column; Console rules the columns and marks the selected
 * row; Primer leaves the specimen's own classes alone.
 */
export function ShellSpecimen() {
  const { state } = useGallery();
  const nav = FIXTURES[state.lang].copy.nav;
  const specimen = SPECIMENS[state.lang];
  return (
    <div className="ui-shell gf-shell">
      <div data-slot="nav" className="gf-shell-nav">
        <span className="gf-shell-row" aria-current="page">
          {nav.newChat}
        </span>
        <span className="gf-shell-row">{nav.agents}</span>
        <span className="gf-shell-row">{nav.models}</span>
      </div>
      <div data-slot="main" className="gf-shell-main">
        <strong className="gf-shell-title">{specimen.heading}</strong>
        <p className="gf-shell-text">{specimen.ui}</p>
      </div>
    </div>
  );
}
