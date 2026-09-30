/**
 * Foundations › Colour: the palette as it is used, not as a list. The four surfaces stacked with
 * the three inks and the three lines drawn on each; the accent — the theme's own and the five
 * presets the active theme lists, in the mode under review — as a filled button and a selected
 * row, and the link; the six tones as a dot, a word and the soft / outline / solid badge; the
 * chart series as bars; the code and diff colours on a hunk. Every value, with its contrast
 * ratios, is in the tokens drawer.
 */
import { ACCENT_PRESETS, TONES } from "@prismshadow/penguin-ui";
import type { ThemeId, ThemeModeName, ToneName } from "@prismshadow/penguin-ui";
import type { CSSProperties } from "react";
import geekCss from "../../../ui/src/themes/geek.css?raw";
import githubCss from "../../../ui/src/themes/github.css?raw";
import modernCss from "../../../ui/src/themes/modern.css?raw";
import { useGallery } from "../state";
import { BoardGroup } from "./shared";

const SURFACES = ["--ui-canvas", "--ui-surface", "--ui-surface-muted", "--ui-inset"] as const;
const INKS = ["--ui-fg", "--ui-fg-muted", "--ui-fg-subtle"] as const;
const LINES = ["--ui-line", "--ui-line-muted", "--ui-line-emphasis"] as const;

/** Each theme file's source: its presets are read from it, the way the contract test reads them. */
const THEME_CSS: Readonly<Record<ThemeId, string>> = {
  github: githubCss,
  modern: modernCss,
  geek: geekCss,
};

/**
 * The six accent tokens a preset sets under a theme in a mode, as inline custom properties: the
 * `[data-accent="<id>"] { … }` rule of the theme's file, overlaid in dark with the
 * `[data-accent="<id>"].dark { … }` rule when the theme lifts the preset. A specimen carrying them
 * paints the preset without touching the root, which stays on the reader's own choice.
 */
function presetStyle(theme: ThemeId, preset: string, mode: ThemeModeName): CSSProperties {
  const css = THEME_CSS[theme];
  const style: Record<string, string> = {};
  const overlay = (dark: boolean) => {
    const tail = dark ? String.raw`\.dark` : "";
    const block =
      new RegExp(String.raw`\[data-accent="${preset}"\]${tail}\s*\{([^}]*)\}`).exec(css)?.[1] ?? "";
    for (const match of block.matchAll(/(--ui-accent[\w-]*):\s*([^;]+);/g)) {
      style[match[1]!] = match[2]!.trim();
    }
  };
  overlay(false);
  if (mode === "dark") overlay(true);
  return style as CSSProperties;
}

const tone = (name: ToneName, part: string) => `var(--ui-tone-${name}-${part})`;

/** Bar heights for the six chart series: a plausible week, not a gradient. */
const BARS = [72, 48, 88, 36, 60, 24];

