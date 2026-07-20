/**
 * LangChain comparison: the 1x/100x story as a two-card visual — hand-built
 * agents at 1x on the left (de-emphasized), agents building agents at 100x on
 * the right (brand-emphasized). The subtitle carries the story sentence itself.
 */
import { S } from "../lib/strings";
import { Section } from "../components/section";

function CompareCard({
  name,
  speed,
  mode,
  note,
  emphasized = false,
}: {
  name: string;
  speed: string;
  mode: string;
  note: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-6 text-center sm:p-8 ${
        emphasized
          ? "border-brand-300 bg-brand-25 dark:border-brand-800 dark:bg-brand-950/40"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      }`}
    >
      <p
        className={`text-sm font-semibold tracking-tight ${
          emphasized ? "text-brand-700 dark:text-brand-300" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {name}
      </p>
      <p
        className={`mt-3 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl ${
          emphasized ? "text-brand-600 dark:text-brand-300" : "text-gray-400 dark:text-gray-600"
        }`}
      >
        {speed}
      </p>
      <p className="mt-3 text-[15px] font-medium text-gray-900 dark:text-gray-100">{mode}</p>
      <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{note}</p>
    </article>
  );
}

export function Compare() {
  return (
    <Section
      id="compare"
      eyebrow={S.compare.eyebrow}
      title={S.compare.title}
      subtitle={S.compare.subtitle}
    >
      <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-2">
        <CompareCard {...S.compare.langchain} />
        <CompareCard {...S.compare.penguin} emphasized />
      </div>
    </Section>
  );
}
