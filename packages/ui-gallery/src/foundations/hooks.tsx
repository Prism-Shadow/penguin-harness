/**
 * Foundations › Hooks: the ten style hooks (`packages/ui/src/hooks.ts`), each on the minimal
 * markup its recipes select on — `.ui-frame` children carry `data-slot`, `.ui-live` carries
 * `data-live`, `.ui-underline-nav` holds `[role=tab]` items, `.ui-display` sits on an `h1`,
 * `.ui-shell` holds a `nav` and a `main` slot, `.ui-icon-decor` sits on the icon with its
 * `data-role`, `.ui-tree` rows carry `data-depth` and `data-last` with a `data-branch` under a
 * parent, `.ui-field` children carry the `label` / `control` / `hint` slots — so a theme's hooks
 * can be reviewed before any component carries them. The specimens live here, in the gallery,
 * rather than in a package module: a package file applies a hook only inside the component that
 * hosts it.
 *
 * The base look of each sample lives in `@layer components` (foundations.css): a hook's recipe sits
 * in `@layer ui-theme` and must win over it, exactly as it wins over a component's utilities. The
 * tree sample indents its rows the way a host does — by the inset and the indent tokens — so the
 * three themes' guides land on the same columns as in the modules.
 */
import { HOOKS } from "@prismshadow/penguin-ui";
import type { CSSProperties, ReactNode } from "react";
import { useGallery } from "../state";
import { Glyph, NAV_GLYPHS, SAMPLE_GLYPHS, ShellSpecimen } from "./shared";
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

/** A host's own indent for a tree row: what every module's rows spell, from the two tree tokens. */
const indent = (depth: number): CSSProperties => ({
  paddingInlineStart: `calc(var(--ui-tree-inset) + var(--ui-tree-indent) * ${depth})`,
});

function TreeRow({
  depth,
  last = false,
  dir = false,
  open = false,
  children,
}: {
  depth: number;
  last?: boolean;
  dir?: boolean;
  open?: boolean;
  children: string;
}) {
  return (
    <div
      className="gh-tree-row"
      data-depth={depth}
      data-last={last || undefined}
      style={indent(depth)}
    >
      {dir ? (
        <Glyph d={open ? SAMPLE_GLYPHS.chevronDown : SAMPLE_GLYPHS.chevronRight} size={12} />
      ) : (
        <span className="gh-tree-gap" />
      )}
      <Glyph d={dir ? SAMPLE_GLYPHS.folder : SAMPLE_GLYPHS.file} size={14} />
      <span className="gh-tree-name">{children}</span>
    </div>
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

      {/* Three navigation rows (the first selected), a group header and a menu row, each with a
          glyph its label already says: Frost tints them by role, Console drops them. */}
      <Hook name="ui-icon-decor">
        <div className="gh-nav">
          {S.foundations.motionSpecimens.sidebarRows.map((row, i) => (
            <span key={row} className="gh-nav-row" aria-current={i === 0 ? "page" : undefined}>
              <span className="ui-icon-decor gh-nav-glyph" data-role="nav">
                <Glyph d={NAV_GLYPHS[i % NAV_GLYPHS.length] ?? NAV_GLYPHS[0]} size={16} />
              </span>
              {row}
            </span>
          ))}
          <span className="gh-nav-group">
            <span className="ui-icon-decor gh-nav-glyph" data-role="group">
              <Glyph d={SAMPLE_GLYPHS.folder} size={14} />
            </span>
            <span className="ui-eyebrow gh-nav-group-label">{t.group}</span>
          </span>
          <span className="gh-nav-row gh-nav-menu">
            <span className="ui-icon-decor gh-nav-glyph" data-role="menu">
              <Glyph d={SAMPLE_GLYPHS.pin} size={14} />
            </span>
            {t.menu[0]}
          </span>
        </div>
      </Hook>

      {/* A file tree: a root, a folder with two files in a branch, and a last file. */}
      <Hook name="ui-tree">
        <div className="ui-tree gh-tree">
          <TreeRow depth={0} dir open>
            {t.tree.root}
          </TreeRow>
          <div data-branch data-depth={1}>
            <TreeRow depth={1} dir open>
              {t.tree.dir}
            </TreeRow>
            <div data-branch data-depth={2}>
              {t.tree.files.map((file, i) => (
                <TreeRow key={file} depth={2} last={i === t.tree.files.length - 1}>
                  {file}
                </TreeRow>
              ))}
            </div>
            <TreeRow depth={1} last>
              {t.tree.last}
            </TreeRow>
          </div>
        </div>
      </Hook>

      {/* A form field (label, control, hint) and a settings row (label with its hint, a switch):
          Primer keeps each host's own layout, Frost stacks both, Console tabulates both. */}
      <Hook name="ui-field">
        <div className="gh-fields">
          <div className="ui-field gh-field">
            <span data-slot="label" className="gh-field-label">
              {t.field.name}
            </span>
            <div data-slot="control">
              <span className="gh-field-input">{t.field.value}</span>
            </div>
            <span data-slot="hint" className="gf-caption">
              {t.field.hint}
            </span>
          </div>
          <div className="ui-field gh-field-row">
            <div data-slot="label" className="gh-field-label">
              {t.field.notify}
              <span className="gf-caption gh-field-sub">{t.field.notifyHint}</span>
            </div>
            <div data-slot="control">
              <span className="gf-switch" data-on />
            </div>
          </div>
        </div>
      </Hook>
    </div>
  );
}
