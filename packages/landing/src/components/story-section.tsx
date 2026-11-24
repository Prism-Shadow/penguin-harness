import type { ReactNode } from "react";
import { ArrowUpRightIcon } from "./icons";

/** A shared reading order for a homepage story, its example and the action a visitor can take. */
export function StorySection({
  id,
  title,
  intro,
  action,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="section-anchor mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20"
    >
      <header className="mb-6 grid gap-y-4 border-t border-gray-300 pt-6 sm:mb-9 sm:pt-8 lg:grid-cols-[1fr_minmax(0,0.84fr)] lg:gap-x-14 dark:border-gray-700">
        <h2
          id={`${id}-heading`}
          className="max-w-[22ch] text-3xl leading-tight font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-5xl"
        >
          {title}
        </h2>
        <div className="max-w-prose">
          <p className="text-base leading-7 text-pretty text-gray-700 sm:text-lg dark:text-gray-300">
            {intro}
          </p>
          <div className="story-action mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
            {action}
            <ArrowUpRightIcon className="size-4 shrink-0" />
          </div>
        </div>
      </header>
      {children}
    </section>
  );
}
