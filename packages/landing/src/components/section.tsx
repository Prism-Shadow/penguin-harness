/** Shared section shell: anchor id + centered header (eyebrow / title / subtitle) + content. */
import type { ReactNode } from "react";
import { useReveal } from "../lib/reveal";

export function Section({
  id,
  eyebrow,
  title,
  subtitle,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  /** A list renders one line per entry (deliberate breaks, e.g. the 1×/100× pair); a string wraps naturally. */
  subtitle?: string | readonly string[];
  children: ReactNode;
  className?: string;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`px-4 py-16 sm:px-6 sm:py-24 ${className}`}>
      <div id={id} className={`mx-auto max-w-6xl ${id ? "section-anchor" : ""}`}>
        {(eyebrow || title || subtitle) && (
          <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-14">
            {eyebrow && (
              <p className="mb-2 text-sm font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-300">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-4 text-base leading-7 text-pretty text-gray-600 dark:text-gray-400">
                {typeof subtitle === "string"
                  ? subtitle
                  : subtitle.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
