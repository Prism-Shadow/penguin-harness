/**
 * "On this page": the right column of a module page — its variants, then Parts, Tokens and
 * Source — the one in view marked by the scroll-spy (lib/use-scroll-spy.ts).
 */
import { useGallery } from "../state";

export interface TocItem {
  id: string;
  title: string;
}

export function OnThisPage({
  items,
  activeId,
}: {
  items: readonly TocItem[];
  activeId: string | null;
}) {
  const { S } = useGallery();
  return (
    <nav className="g-toc-list" aria-label={S.site.onThisPage}>
      <span className="g-toc-eyebrow">{S.site.onThisPage}</span>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${encodeURIComponent(item.id)}`}
              data-active={item.id === activeId || undefined}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
