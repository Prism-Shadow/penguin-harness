/**
 * Deployment scenarios as an auto-cycling overlapped pair: the front card sits
 * left at 92% width, the other slides right so its strip peeks past the front
 * card's right edge, tucked underneath — on swap the two cross horizontally
 * (both live in one grid cell, so the container takes the tallest card's height
 * and nothing jumps). The front card holds for ROTATE_MS (long enough to actually
 * read the paragraph); hovering the deck pauses the timer — nobody loses their
 * place mid-read; clicking the peeking card (or a dot) switches manually. The
 * covered card is a pointer-only shortcut and stays aria-hidden — dots carry the
 * accessible switching — and prefers-reduced-motion disables auto-advance.
 * SHOTS is index-aligned with S.scenarios.items; the photos are theme-agnostic,
 * so a single asset serves light and dark (unlike the Cases screenshots).
 */
import { useEffect, useState } from "react";
import { S } from "../lib/strings";
import { Section } from "../components/section";
import medicalShot from "../assets/case-medical-qc.webp";
import lineShot from "../assets/case-line-inspection.webp";

const SHOTS = [medicalShot, lineShot];
const ROTATE_MS = 12000;

export function Scenarios() {
  const items = S.scenarios.items;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, items.length]);

  return (
    <Section
      id="scenarios"
      eyebrow={S.scenarios.eyebrow}
      title={S.scenarios.title}
      subtitle={S.scenarios.subtitle}
    >
      <div
        className="mx-auto max-w-5xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="grid">
          {items.map((c, i) => {
            const front = i === active;
            return (
              <figure
                key={c.title}
                aria-hidden={!front}
                // The peeking card is itself the switch target (its visible strip is
                // small, so the whole card surface accepts the click).
                onClick={front ? undefined : () => setActive(i)}
                // Cards are 92% wide in a shared cell: the front one holds the left
                // edge; the covered one shifts its own 8.7% (= the container's 8%)
                // so exactly that strip peeks past the front card's right edge.
                className={`col-start-1 row-start-1 w-[92%] overflow-hidden rounded-2xl border bg-white transition-all duration-500 dark:bg-gray-900 ${
                  front
                    ? "z-10 translate-x-0 border-gray-200 opacity-100 dark:border-gray-800"
                    : "z-0 translate-x-[8.7%] scale-[0.96] cursor-pointer border-gray-200/70 opacity-60 dark:border-gray-800/70"
                }`}
              >
                <div className="md:flex md:min-h-[340px] md:items-stretch">
                  <img
                    src={SHOTS[i]}
                    alt={c.alt}
                    loading="lazy"
                    className="aspect-[16/9] w-full object-cover md:aspect-auto md:w-[48%]"
                  />
                  <figcaption className="p-7 md:flex md:flex-1 md:flex-col md:justify-center md:p-12">
                    <h3 className="text-xl font-semibold sm:text-2xl">{c.title}</h3>
                    <p className="mt-4 text-[15px] leading-7 text-gray-600 dark:text-gray-400">
                      {c.body}
                    </p>
                  </figcaption>
                </div>
              </figure>
            );
          })}
        </div>

        {/* Manual switch doubles as the position indicator */}
        <div className="mt-6 flex justify-center gap-2">
          {items.map((c, i) => (
            <button
              key={c.title}
              type="button"
              aria-label={c.title}
              aria-current={i === active}
              onClick={() => setActive(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active
                  ? "w-6 bg-gray-800 dark:bg-gray-200"
                  : "w-3 bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-500"
              }`}
            />
          ))}
        </div>
      </div>
    </Section>
  );
}
