/**
 * Foundations › Spacing: the five rhythm steps as a ruler over a real settings page — a glyph welded
 * to its label (stack-0), related rows (stack-1), a row group under its section title (stack-2), one
 * section after another (stack-3) and the page header above the content (stack-4) — so it shows that
 * siblings of different kinds never share a gap. Below it, the theme's space unit at one, two, four
 * and eight (every `h-8` and `px-2` is a multiple of it, so this is where a theme's density starts)
 * and the control rungs with their measured heights — each theme's own, since nothing about size
 * is shared between themes.
 */
import type { CSSProperties, ReactNode } from "react";
import { useGallery } from "../state";
import { BoardGroup, Glyph, Measured } from "./shared";

const GLYPHS = {
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  globe:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z",
} as const;

/** A gap drawn as a measured band: its height is the step, its label names it. */
function Gap({ step }: { step: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <div className="gf-gap" style={{ height: `var(--ui-stack-${step})` }}>
      <span className="gf-gap-label gf-caption gf-mono">stack-{step}</span>
    </div>
  );
}

function Row({
  glyph,
  label,
  value,
}: {
  glyph: keyof typeof GLYPHS;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="gf-pref">
      <span className="gf-pref-label">
        <Glyph d={GLYPHS[glyph]} size={15} />
        <span className="gf-gap-inline" style={{ width: "var(--ui-stack-0)" }} />
        {label}
      </span>
      {value}
    </div>
  );
}

function Segments({ options, value }: { options: readonly string[]; value: number }) {
  return (
    <span className="gf-segmented">
      {options.map((option, i) => (
        <span key={option} data-active={i === value || undefined}>
          {option}
        </span>
      ))}
    </span>
  );
}

const RUNGS = [
  { rung: "sm", text: "small" },
  { rung: "md", text: "body" },
  { rung: "lg", text: "body" },
] as const;

const UNITS = [1, 2, 4, 8] as const;

export function SpacingBoard() {
  const { S } = useGallery();
  const t = S.foundations.spacingPage;
  return (
    <div className="gf-board">
      <div className="gf-ruler">
        <h3 className="gf-page-title">{t.title}</h3>
        <Gap step={4} />
        <h4 className="gf-section-title">{t.appearance}</h4>
        <Gap step={2} />
        <Row glyph="sun" label={t.theme} value={<Segments options={t.themeOptions} value={2} />} />
        <Gap step={1} />
        <Row
          glyph="type"
          label={t.fontSize}
          value={<Segments options={t.sizeOptions} value={1} />}
        />
        <Gap step={3} />
        <h4 className="gf-section-title">{t.general}</h4>
        <Gap step={2} />
        <Row
          glyph="globe"
          label={t.language}
          value={<Segments options={t.languageOptions} value={0} />}
        />
        <Gap step={1} />
        <Row glyph="bell" label={t.notifications} value={<span className="gf-switch" data-on />} />
        <p className="gf-caption gf-note gf-ruler-note">{S.foundations.stack0Note}</p>
      </div>
      <BoardGroup title={S.foundations.spaceUnit} aside={S.foundations.spaceUnitNote}>
        <div className="gf-units">
          {UNITS.map((n) => (
            <span key={n} className="gf-unit">
              <span className="gf-caption gf-mono">× {n}</span>
              <Measured
                className="gf-unit-bar"
                style={{ height: `calc(var(--ui-space-unit) * ${n})` }}
              />
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={S.foundations.controlHeights}>
        <div className="gf-rungs">
          {RUNGS.map(({ rung, text }) => (
            <span key={rung} className="gf-rung">
              <span className="gf-caption gf-mono">{rung}</span>
              <Measured
                className="gf-control"
                style={
                  {
                    paddingBlock: `var(--ui-control-py-${rung})`,
                    paddingInline: `var(--ui-control-px-${rung})`,
                    fontSize: `var(--ui-text-${text}-size)`,
                    lineHeight: `var(--ui-text-${text}-lh)`,
                  } as CSSProperties
                }
              >
                {S.foundations.scene.primary}
              </Measured>
            </span>
          ))}
        </div>
      </BoardGroup>
    </div>
  );
}