function Surfaces() {
  const { S } = useGallery();
  return (
    <div>
      <div className="gf-surfaces-head gf-caption">
        <span />
        <span>{S.foundations.inks}</span>
        <span>{S.foundations.lines}</span>
      </div>
      <div className="gf-surfaces">
        {SURFACES.map((surface) => (
          <div key={surface} className="gf-surface" style={{ background: `var(${surface})` }}>
            <code className="gf-caption gf-mono">{surface.slice(5)}</code>
            <span className="gf-inks">
              {INKS.map((ink, i) => (
                <span key={ink} style={{ color: `var(${ink})` }}>
                  {S.foundations.inkWords[i]}
                </span>
              ))}
            </span>
            <span className="gf-lines">
              {LINES.map((line) => (
                <span key={line} className="gf-line" style={{ borderColor: `var(${line})` }}>
                  <span className="gf-caption gf-mono">
                    {line === "--ui-line" ? "line" : line.slice("--ui-line-".length)}
                  </span>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Accents() {
  const { S, state, mode } = useGallery();
  const columns = [
    { key: "theme", label: S.foundations.themeAccent, style: {} },
    ...ACCENT_PRESETS[state.theme].map((preset) => ({
      key: preset.id,
      label: preset.id,
      style: presetStyle(state.theme, preset.id, mode),
    })),
  ];
  return (
    <>
      <div className="gf-accents">
        {columns.map((column) => (
          <div key={column.key} className="gf-accent" style={column.style}>
            <span className="gf-caption gf-mono">{column.label}</span>
            <span className="gf-accent-button">{S.foundations.sampleSend}</span>
            <span className="gf-accent-row">{S.foundations.selectedRow}</span>
          </div>
        ))}
      </div>
      <p className="gf-links">
        <a href="#colour" onClick={(event) => event.preventDefault()} className="gf-link">
          {S.foundations.sampleLink}
        </a>
        <span className="gf-link" data-hover>
          {S.foundations.sampleLink}
        </span>
        <span className="gf-caption">{S.foundations.linkHover}</span>
      </p>
    </>
  );
}

function Tones() {
  const { S } = useGallery();
  return (
    <div className="gf-tones">
      {TONES.map((name) => {
        const word = S.foundations.toneWords[name];
        return (
          <div key={name} className="gf-tone">
            <code className="gf-caption gf-mono">{name}</code>
            <span className="gf-tone-mark" style={{ color: tone(name, "fg") }}>
              <span className="gf-dot" />
              {word}
            </span>
            <span
              className="gf-badge"
              style={{ color: tone(name, "fg"), background: tone(name, "bg") }}
            >
              {word}
            </span>
            <span
              className="gf-badge"
              style={{
                color: tone(name, "fg"),
                borderColor: tone(name, "line"),
                background: "transparent",
              }}
            >
              {word}
            </span>
            <span
              className="gf-badge"
              style={{
                color: tone(name, "emphasis-fg"),
                background: tone(name, "emphasis"),
                borderColor: tone(name, "emphasis"),
              }}
            >
              {word}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Charts() {
  const { S } = useGallery();
  return (
    <div className="gf-charts">
      <div>
        <div className="gf-bars" role="img" aria-label={S.foundations.charts}>
          {BARS.map((height, i) => (
            <span
              key={i}
              className="gf-bar"
              style={{ height: `${height}%`, background: `var(--ui-chart-${i + 1})` }}
            />
          ))}
        </div>
        <div className="gf-bar-captions gf-caption gf-mono">
          {BARS.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
      </div>
      <div className="gf-stacked">
        <span className="gf-caption">{S.foundations.tokenSeries}</span>
        <span className="gf-stacked-bar">
          <span style={{ flexGrow: 62, background: "var(--ui-chart-cache-read)" }} />
          <span style={{ flexGrow: 14, background: "var(--ui-chart-cache-write)" }} />
          <span style={{ flexGrow: 24, background: "var(--ui-chart-output)" }} />
        </span>
        <span className="gf-legend gf-caption">
          {(["cache-read", "cache-write", "output"] as const).map((series) => (
            <span key={series}>
              <span className="gf-swatch" style={{ background: `var(--ui-chart-${series})` }} />
              {series}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function Code() {
  const { S } = useGallery();
  const hunk = S.foundations.codeLines;
  return (
    <div className="gf-code">
      <div className="gf-code-line" style={{ background: "var(--ui-diff-hunk-bg)" }}>
        <span className="gf-gutter" />
        <span className="gf-subtle">@@ -38,3 +38,5 @@</span>
      </div>
      <div className="gf-code-line" style={{ background: "var(--ui-diff-del-bg)" }}>
        <span className="gf-gutter">38</span>
        <span>
          {hunk.before}
          <mark style={{ background: "var(--ui-diff-del-word)" }}>{hunk.removed}</mark>
          {hunk.after}
        </span>
      </div>
      <div className="gf-code-line" style={{ background: "var(--ui-diff-add-bg)" }}>
        <span className="gf-gutter">38</span>
        <span>
          {hunk.before}
          <mark style={{ background: "var(--ui-diff-add-word)" }}>{hunk.added}</mark>
          {hunk.after}
        </span>
      </div>
      <div className="gf-code-line">
        <span className="gf-gutter">39</span>
        <span>
          <mark style={{ background: "var(--ui-code-selection)" }}>{hunk.selected}</mark>
        </span>
      </div>
    </div>
  );
}

export function ColourBoard() {
  const { S } = useGallery();
  return (
    <div className="gf-board">
      <BoardGroup title={S.foundations.surfaces}>
        <Surfaces />
      </BoardGroup>
      <BoardGroup title={S.foundations.accent} aside={S.foundations.presetsHint}>
        <Accents />
      </BoardGroup>
      <BoardGroup title={S.foundations.tones}>
        <Tones />
      </BoardGroup>
      <div className="gf-pair">
        <BoardGroup title={S.foundations.charts}>
          <Charts />
        </BoardGroup>
        <BoardGroup title={S.foundations.code}>
          <Code />
        </BoardGroup>
      </div>
    </div>
  );
}
