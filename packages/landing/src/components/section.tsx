/** Shared section shell: anchor id + centered header (title / subtitle) + content. */
import type { ReactNode } from "react";

export function Section({
  id,
  title,
  subtitle,
  children,
  className = "",
}: {
  id?: string;
  title?: string;
  /** A list renders one line per entry (deliberate breaks, e.g. the 1×/100× pair); a string wraps naturally. */
  subtitle?: string | readonly string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`px-4 py-16 sm:px-6 sm:py-24 ${className}`}>
      <div id={id} className={`mx-auto max-w-6xl ${id ? "section-anchor" : ""}`}>
        {(title || subtitle) && (
          <div className="mx-auto mb-10 max-w-4xl text-center sm:mb-14">
            {title && (
              // keep-all: a CJK heading breaks at its spaces and punctuation, never inside a word.
              <h2 className="text-3xl font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-4xl">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-pretty text-gray-600 dark:text-gray-400">
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
