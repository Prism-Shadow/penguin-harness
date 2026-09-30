/**
 * `/c/<module>` — a documentation module's page (Foundations): the surface list on the left,
 * the content column — the eyebrow, the title, the description, then a section per board and the
 * Parts, Tokens and Source sections (chrome/sections.tsx) — and "on this page" on the right,
 * scroll-spied. `#<board>` opens on a board's section, `#parts` and the like on a section after
 * them, `#<part-id>` on a part inside Parts.
 */
import { useEffect, useRef } from "react";
import type { ModuleId, ModuleVariant } from "../../../ui/src/module";
import { SURFACES } from "../app/surfaces";
import { useCopy } from "../chrome/copy";
import { Breadcrumb } from "../chrome/crumb";
import { ChromeIcon } from "../chrome/icons";
import { PartsSection, SourceSection, TokensSection } from "../chrome/sections";
import { Site } from "../chrome/site";
import { OnThisPage } from "../chrome/toc";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { absoluteUrl, BASE } from "../lib/location";
import type { CollectedModule } from "../lib/modules";
import { PAGE_SECTION_IDS } from "../lib/modules";
import { anchorOf, moduleHref, modulePath, surfaceHref } from "../lib/routes";
import { formatGalleryQuery } from "../lib/url-state";
import { useScrollSpy } from "../lib/use-scroll-spy";
import { ModuleView, useText } from "../preview";
import { MODULES } from "../registry";
import { useGallery } from "../state";

export function ModulePage({ id }: { id: ModuleId }) {
  const entry = MODULES.byId.get(id);
  return entry ? <ModuleDoc entry={entry} /> : <MissingPage id={id} />;
}

/**
 * The hash target moves while the boards fill in (token-driven layout), so jump once the tokens
 * have resolved and keep the target pinned while the page above it keeps resizing — until the
 * reader scrolls or a few seconds pass.
 */
function usePinnedAnchor(ready: boolean) {
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !ready) return;
    scrolled.current = true;
    const id = anchorOf(window.location.hash);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    const pin = () => target.scrollIntoView();
    requestAnimationFrame(pin);
    const main = document.querySelector(".g-main");
    const observer = new ResizeObserver(pin);
    if (main) observer.observe(main);
    const release = () => {
      observer.disconnect();
      window.removeEventListener("wheel", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("pointerdown", release);
    };
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("pointerdown", release);
    const timer = window.setTimeout(release, 4000);
    return () => {
      window.clearTimeout(timer);
      release();
    };
  }, [ready]);
}

/** The page's own previews, for the Tokens section to measure. */
function previewRoots(): Element[] {
  return Array.from(document.querySelectorAll(".g-main .g-preview[data-module]"));
}

function BoardSection({ entry, variant }: { entry: CollectedModule; variant: ModuleVariant }) {
  const { S, state } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const { module } = entry;
  const title = text.variant(module, variant);
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    page: text.module(module).title,
    section: title,
    size: state.size,
    ...text.qualifiers(),
  });
  const link = () =>
    absoluteUrl(`${modulePath(module.id)}${formatGalleryQuery(state)}#${variant.key}`);
  return (
    <section id={variant.key} className="g-variant">
      <h2 className="g-h2">{title}</h2>
      {variant.description && <p className="g-variant-desc">{variant.description}</p>}
      <div className="g-toolbar">
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
        <div className="g-preview" data-module={module.id}>
          <ModuleView module={module} variant={variant} />
        </div>
      </div>
    </section>
  );
}

function ModuleDoc({ entry }: { entry: CollectedModule }) {
  const { S, state, mode, tokens } = useGallery();
  const text = useText();
  const { module } = entry;
  const { title, description } = text.module(module);
  const ids = [...module.variants.map((variant) => variant.key), ...PAGE_SECTION_IDS];
  const active = useScrollSpy(ids);
  usePinnedAnchor(tokens !== null);

  const problems = MODULES.problems.filter((problem) => problem.includes(entry.path));
  const toc = [
    ...module.variants.map((variant) => ({
      id: variant.key,
      title: text.variant(module, variant),
    })),
    { id: "parts", title: S.section.parts },
    { id: "tokens", title: S.section.tokens },
    { id: "source", title: S.section.source },
  ];
  const measureKey = [state.theme, mode, state.accent, state.lang, state.size, state.view].join(
    "|",
  );

  return (
    <Site
      page="foundations"
      activeId={module.id}
      nav
      toc={<OnThisPage items={toc} activeId={active} />}
    >
      <article className="g-doc">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.site.foundations}</p>
          <h1 className="g-h1">{title}</h1>
          <p className="g-lead">{description}</p>
        </header>
        {problems.length > 0 && (
          <div className="g-problems">
            <strong>{S.intro.problems}</strong>
            <ul>
              {problems.map((problem) => (
                <li key={problem}>
                  <code>{problem}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {module.variants.map((variant) => (
          <BoardSection key={variant.key} entry={entry} variant={variant} />
        ))}
        <PartsSection module={module} />
        <TokensSection module={module} roots={previewRoots} measureKey={measureKey} />
        <SourceSection path={entry.path} />
      </article>
    </Site>
  );
}

/** `/s/<nothing>`, `/c/<nothing>`, or a module id the registry skipped: says so and lists what exists. */
export function MissingPage({ id }: { id: string }) {
  const { S, state } = useGallery();
  const text = useText();
  const problems = MODULES.problems.filter((problem) => problem.includes(id));
  return (
    <Site page="surfaces" nav>
      <article className="g-doc">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.site.surfaces}</p>
          <h1 className="g-h1">{S.site.notFound(id)}</h1>
        </header>
        {problems.length > 0 && (
          <div className="g-problems">
            <strong>{S.intro.problems}</strong>
            <ul>
              {problems.map((problem) => (
                <li key={problem}>
                  <code>{problem}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
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
            {MODULES.list.map(({ module }) => {
              const named = text.module(module);
              return (
                <li key={module.id}>
                  <a href={moduleHref(BASE, state, module.id)}>
                    <strong>{named.title}</strong>
                    <span>{named.description}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </article>
    </Site>
  );
}
