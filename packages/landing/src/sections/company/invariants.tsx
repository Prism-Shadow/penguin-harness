/**
 * What the server enforces, as numbered ruled rows (the gallery's company/spec.ts `INVARIANTS`): the rule in
 * one sentence, what it means for a caller, the answer a refused write gets, and whether the
 * shipped company mode already enforces it. Everything else a company does is guidance in Skills
 * and the handbook, which an agent may not follow; these are the lines an implementation is tested
 * against.
 */
import { S } from "../../lib/strings";
import { INVARIANTS } from "../../../../ui-gallery/src/company/spec";
import { Section } from "../../components/section";

export function CompanyInvariants() {
  const I = S.company.invariants;
  return (
    <Section id="invariants" title={I.title} subtitle={I.subtitle}>
      <ol className="mx-auto max-w-3xl divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {INVARIANTS.map((invariant, i) => {
          const words = I.items[invariant.id];
          return (
            <li
              key={invariant.id}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 py-4 text-sm leading-6"
            >
              <span className="text-gray-500 tabular-nums dark:text-gray-400">{i + 1}</span>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{words.rule}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{words.text}</p>
                {invariant.refusal !== null && (
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {I.refusal}
                    <code className="font-mono text-gray-700 dark:text-gray-300">
                      {invariant.refusal}
                    </code>
                  </p>
                )}
              </div>
              <span
                className={`text-xs leading-6 whitespace-nowrap ${
                  invariant.isNew
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {invariant.isNew ? I.added : I.shipped}
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
