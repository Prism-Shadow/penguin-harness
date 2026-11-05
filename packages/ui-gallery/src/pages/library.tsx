/**
 * `/c/<topic>` — one component library page: the topic list on the left, the content column —
 * the group's eyebrow, the title, the description, a toolbar (reload, open standalone, copy
 * link, the breadcrumb) and the topic's board framed (chrome/library-frame.tsx).
 */
import { useState } from "react";
import { LibraryFrame, useLibraryFrameSrc } from "../chrome/library-frame";
import { useCopy } from "../chrome/copy";
import { Breadcrumb } from "../chrome/crumb";
import { ChromeIcon } from "../chrome/icons";
import { TopicNav } from "../chrome/sidenav";
import { Site } from "../chrome/site";
import { topicById } from "../library/topics";
import type { TopicId } from "../library/topics";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { absoluteUrl } from "../lib/location";
import { topicPath } from "../lib/routes";
import { formatGalleryQuery } from "../lib/url-state";
import { useGallery } from "../state";
import { useText } from "../text";

export function LibraryPage({ id }: { id: TopicId }) {
  const { S, state } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const [epoch, setEpoch] = useState(0);
  const { title, description } = text.topic(id);
  const standalone = useLibraryFrameSrc(id);
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    page: title,
    size: state.size,
    ...text.qualifiers(),
  });
  const link = () => absoluteUrl(`${topicPath(id)}${formatGalleryQuery(state)}`);

  return (
    <Site
      page="foundations"
      nav={(onNavigate) => <TopicNav activeId={id} {...(onNavigate ? { onNavigate } : {})} />}
      wide
    >
      <article className="g-doc g-doc-wide">
        <header className="g-doc-head">
          <p className="g-eyebrow">{text.topicGroup(topicById(id).group)}</p>
          <h1 className="g-h1">{title}</h1>
          <p className="g-lead">{description}</p>
        </header>

        <section id="board" className="g-section">
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
            <button
              type="button"
              className="g-tool g-tool-icon"
              aria-label={S.section.copyLink}
              data-tooltip={S.section.copyLink}
              onClick={() => copy("link", link())}
            >
              <ChromeIcon name={copied === "link" ? "check" : "link"} size={14} />
            </button>
            <Breadcrumb text={crumb} />
          </div>
          <div className="g-frame">
            <LibraryFrame topic={id} reloadKey={epoch} />
          </div>
        </section>
      </article>
    </Site>
  );
}
