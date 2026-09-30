/**
 * Foundations › Type: the role scale from h1 to caption, prose, the chrome line and code, each set
 * in its own role tokens, English and Chinese side by side — the step between rungs, the heading
 * weights, Console's mono chrome against its sans prose, and where a Latin face hands over to its
 * CJK fallback, all at a glance. `prose` is the reading face; `ui` is the chrome face `body` sets.
 */
import type { CSSProperties } from "react";
import { useGallery } from "../state";
import { SPECIMENS } from "./specimens";
import type { Specimen } from "./specimens";

interface Role {
  id: string;
  style: CSSProperties;
  text: (s: Specimen) => string;
}

const heading = (n: number, text: (s: Specimen) => string): Role => ({
  id: `h${n}`,
  style: {
    fontFamily: `var(--ui-h${n}-font)`,
    fontSize: `var(--ui-h${n}-size)`,
    lineHeight: `var(--ui-h${n}-lh)`,
    fontWeight: `var(--ui-h${n}-weight)`,
    letterSpacing: `var(--ui-h${n}-tracking)`,
    textTransform: `var(--ui-h${n}-transform)` as CSSProperties["textTransform"],
  },
  text,
});

const ROLES: readonly Role[] = [
  heading(1, (s) => s.display),
  heading(2, (s) => s.heading),
  heading(3, (s) => s.heading),
  heading(4, (s) => s.heading),
  heading(5, (s) => s.heading),
  heading(6, (s) => s.heading),
  {
    id: "prose",
    style: {
      fontFamily: "var(--ui-font-sans)",
      fontSize: "var(--ui-text-prose-size)",
      lineHeight: "var(--ui-text-prose-lh)",
    },
    text: (s) => s.paragraph,
  },
  {
    id: "body",
    style: {
      fontFamily: "var(--ui-font-sans)",
      fontSize: "var(--ui-text-body-size)",
      lineHeight: "var(--ui-text-body-lh)",
      letterSpacing: "var(--ui-tracking-body)",
    },
    text: (s) => s.ui,
  },
  {
    id: "ui",
    style: {
      fontFamily: "var(--ui-font-ui)",
      fontSize: "var(--ui-text-body-size)",
      lineHeight: "var(--ui-text-body-lh)",
      letterSpacing: "var(--ui-tracking-body)",
    },
    text: (s) => s.ui,
  },
  {
    id: "small",
    style: { fontSize: "var(--ui-text-small-size)", lineHeight: "var(--ui-text-small-lh)" },
    text: (s) => s.ui,
  },
  {
    id: "caption",
    style: {
      fontSize: "var(--ui-text-caption-size)",
      lineHeight: "var(--ui-text-caption-lh)",
      color: "var(--ui-fg-muted)",
    },
    text: (s) => s.caption,
  },
  {
    id: "code",
    style: {
      fontFamily: "var(--ui-font-mono)",
      fontSize: "var(--ui-text-code-size)",
      lineHeight: "var(--ui-text-code-lh)",
      letterSpacing: "var(--ui-tracking-mono)",
      whiteSpace: "pre-wrap",
    },
    text: (s) => s.code.split("\n").slice(0, 2).join("\n"),
  },
];

export function TypeBoard() {
  const { S } = useGallery();
  return (
    <div className="gf-board">
      <div className="gf-type">
        <span />
        <span className="gf-caption">{S.rail.langNames.en}</span>
        <span className="gf-caption">{S.rail.langNames.zh}</span>
        {ROLES.map((role) => (
          <div key={role.id} className="gf-type-row">
            <code className="gf-caption gf-mono">{role.id}</code>
            {(["en", "zh"] as const).map((lang) => (
              <p key={lang} lang={lang === "zh" ? "zh-CN" : "en"} style={role.style}>
                {role.text(SPECIMENS[lang])}
              </p>
            ))}
          </div>
        ))}
      </div>
      <p className="gf-caption gf-note">{S.foundations.typeNote}</p>
    </div>
  );
}
