/**
 * The sticky left rail (unthemed): brand and mode switch; the theme, size and language segments;
 * the compare and reduced-motion switches; one scroll-spied link per module; the fonts page; and
 * the feedback note. That is the whole rail, and it fits without scrolling. Every control writes
 * the URL.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { BASE } from "../lib/location";
import { THEME_NAMES, TIER_PX } from "../lib/themes";
import { formatGalleryQuery, LANGS, MODE_PREFS, TIERS } from "../lib/url-state";
import type { ModePref } from "../lib/url-state";
import { useText } from "../preview";
import { MODULES } from "../registry";
import { useGallery } from "../state";
import { Segmented, SwitchRow } from "./controls";
import { ChromeIcon } from "./icons";

const MODE_ICONS = { light: "sun", dark: "moon", system: "monitor" } as const;

export function ModeSwitch() {
  const { S, state, update } = useGallery();
  return (
    <div className="g-mode" role="group" aria-label={S.rail.mode}>
      {MODE_PREFS.map((mode: ModePref) => (
        <button
          key={mode}
          type="button"
          title={S.rail.modes[mode]}
          aria-label={S.rail.modes[mode]}
          aria-pressed={state.mode === mode}
          onClick={() => update({ mode })}
        >
          <ChromeIcon name={MODE_ICONS[mode]} size={15} />
        </button>
      ))}
    </div>
  );
}

export function ViewControls({ compact = false }: { compact?: boolean }) {
  const { S, state, update } = useGallery();
  return (
    <div className="g-controls" data-compact={compact || undefined}>
      <div className="g-control">
        <span className="g-control-label">{S.rail.theme}</span>
        <Segmented
          label={S.rail.theme}
          value={state.theme}
          options={THEME_IDS.map((id) => ({ value: id, label: THEME_NAMES[id] }))}
          onChange={(theme) => update({ theme })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.size}</span>
        <Segmented
          label={S.rail.size}
          value={state.tier}
          options={TIERS.map((tier) => ({
            value: tier,
            label: String(TIER_PX[tier]),
            title: S.rail.sizeTitle(TIER_PX[tier]),
          }))}
          onChange={(tier) => update({ tier })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.language}</span>
        <Segmented
          label={S.rail.language}
          value={state.lang}
          options={LANGS.map((lang) => ({ value: lang, label: S.rail.langNames[lang] }))}
          onChange={(lang) => update({ lang })}
        />
      </div>
    </div>
  );
}

export function Rail({ activeId }: { activeId: string | null }) {
  const { S, state, update } = useGallery();
  const text = useText();
  const query = formatGalleryQuery({ ...state, variants: {} });
  return (
    <aside className="g-rail g-chrome">
      <div className="g-rail-head">
        <a className="g-brand" href={`${BASE}/${query}`}>
          <img src={`${BASE}/penguin-logo.svg`} alt="" width={26} height={26} />
          <span>
            <strong>{S.brand.title}</strong>
            <small>{S.brand.subtitle}</small>
          </span>
        </a>
        <ModeSwitch />
      </div>

      <ViewControls />
      <div className="g-switches">
        <SwitchRow
          label={S.rail.compare}
          checked={state.compare === true}
          onChange={(compare) => update({ compare })}
        />
        <SwitchRow
          label={S.rail.reducedMotion}
          checked={state.motion === "reduced"}
          onChange={(on) => update({ motion: on ? "reduced" : "full" })}
        />
      </div>

      <nav className="g-nav" aria-label={S.rail.modules}>
        {MODULES.list.map(({ module }) => (
          <a
            key={module.id}
            className="g-nav-link"
            href={`#${module.id}`}
            data-active={module.id === activeId || undefined}
          >
            {text.module(module).title}
          </a>
        ))}
        <a className="g-nav-link g-nav-fonts" href={`${BASE}/fonts${query}`}>
          <ChromeIcon name="type" size={14} />
          <span>{S.rail.fonts}</span>
        </a>
      </nav>

      <div className="g-rail-foot">
        <strong>{S.rail.feedbackTitle}</strong>
        <p>{S.rail.feedbackBody}</p>
        <code>Frost › Conversation › Approval · dark · zh</code>
      </div>
    </aside>
  );
}
