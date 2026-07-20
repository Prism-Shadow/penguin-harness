/** Closing call-to-action: the productivity-engine pitch + install / docs buttons. */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { DOCS_URL } from "../lib/links";
import { Section } from "../components/section";
import { ArrowRightIcon } from "../components/icons";

export function Cta() {
  return (
    <Section>
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-gray-50/60 px-6 py-12 text-center sm:px-12 dark:border-gray-800 dark:bg-gray-900/40">
        <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {S.cta.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-pretty text-gray-600 dark:text-gray-400">
          {S.cta.subtitle}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/#quickstart"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {S.cta.install}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <a
            href={DOCS_URL}
            className="inline-flex h-11 items-center rounded-lg border border-gray-200 bg-white px-5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            {S.cta.docs}
          </a>
        </div>
      </div>
    </Section>
  );
}
