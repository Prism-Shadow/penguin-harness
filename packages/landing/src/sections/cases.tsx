/** The requested legal workbench and cost of its sample reviews. */
import { AppGenerationDiagram } from "../components/application-diagrams";
import { S } from "../lib/strings";
import { Section } from "../components/section";

export function Cases() {
  const c = S.cases;

  return (
    <Section id="cases" title={c.os} subtitle={[c.a2app, c.subtitle]}>
      <AppGenerationDiagram />
      <figure className="mx-auto max-w-5xl">
        <div className="mx-auto mb-5 w-full max-w-4xl rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-left dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm leading-6 whitespace-pre-wrap text-gray-800 dark:text-gray-200">
            {c.prompt}
          </p>
        </div>
        <figcaption className="mt-3 text-center text-sm text-gray-600 dark:text-gray-400">
          {c.cost}
        </figcaption>
      </figure>
    </Section>
  );
}
