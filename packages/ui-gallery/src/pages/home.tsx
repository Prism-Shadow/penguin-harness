/**
 * `/` — the home page: a short intro, the real app in a frame (the finished conversation, in the
 * active theme, laid out for the app's window and scaled to the column; Reload reloads it), then
 * the three sections' indexes — every surface in its group, every library topic in its group,
 * and the fonts pages — each entry a card linking to its page.
 */
import { useState } from "react";
import { HOME_SURFACE, SURFACE_GROUPS, surfaceById } from "../app/surfaces";
import { AppFrame, useFrameSrc } from "../chrome/app-frame";
import { ChromeIcon } from "../chrome/icons";
import { Site } from "../chrome/site";
import { TOPIC_GROUPS } from "../library/topics";
import { BASE } from "../lib/location";
import { FONTS_PAGE_IDS, fontsHref, surfaceHref, topicHref } from "../lib/routes";
import { useGallery } from "../state";
import { useText } from "../text";

export function HomePage() {
  const { S, state } = useGallery();
  const text = useText();
  const [epoch, setEpoch] = useState(0);
  const surface = surfaceById(HOME_SURFACE)!;
  const standalone = useFrameSrc(surface, state.theme);

  return (
    <Site page="home">
      <div className="g-home">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.home.eyebrow}</p>
          <h1 className="g-h1">{S.home.title}</h1>
          <p className="g-lead">{S.home.lead}</p>
        </header>

        <section id="app" className="g-section">
          <h2 className="g-h2">{S.home.app}</h2>
          <p className="g-section-lead">{S.home.appLead}</p>
          <div className="g-toolbar">
            <button
              type="button"
              className="g-tool g-tool-primary"
              onClick={() => setEpoch((current) => current + 1)}
            >
              <ChromeIcon name="restart" size={13} />
              <span>{S.frame.reload}</span>
            </button>
            <a className="g-tool" href={standalone} target="_blank" rel="noreferrer">
              <ChromeIcon name="external" size={14} />
              <span>{S.frame.open}</span>
            </a>
          </div>
          <div className="g-frame">
            <AppFrame surface={surface} reloadKey={epoch} />
          </div>
        </section>

        <section id="surfaces" className="g-section">
          <h2 className="g-h2">{S.home.index}</h2>
          <p className="g-section-lead">{S.home.indexLead}</p>
          {SURFACE_GROUPS.map((group) => (
            <div key={group.id} className="g-index-group">
              <h3 className="g-index-eyebrow">{text.surfaceGroup(group.id)}</h3>
              <ul className="g-index">
                {group.surfaces.map((entry) => {
                  const { title, description } = text.surface(entry.id);
                  return (
                    <li key={entry.id}>
                      <a href={surfaceHref(BASE, state, entry.id)}>
                        <strong>{title}</strong>
                        <span>{description}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section id="library" className="g-section">
          <h2 className="g-h2">{S.home.library}</h2>
          <p className="g-section-lead">{S.home.libraryLead}</p>
          {TOPIC_GROUPS.map((group) => (
            <div key={group.id} className="g-index-group">
              <h3 className="g-index-eyebrow">{text.topicGroup(group.id)}</h3>
              <ul className="g-index">
                {group.topics.map((topic) => {
                  const { title, description } = text.topic(topic.id);
                  return (
                    <li key={topic.id}>
                      <a href={topicHref(BASE, state, topic.id)}>
                        <strong>{title}</strong>
                        <span>{description}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section id="fonts" className="g-section">
          <h2 className="g-h2">{S.home.fonts}</h2>
          <p className="g-section-lead">{S.home.fontsLead}</p>
          <ul className="g-index">
            {FONTS_PAGE_IDS.map((page) => (
              <li key={page}>
                <a href={fontsHref(BASE, state, page)}>
                  <strong>{S.fonts.pages[page]}</strong>
                </a>
              </li>
            ))}
          </ul>
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
