import { S } from "../../lib/strings";
import { Section } from "../../components/section";

export function CompanyQuestions() {
  const q = S.company.questions;
  return (
    <Section title={q.title} subtitle={q.subtitle}>
      <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        {q.items.map((item) => (
          <article key={item.question} className="rounded-xl bg-gray-50 p-6 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">{item.question}</p>
            <h3 className="mt-1 text-lg leading-snug font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word]">
              {item.answer}
            </h3>
            <p className="mt-2 text-sm leading-6 break-words text-gray-600 dark:text-gray-400">
              {item.body}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}
