/**
 * The ticket file, field by field: an example at the moment its question is open, then one table per part
 * of it (the frontmatter, the prose sections, and the person's own triage, which is kept per
 * person and never written to the file), each row a field's name and type, whether it is required,
 * who writes it, what it means, and whether the shipped company mode has it. Under them, the rule
 * that reads "waiting on you" from the fields. The catalogue is lib/company-spec.ts, the words the
 * dictionaries' `company.ticket`. A table from `md` up; on a phone each field stacks.
 */
import { highlightSiteCode, SiteCodeBlock } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { FRONTMATTER_FIELDS, SECTION_FIELDS, TRIAGE_FIELDS } from "../../lib/company-spec";
import type { FieldDoc, FieldPath, Wait } from "../../lib/company-spec";
import { Section } from "../../components/section";

const GROUPS = [
  { id: "frontmatter", fields: FRONTMATTER_FIELDS },
  { id: "sections", fields: SECTION_FIELDS },
  { id: "triage", fields: TRIAGE_FIELDS },
] as const;

/** When a ticket waits on a person, as the fields say it: language-neutral, like the fields. */
const WAITS: readonly { wait: Wait; when: string }[] = [
  { wait: "accept", when: "status: proposed" },
  { wait: "answer", when: "status: in_progress, blocked_by: user:<id>" },
  { wait: "review", when: "status: review" },
];

const LABEL = "text-xs font-semibold text-gray-500 dark:text-gray-400";
const TH =
  "border-b border-gray-200 py-2 pr-4 text-left text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400";
const TD = "border-b border-gray-200 py-2 pr-4 align-top dark:border-gray-800";
const STRONG = "font-medium text-gray-900 dark:text-gray-100";
const QUIET = "text-gray-500 dark:text-gray-400";

export function CompanyTicket() {
  const T = S.company.ticket;
  return (
    <Section id="ticket" title={T.title} subtitle={T.subtitle}>
      <div className="mx-auto max-w-5xl">
        <h3 className={LABEL}>{T.example}</h3>
        <div className="amsp-code mt-2 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
          <SiteCodeBlock code={T.exampleFile} language="markdown" highlight={highlightSiteCode} />
        </div>

        {GROUPS.map((group) => (
          <div key={group.id} className="mt-10">
            <h3 className={LABEL}>{T.groups[group.id]}</h3>
            <FieldTable fields={group.fields} />
          </div>
        ))}

        <div className="mt-12 max-w-3xl">
          <h3 className="text-xl font-semibold tracking-tight">{T.waitTitle}</h3>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{T.waitText}</p>
          <dl className="mt-4 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {WAITS.map(({ wait, when }) => (
              <div
                key={wait}
                className="grid gap-x-4 gap-y-0.5 py-2.5 text-sm leading-6 sm:grid-cols-[10rem_minmax(0,1fr)]"
              >
                <dt className={STRONG}>{T.waits[wait]}</dt>
                <dd className="font-mono text-xs leading-6 text-gray-600 dark:text-gray-300">
                  {when}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  );
}

function FieldTable({ fields }: { fields: readonly FieldDoc<FieldPath>[] }) {
  const T = S.company.ticket;
  const meaningOf = (field: FieldDoc<FieldPath>) => T.fields[field.path];
  const writersOf = (field: FieldDoc) =>
    field.writers.map((writer) => T.writers[writer]).join(T.join);
  return (
    <>
      <table className="mt-2 hidden w-full table-fixed text-sm leading-6 md:table">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[9%]" />
          <col className="w-[14%]" />
          <col />
          <col className="w-[9%]" />
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>{T.head.field}</th>
            <th className={TH}>{T.head.required}</th>
            <th className={TH}>{T.head.writers}</th>
            <th className={TH}>{T.head.meaning}</th>
            <th className={`${TH} pr-0`}>{T.head.state}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.path}>
              <td className={`${TD} font-mono text-xs break-words`}>
                <span className={STRONG}>{field.path}</span>
                <span className={`block ${QUIET}`}>{field.type}</span>
              </td>
              <td className={`${TD} text-xs`}>
                <Mark strong={field.required}>{field.required ? T.required : T.optional}</Mark>
              </td>
              <td className={`${TD} text-xs text-gray-600 dark:text-gray-300`}>
                {writersOf(field)}
              </td>
              <td className={`${TD} text-gray-600 dark:text-gray-300`}>{meaningOf(field)}</td>
              <td className={`${TD} pr-0 text-xs`}>
                <Mark strong={field.isNew}>{field.isNew ? T.added : T.shipped}</Mark>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-2 divide-y divide-gray-200 border-y border-gray-200 md:hidden dark:divide-gray-800 dark:border-gray-800">
        {fields.map((field) => (
          <li key={field.path} className="py-2.5 text-sm leading-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className={`font-mono text-xs break-all ${STRONG}`}>{field.path}</span>
              <span className="text-xs">
                <Mark strong={field.isNew}>{field.isNew ? T.added : T.shipped}</Mark>
              </span>
            </div>
            <p className={`font-mono text-xs break-words ${QUIET}`}>{field.type}</p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-300">{meaningOf(field)}</p>
            <p className={`mt-0.5 text-xs ${QUIET}`}>
              {field.required ? T.required : T.optional}
              {T.join}
              {writersOf(field)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A yes in dark ink, a no in gray: the weight carries it, the word says it. */
function Mark({ strong, children }: { strong: boolean; children: string }) {
  return <span className={strong ? STRONG : QUIET}>{children}</span>;
}
