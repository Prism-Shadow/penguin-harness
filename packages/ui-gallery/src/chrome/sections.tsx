/**
 * The three sections after a module page's variants:
 *
 * - Parts: the catalog sections the module lists. A part with a demo is a small framed preview
 *   with its own axis controls and breadcrumb in the part form; a planned part is one grey line.
 * - Tokens: the contract tokens the page's compositions read — each part's declared `tokensUsed`,
 *   plus what the rendered compositions' CSS actually references — resolved in the active theme
 *   and mode, with the WCAG ratio of every ink against the surfaces it sits on.
 * - Source: the module file's text.
 */
import { useEffect, useState } from "react";
import type { ComponentSection } from "../../../ui/src/catalog";
import { catalogSection } from "../../../ui/src/catalog";
import type { Demo } from "../../../ui/src/demo";
import type { Module } from "../../../ui/src/module";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { composite, contrastRatio, toHex } from "../lib/color";
import { contrastFloor, contrastTargets } from "../lib/contrast";
import { formatVariantKey, parseVariantKey } from "../lib/demos";
import { paintColor } from "../lib/token-probe";
import type { TokenValues } from "../lib/token-probe";
import { sortTokens, tokensReadBy } from "../lib/tokens-read";
import { DemoView, useText } from "../preview";
import { DEMOS, loadSource, repoPath } from "../registry";
import { useGallery } from "../state";
import { AxisPills } from "./axes";
import { useCopy } from "./copy";
import { Breadcrumb } from "./crumb";

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

function PartCard({
  module,
  section,
  demo,
}: {
  module: Module;
  section: ComponentSection;
  demo: Demo;
}) {
  const { state } = useGallery();
  const text = useText();
  // A part's pick is the card's own state: it is not part of the page's address.
  const [key, setKey] = useState<string | undefined>(undefined);
  const pick = parseVariantKey(demo.axes, demo.matrix, key);
  const { title, description } = text.part(section);
  const pickWords =
    Object.keys(demo.axes ?? {}).length > 0 ? formatVariantKey(demo.axes, pick) : "";
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    page: text.module(module).title,
    section: pickWords ? `${title} › ${pickWords.replaceAll(".", " · ")}` : title,
    size: state.size,
    ...text.qualifiers(),
  });
  const onPick = (next: string) => setKey(next);
  return (
    <div id={section.id} className="g-part">
      <div className="g-part-head">
        <strong>{title}</strong>
        <span className="g-muted">{description}</span>
      </div>
      <div className="g-preview g-part-preview">
        <DemoView demo={demo} pick={pick} />
      </div>
      <div className="g-part-foot">
        <AxisPills axes={demo.axes} matrix={demo.matrix} pick={pick} onPick={onPick} />
        <Breadcrumb text={crumb} />
      </div>
    </div>
  );
}

export function PartsSection({ module }: { module: Module }) {
  const { S } = useGallery();
  const text = useText();
  const sections = module.parts.flatMap((id) => {
    const section = catalogSection(id);
    return section ? [section] : [];
  });
  return (
    <section id="parts" className="g-section">
      <h2 className="g-h2">{S.section.parts}</h2>
      <p className="g-section-meta">{S.section.partsOf(sections.length)}</p>
      {sections.length === 0 ? (
        <p className="g-muted">{S.section.noParts}</p>
      ) : (
        <div className="g-parts">
          {sections.map((section) => {
            const demo = DEMOS.byId.get(section.id)?.demo;
            if (demo)
              return <PartCard key={section.id} module={module} section={section} demo={demo} />;
            const { title } = text.part(section);
            const line = [
              title,
              section.wave,
              section.replaces && S.section.replaces(section.replaces),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <p key={section.id} className="g-part-line" data-tooltip={section.id}>
                {line}
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/**
 * Measures the tokens the page's rendered compositions read, retrying while none is mounted yet
 * (framed embeds load lazily).
 */
function useMeasuredTokens(roots: () => Element[], key: string): string[] | null {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    const measure = () => {
      const found = roots();
      if (found.length > 0) {
        setNames(sortTokens(new Set(found.flatMap((root) => tokensReadBy(root)))));
      } else if (tries++ < 20) timer = window.setTimeout(measure, 250);
    };
    // After paint, so the compositions and any frame have mounted.
    timer = window.setTimeout(measure, 50);
    return () => window.clearTimeout(timer);
    // `roots` is read afresh on every attempt; `key` says when to measure again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return names;
}

function Ratios({ name, values }: { name: string; values: TokenValues }) {
  const targets = contrastTargets(name);
  const floor = contrastFloor(name);
  const canvas = values["--ui-canvas"] || "#ffffff";
  const chips = targets.flatMap((target) => {
    const bgValue = values[target];
    const bg = bgValue ? paintColor(bgValue, canvas) : null;
    const fg = bg && values[name] ? paintColor(values[name] ?? "", toHex(bg)) : null;
    if (!bg || !fg) return [];
    const ratio = contrastRatio(composite(fg, bg), bg);
    // No floor: the ratio is shown and never marked failing.
    return [{ target, ratio, pass: floor === null ? undefined : ratio >= floor }];
  });
  if (chips.length === 0) return null;
  return (
    <span className="g-ratios">
      {chips.map(({ target, ratio, pass }) => (
        <span
          key={target}
          className="g-ratio"
          data-pass={pass}
          data-tooltip={`${name} on ${target}`}
        >
          {target.replace("--ui-", "")} {ratio.toFixed(1)}
        </span>
      ))}
    </span>
  );
}

export function TokensSection({
  module,
  roots,
  measureKey,
}: {
  module: Module;
  /** The rendered compositions to measure: the page's previews, and the active theme's frames. */
  roots: () => Element[];
  measureKey: string;
}) {
  const { S, tokens, state, mode } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const measured = useMeasuredTokens(roots, measureKey);
  const declared = module.parts.flatMap((id) => DEMOS.byId.get(id)?.demo.tokensUsed ?? []);
  const names = sortTokens(new Set([...declared, ...(measured ?? [])]));
  const values = tokens?.[state.theme][mode] ?? {};
  return (
    <section id="tokens" className="g-section">
      <h2 className="g-h2">{S.section.tokens}</h2>
      <p className="g-section-meta">
        {S.section.tokensIn(`${text.theme(state.theme)} · ${S.rail.modes[mode]}`, names.length)}
      </p>
      {measured === null ? (
        <p className="g-muted">{S.intro.resolving}</p>
      ) : names.length === 0 ? (
        <p className="g-muted">{S.section.noTokens}</p>
      ) : (
        <div className="g-token-list">
          {names.map((name) => {
            const value = values[name] ?? "";
            const color = paintColor(value);
            return (
              <button
                key={name}
                type="button"
                className="g-token"
                onClick={() => copy(name, `${name}: ${value};`)}
              >
                <span
                  className="g-token-swatch"
                  style={{ background: color ? value : "transparent" }}
                  data-empty={!color || undefined}
                />
                <span className="g-token-name">{name}</span>
                <span className="g-token-value" data-unset={!value || undefined}>
                  {copied === name ? S.section.copied : value || S.section.unset}
                </span>
                <Ratios name={name} values={values} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------------------------

export function SourceSection({ path }: { path: string }) {
  const { S } = useGallery();
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadSource(path).then((text) => live && setSource(text));
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <section id="source" className="g-section">
      <h2 className="g-h2">{S.section.source}</h2>
      <p className="g-section-meta">
        <code>{repoPath(path)}</code>
      </p>
      <pre className="g-code">{source ?? S.section.loadingCode}</pre>
    </section>
  );
}
