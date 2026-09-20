/**
 * A module's three drawers:
 *
 * - Parts: the catalog sections the module lists. A part with a demo is a small card with its own
 *   axis pills, `all` matrix and breadcrumb in the part form; a planned part is one grey line.
 * - Tokens: the contract tokens the composition reads — each part's declared `tokensUsed`, plus what
 *   the rendered composition's CSS actually references — resolved in the active theme and mode,
 *   with the WCAG ratio of every ink against the surfaces it sits on.
 * - Code: the module file's source.
 */
import { useEffect, useState } from "react";
import type { ComponentSection } from "../../../ui/src/catalog";
import { catalogSection } from "../../../ui/src/catalog";
import type { Demo } from "../../../ui/src/demo";
import type { Module } from "../../../ui/src/module";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { composite, contrastRatio, toHex } from "../lib/color";
import { contrastFloor, contrastTargets } from "../lib/contrast";
import { formatVariantKey, parseVariantKey, pickLabels } from "../lib/demos";
import { THEME_NAMES } from "../lib/themes";
import { paintColor } from "../lib/token-probe";
import type { TokenValues } from "../lib/token-probe";
import { sortTokens, tokensReadBy } from "../lib/tokens-read";
import type { TokenReading } from "../lib/tokens-read";
import { withVariant } from "../lib/url-state";
import { DemoView, useText } from "../preview";
import { DEMOS, loadSource, repoPath } from "../registry";
import { useGallery } from "../state";
import { useCopy } from "./copy";
import { AxisPills, Breadcrumb } from "./pills";

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
  const { state, mode, update } = useGallery();
  const text = useText();
  const key = state.variants[section.id];
  const pick = parseVariantKey(demo.axes, demo.matrix, key);
  const { title, description } = text.part(section);
  const crumb = formatBreadcrumb({
    theme: state.theme,
    module: module.title,
    part: section.title,
    variant: Object.keys(demo.axes ?? {}).length > 0 ? pickLabels(demo.axes, pick) : undefined,
    mode,
    lang: state.lang,
    tier: state.tier,
  });
  const onPick = (next: string) => {
    const fallback = formatVariantKey(
      demo.axes,
      parseVariantKey(demo.axes, demo.matrix, undefined),
    );
    update((s) => withVariant(s, section.id, next === fallback ? null : next));
  };
  return (
    <div id={section.id} className="g-part">
      <div className="g-part-head g-chrome">
        <strong>{title}</strong>
        <span className="g-muted">{description}</span>
      </div>
      <div className="g-preview g-part-preview">
        <DemoView demo={demo} pick={pick} />
      </div>
      <div className="g-card-foot g-chrome">
        <Breadcrumb text={crumb} />
        <AxisPills axes={demo.axes} matrix={demo.matrix} pick={pick} onPick={onPick} />
      </div>
    </div>
  );
}

export function PartsDrawer({ module }: { module: Module }) {
  const { S } = useGallery();
  const text = useText();
  const sections = module.parts.flatMap((id) => {
    const section = catalogSection(id);
    return section ? [section] : [];
  });
  return (
    <div className="g-drawer-panel">
      <div className="g-drawer-title g-chrome">{S.section.partsOf(sections.length)}</div>
      {sections.length === 0 ? (
        <p className="g-muted g-chrome">{S.section.noParts}</p>
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
              <p key={section.id} className="g-part-line g-chrome" title={`${section.id}\n${line}`}>
                {line}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/**
 * Measures the tokens a rendered composition reads, retrying while its root is not mounted yet.
 * `null` is "still measuring" and `"unmounted"` is "it never mounted" — a lazy compare frame the
 * browser has not begun loading gives that — so the drawer never sits on "Resolving…" for good.
 */
type Measurement = TokenReading | "unmounted";

function useMeasuredTokens(root: () => Element | null, key: string): Measurement | null {
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    const measure = () => {
      const el = root();
      if (el) setMeasurement(tokensReadBy(el));
      else if (tries++ < 20) timer = window.setTimeout(measure, 250);
      else setMeasurement("unmounted");
    };
    // After paint, so the composition and any frame have mounted.
    timer = window.setTimeout(measure, 50);
    return () => window.clearTimeout(timer);
    // `root` is read afresh on every attempt; `key` says when to measure again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return measurement;
}

function Ratios({ name, values }: { name: string; values: TokenValues }) {
  const targets = contrastTargets(name);
  const floor = contrastFloor(name);
  // `--ui-canvas` is a contract token: every theme × mode declares it.
  const canvas = values["--ui-canvas"]!;
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
        <span key={target} className="g-ratio" data-pass={pass} title={`${name} on ${target}`}>
          {target.replace("--ui-", "")} {ratio.toFixed(1)}
        </span>
      ))}
    </span>
  );
}

export function TokensDrawer({
  module,
  root,
  measureKey,
}: {
  module: Module;
  /** The rendered composition to measure (the card's preview, or the active theme's frame). */
  root: () => Element | null;
  measureKey: string;
}) {
  const { S, tokens, state, mode } = useGallery();
  const [copied, copy] = useCopy();
  const measured = useMeasuredTokens(root, measureKey);
  const reading = measured === null || measured === "unmounted" ? null : measured;
  const declared = module.parts.flatMap((id) => DEMOS.byId.get(id)?.demo.tokensUsed ?? []);
  const names = sortTokens(new Set([...declared, ...(reading?.names ?? [])]));
  const values = tokens?.[state.theme][mode] ?? {};
  return (
    <div className="g-drawer-panel g-chrome">
      <div className="g-drawer-title">
        {S.section.tokensIn(`${THEME_NAMES[state.theme]} · ${S.rail.modes[mode]}`, names.length)}
        {/* A measurement that lost rules says so, rather than reading as a thrifty composition. */}
        {reading !== null && reading.unreadable > 0 && (
          <span className="g-muted"> · {S.section.unreadRules(reading.unreadable)}</span>
        )}
      </div>
      {measured === null ? (
        <p className="g-muted">{S.intro.resolving}</p>
      ) : measured === "unmounted" ? (
        <p className="g-muted">{S.section.notMeasured}</p>
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
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------

export function CodeDrawer({ path }: { path: string }) {
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
    <div className="g-drawer-panel g-chrome">
      <div className="g-drawer-title">{repoPath(path)}</div>
      <pre className="g-code">{source ?? S.section.loadingCode}</pre>
    </div>
  );
}
