/**
 * Deployment scenarios as an auto-cycling stacked deck: the front card holds for
 * ROTATE_MS, then swaps with the card peeking out behind it (both live in one grid
 * cell, so the container takes the tallest card's height and nothing jumps).
 * Hovering the deck pauses the timer — nobody loses their place mid-read — and the
 * dots switch manually. The hidden card is inert, so neither Tab nor a screen
 * reader lands inside it; prefers-reduced-motion disables auto-advance entirely.
 * SHOTS is index-aligned with S.scenarios.items; the photos are theme-agnostic,
 * so a single asset serves light and dark (unlike the Cases screenshots).
 */
import { useEffect, useState } from "react";
import { S } from "../lib/strings";
import { Section } from "../components/section";
import medicalShot from "../assets/case-medical-qc.webp";
import lineShot from "../assets/case-line-inspection.webp";

const SHOTS = [medicalShot, lineShot];
const ROTATE_MS = 6000;

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
        className="mx-auto max-w-4xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* pt-5 gives the back card's peeking top edge room inside the wrapper */}
        <div className="grid pt-5">
          {items.map((c, i) => {
            const front = i === active;
            return (
              <figure
                key={c.title}
                inert={!front}
                className={`col-start-1 row-start-1 overflow-hidden rounded-2xl border bg-white transition-all duration-500 dark:bg-gray-900 ${
                  front
                    ? "z-10 border-gray-200 opacity-100 dark:border-gray-800"
                    : "z-0 -translate-y-5 scale-[0.955] border-gray-200/70 opacity-60 dark:border-gray-800/70"
                }`}
              >
                <div className="md:flex md:items-stretch">
                  <img
                    src={SHOTS[i]}
                    alt={c.alt}
                    loading="lazy"
                    className="aspect-[16/9] w-full object-cover md:aspect-auto md:w-[44%]"
                  />
                  <figcaption className="p-6 md:flex md:flex-1 md:flex-col md:justify-center md:p-8">
                    <h3 className="text-lg font-semibold">{c.title}</h3>
                    <p className="mt-2.5 text-sm leading-6 text-gray-600 dark:text-gray-400">
                      {c.body}
                    </p>
                    <dl className="mt-5 flex gap-10">
                      {c.metrics.map((m) => (
                        <div key={m.label}>
                          <dd className="text-xl font-semibold tracking-tight text-brand-700 dark:text-brand-300">
                            {m.value}
                          </dd>
                          <dt className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            {m.label}
                          </dt>
                        </div>
                      ))}
                    </dl>
                  </figcaption>
                </div>
              </figure>
            );
          })}
        </div>

        {/* Manual switch doubles as the position indicator */}
        <div className="mt-5 flex justify-center gap-2">
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
