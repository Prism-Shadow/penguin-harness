/**
 * `/s/<nothing>`, `/c/<nothing>` or `/fonts/<nothing>`: says so and lists every page there is —
 * the surfaces, the library topics and the fonts pages.
 */
import { SURFACES } from "../app/surfaces";
import { Site } from "../chrome/site";
import { TOPICS } from "../library/topics";
import { BASE } from "../lib/location";
import { FONTS_PAGE_IDS, fontsHref, surfaceHref, topicHref } from "../lib/routes";
import { useGallery } from "../state";
import { useText } from "../text";

export function MissingPage({ id }: { id: string }) {
  const { S, state } = useGallery();
  const text = useText();
  return (
    <Site page="surfaces">
      <article className="g-doc">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.site.surfaces}</p>
          <h1 className="g-h1">{S.site.notFound(id)}</h1>
        </header>
        <section className="g-section">
          <h2 className="g-h2">{S.site.allSurfaces}</h2>
          <ul className="g-index">
            {SURFACES.map((surface) => {
              const named = text.surface(surface.id);
              return (
                <li key={surface.id}>
                  <a href={surfaceHref(BASE, state, surface.id)}>
                    <strong>{named.title}</strong>
                    <span>{named.description}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="g-section">
          <h2 className="g-h2">{S.library.title}</h2>
          <ul className="g-index">
            {TOPICS.map((topic) => {
              const named = text.topic(topic.id);
              return (
                <li key={topic.id}>
                  <a href={topicHref(BASE, state, topic.id)}>
                    <strong>{named.title}</strong>
                    <span>{named.description}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="g-section">
          <h2 className="g-h2">{S.site.fonts}</h2>
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
      </article>
    </Site>
  );
}
