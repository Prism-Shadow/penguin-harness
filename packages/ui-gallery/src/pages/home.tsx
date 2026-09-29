/**
 * `/` — the home page: a short intro, the app shell a reader can click through (the package's
 * `AppWindow`, laid out for a 1280 px window and scaled to the column; Reset remounts it), the
 * problems the registry found, if any, and the component index — every module in its group, each
 * a card linking to its page.
 */
import { useState } from "react";
import { AppWindow } from "../../../ui/src/hero";
import { APP_WINDOW_WIDTH } from "../../../ui/src/module";
import { Fit } from "../chrome/fit";
import { ChromeIcon } from "../chrome/icons";
import { Site } from "../chrome/site";
import { MODULE_GROUPS } from "../lib/groups";
import { BASE } from "../lib/location";
import { moduleHref } from "../lib/routes";
import { formatGalleryQuery } from "../lib/url-state";
import { useText } from "../preview";
import { DEMOS, MODULES } from "../registry";
import { useGallery } from "../state";

const PROBLEMS = [...MODULES.problems, ...DEMOS.problems];

export function HomePage() {
  const { S, state, mode } = useGallery();
  const text = useText();
  const [epoch, setEpoch] = useState(0);
  const shellHref = `${BASE}/embed${formatGalleryQuery(
    { ...state, compare: false, variants: {} },
    { module: "hero", variant: "shell" },
  )}`;

  return (
    <Site page="home">
      <div className="g-home">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.home.eyebrow}</p>
          <h1 className="g-h1">{S.home.title}</h1>
          <p className="g-lead">{S.home.lead}</p>
        </header>

        <section id="shell" className="g-section">
          <h2 className="g-h2">{S.home.shell}</h2>
          <p className="g-section-lead">{S.home.shellLead}</p>
          <div className="g-toolbar">
            <span className="g-kind" title={S.variant.kindHints.interactive}>
              <ChromeIcon name="pointer" size={13} />
              {S.variant.kinds.interactive}
            </span>
            <button
              type="button"
              className="g-tool g-tool-primary"
              onClick={() => setEpoch((current) => current + 1)}
            >
              <ChromeIcon name="restart" size={13} />
              <span>{S.variant.reset}</span>
            </button>
            <a className="g-tool" href={shellHref} target="_blank" rel="noreferrer">
              <ChromeIcon name="external" size={14} />
              <span>{S.variant.open}</span>
            </a>
          </div>
          <div className="g-frame">
            <div className="g-preview g-preview-shell" data-module="hero">
              <Fit natural={APP_WINDOW_WIDTH}>
                <AppWindow lang={state.lang} mode={mode} variant="shell" resetKey={epoch} />
              </Fit>
            </div>
          </div>
        </section>

        {PROBLEMS.length > 0 && (
          <div className="g-problems">
            <strong>{S.intro.problems}</strong>
            <ul>
              {PROBLEMS.map((problem) => (
                <li key={problem}>
                  <code>{problem}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section id="components" className="g-section">
          <h2 className="g-h2">{S.home.index}</h2>
          <p className="g-section-lead">{S.home.indexLead}</p>
          {MODULE_GROUPS.map((group) => {
            const entries = group.modules.flatMap((id) => {
              const entry = MODULES.byId.get(id);
              return entry ? [entry] : [];
            });
            if (entries.length === 0) return null;
            return (
              <div key={group.id} className="g-index-group">
                <h3 className="g-index-eyebrow">{text.group(group.id)}</h3>
                <ul className="g-index">
                  {entries.map(({ module }) => {
                    const { title, description } = text.module(module);
                    return (
                      <li key={module.id}>
                        <a href={moduleHref(BASE, state, module.id)}>
                          <strong>{title}</strong>
                          <span>{description}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>

        <aside className="g-note">
          <strong>{S.site.feedbackTitle}</strong>
          <p>{S.site.feedbackBody}</p>
          <code>{S.site.feedbackExample}</code>
        </aside>
      </div>
    </Site>
  );
}
