/**
 * `/` — the gallery: the rail beside one long page of the fifteen modules in `MODULE_IDS` order,
 * opened by a title and one sentence.
 */
import { useEffect, useRef } from "react";
import { ModuleSection } from "../chrome/section";
import { Rail } from "../chrome/rail";
import { useScrollSpy } from "../lib/use-scroll-spy";
import { DEMOS, MODULES } from "../registry";
import { useGallery } from "../state";

const IDS = MODULES.list.map(({ module }) => module.id);
const PROBLEMS = [...MODULES.problems, ...DEMOS.problems];

export function GalleryPage() {
  const { S, state, tokens } = useGallery();
  const active = useScrollSpy(IDS);
  const scrolled = useRef(false);

  // The hash target moves while previews fill in (token-driven layout, compare frames reporting
  // their heights), so jump once the tokens have resolved and keep the target pinned while the
  // page above it keeps resizing — until the reader scrolls or a few seconds pass.
  useEffect(() => {
    if (scrolled.current || !tokens) return;
    scrolled.current = true;
    const id = decodeURIComponent(window.location.hash.slice(1));
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
  }, [tokens]);

  return (
    <div className="g-app">
      <div className="g-frame" data-wide={state.compare !== false || undefined}>
        <Rail activeId={active} />
        <main className="g-main">
          <header className="g-intro g-chrome">
            <h1>{S.intro.title}</h1>
            <p>{S.intro.body}</p>
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
          </header>
          {MODULES.list.map((entry) => (
            <ModuleSection
              key={entry.module.id}
              entry={entry}
              pickKey={state.variants[entry.module.id]}
            />
          ))}
        </main>
      </div>
    </div>
  );
}
