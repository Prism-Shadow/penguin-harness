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

/**
 * Line-icon paths the boards' stand-in rows draw (24-grid, the app's own shapes): the three
 * navigation entries, a folder and a file with their chevrons, and two menu verbs.
 */
export const SAMPLE_GLYPHS = {
  newChat: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  agents:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  models:
    "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z",
  trash:
    "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
} as const;

/** The navigation rows' glyphs, in the order the specimens list the rows. */
export const NAV_GLYPHS = [
  SAMPLE_GLYPHS.newChat,
  SAMPLE_GLYPHS.agents,
  SAMPLE_GLYPHS.models,
] as const;

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
