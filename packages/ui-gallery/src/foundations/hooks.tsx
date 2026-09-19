/**
 * Foundations › Hooks: the seven style hooks (`packages/ui/src/hooks.ts`), each on the minimal
 * markup its recipes select on — `.ui-frame` children carry `data-slot`, `.ui-live` carries
 * `data-live`, `.ui-underline-nav` holds `[role=tab]` items, `.ui-display` sits on an `h1`,
 * `.ui-shell` holds a `nav` and a `main` slot — so a theme's hooks can be reviewed before any
 * component carries them. The specimens live here, in the gallery, rather than in a package
 * module: a package file applies a hook only inside the component that hosts it.
 *
 * The base look of each sample lives in `@layer components` (foundations.css): a hook's recipe sits
 * in `@layer ui-theme` and must win over it, exactly as it wins over a component's utilities.
 */
import { HOOKS } from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { useGallery } from "../state";
import { ShellSpecimen } from "./shared";
import { SPECIMENS } from "./specimens";

function Hook({ name, children }: { name: (typeof HOOKS)[number]; children: ReactNode }) {
  const { S } = useGallery();
  return (
    <section className="gf-hook">
      <div className="gf-group-head">
        <h3 className="gf-mono">.{name}</h3>
        <span className="gf-aside">{S.foundations.hookJobs[name]}</span>
      </div>
      <div className="gf-hook-body">{children}</div>
    </section>
  );
}

export function HooksBoard() {
  const { state, S } = useGallery();
  const specimen = SPECIMENS[state.lang];
  const t = S.foundations.hookSamples;
  return (
    <div className="gf-hooks">
      <Hook name="ui-glass">
        <div className="gh-stage">
          <p className="gh-stage-text" aria-hidden>
            {specimen.paragraph}
          </p>
          <div className="ui-glass gh-panel" role="menu">
            {t.menu.map((item, i) => (
              <span key={item} className="gh-menu-row" data-active={i === 1 || undefined}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </Hook>

      <Hook name="ui-eyebrow">
        <div className="gh-list">
          <p className="ui-eyebrow gh-eyebrow">{t.group}</p>
          {t.rows.map((row) => (
            <span key={row} className="gh-list-row">
              {row}
            </span>
          ))}
        </div>
      </Hook>

      <Hook name="ui-display">
        <h1 className="ui-display gh-display" lang="en">
          {SPECIMENS.en.display}
        </h1>
        <h1 className="ui-display gh-display" lang="zh-CN">
          {SPECIMENS.zh.display}
        </h1>
      </Hook>

      <Hook name="ui-live">
        <div className="gh-row">
          <span>
            {t.streaming}
            <span className="ui-live gh-caret" data-live="caret">
              ▌
            </span>
          </span>
          <span className="gh-live">
            <span className="ui-live gh-dot" data-live="dot" />
            {S.foundations.toneWords.success}
          </span>
          <span className="gh-live">
            <span className="ui-live gh-spinner" data-live="spinner" />
            {S.foundations.loading}
          </span>
        </div>
      </Hook>

      <Hook name="ui-frame">
        <div className="ui-frame gh-frame">
          <div data-slot="head" className="gh-frame-head">
            <span className="gf-mono">claude-code-expert/src/rag.ts</span>
            <span>{t.copy}</span>
          </div>
          <pre data-slot="body" className="gh-frame-body">
            {specimen.code.split("\n").slice(0, 2).join("\n")}
          </pre>
          <div data-slot="foot" className="gh-frame-foot">
            <span className="gf-mono">412ms · exit 0</span>
          </div>
        </div>
        <div className="ui-frame gh-frame gh-frame-panes">
          <div data-slot="pane">{SPECIMENS.en.ui}</div>
          <div data-slot="pane">{SPECIMENS.zh.ui}</div>
        </div>
      </Hook>

      <Hook name="ui-underline-nav">
        <div className="ui-underline-nav gh-tabs" role="tablist">
          {t.tabs.map((tab, i) => (
            <span key={tab} role="tab" aria-selected={i === 0} className="gh-tab">
              {tab}
            </span>
          ))}
        </div>
      </Hook>

      <Hook name="ui-shell">
        <ShellSpecimen />
      </Hook>
    </div>
  );
}
