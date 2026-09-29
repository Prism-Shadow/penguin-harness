/**
 * `/c/<module>` — one module's page: the module list on the left, the content column — the
 * group's eyebrow, the title, the description, then a section per variant (chrome/variant.tsx)
 * and the Parts, Tokens and Source sections (chrome/sections.tsx) — and "on this page" on the
 * right, scroll-spied. `#<variant>` opens on a variant's section, `#parts` and the like on a
 * section after them, `#<part-id>` on a part inside Parts.
 */
import { useEffect, useRef } from "react";
import type { ModuleId } from "../../../ui/src/module";
import { PartsSection, SourceSection, TokensSection } from "../chrome/sections";
import { Site } from "../chrome/site";
import { OnThisPage } from "../chrome/toc";
import { VariantSection } from "../chrome/variant";
import { groupOf } from "../lib/groups";
import { BASE } from "../lib/location";
import type { CollectedModule } from "../lib/modules";
import { PAGE_SECTION_IDS } from "../lib/modules";
import { anchorOf, moduleHref } from "../lib/routes";
import { comparesModule } from "../lib/url-state";
import { useScrollSpy } from "../lib/use-scroll-spy";
import { useText } from "../preview";
import { MODULES } from "../registry";
import { useGallery } from "../state";

export function ModulePage({ id }: { id: ModuleId }) {
  const entry = MODULES.byId.get(id);
  return entry ? <ModuleDoc entry={entry} /> : <MissingModule id={id} />;
}

/**
 * The hash target moves while previews fill in (token-driven layout, framed embeds reporting
 * their heights), so jump once the tokens have resolved and keep the target pinned while the
 * page above it keeps resizing — until the reader scrolls or a few seconds pass.
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

/** The page's own previews, plus the active theme's copy inside every framed embed. */
function previewRoots(theme: string): Element[] {
  const inPage = Array.from(document.querySelectorAll(".g-main .g-preview[data-module]"));
  const framed = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      `.g-main iframe.g-embed-frame[data-theme="${theme}"]`,
    ),
  ).flatMap((frame) => {
    const root = frame.contentDocument?.getElementById("embed-root");
    return root ? [root] : [];
  });
  return [...inPage, ...framed];
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
  const compareOnPage =
    comparesModule(state, module.id) ||
    (typeof state.compare === "object" && state.compare.module === module.id);
  const toc = [
    ...module.variants.map((variant) => ({
      id: variant.key,
      title: text.variant(module, variant),
    })),
    { id: "parts", title: S.section.parts },
    { id: "tokens", title: S.section.tokens },
    { id: "source", title: S.section.source },
  ];
  const measureKey = [
    state.theme,
    mode,
    state.accent,
    state.lang,
    state.tier,
    state.view,
    JSON.stringify(state.compare),
  ].join("|");

  return (
    <Site
      page={module.id === "screens" ? "screens" : "components"}
      activeId={module.id}
      nav
      wide={compareOnPage}
      toc={<OnThisPage items={toc} activeId={active} />}
    >
      <article className="g-doc">
        <header className="g-doc-head">
          <p className="g-eyebrow">{text.group(groupOf(module.id))}</p>
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
          <VariantSection key={variant.key} entry={entry} variant={variant} />
        ))}
        <PartsSection module={module} />
        <TokensSection
          module={module}
          roots={() => previewRoots(state.theme)}
          measureKey={measureKey}
        />
        <SourceSection path={entry.path} />
      </article>
    </Site>
  );
}

/** A module id the registry skipped (its file reported a problem) or `/c/<nothing>`. */
export function MissingModule({ id }: { id: string }) {
  const { S, state } = useGallery();
  const text = useText();
  const problems = MODULES.problems.filter((problem) => problem.includes(id));
  return (
    <Site page="components" nav>
      <article className="g-doc">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.site.components}</p>
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
          <h2 className="g-h2">{S.site.allModules}</h2>
          <ul className="g-index">
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
