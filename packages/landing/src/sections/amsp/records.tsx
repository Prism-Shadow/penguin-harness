/**
 * Every record, field by field, one at a time: a selector grouped by family (the envelope, the
 * Session's `session_meta`, complete messages, their fragments, the Task and Request boundaries,
 * aborts, approvals and hooks, context and tools, then the control frames) and the chosen record's
 * detail — its envelope and whether the Trace stores it, what it is, an example with every field
 * filled in, and a table of its fields: name, type, required or optional, meaning, example value.
 * The catalogue is lib/amsp-records.ts, the families and frames lib/amsp-vocabulary.ts, the words
 * the dictionaries' `amsp.records`. The selector is a list from `md` up, its names in their
 * family's colour (lib/amsp-tones.ts, with its legend above the list), and a native select on a
 * phone, where the field table stacks.
 */
import { useId, useState } from "react";
import { highlightSiteCode, SiteCodeBlock } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { CONTROL_FRAMES, FAMILIES, kindEntry } from "../../lib/amsp-vocabulary";
import { exampleOf, RECORD_DOCS } from "../../lib/amsp-records";
import type { DocId, FieldDoc, RecordDoc } from "../../lib/amsp-records";
import { familyOf, TONES } from "../../lib/amsp-tones";
import type { FamilyTone } from "../../lib/amsp-tones";
import { Section } from "../../components/section";

type FrameId = (typeof CONTROL_FRAMES)[number]["id"];
type Choice = { doc: DocId } | { frame: FrameId };

/** The selector's groups, in order: each a family label and the choices under it. */
const GROUPS: { id: string; choices: Choice[] }[] = [
  { id: "envelope", choices: [{ doc: "envelope" }] },
  ...FAMILIES.map((family) => ({
    id: family.id,
    choices: family.records.map((entry) => ({ doc: entry.id as DocId })),
  })),
  { id: "control", choices: CONTROL_FRAMES.map((frame) => ({ frame: frame.id })) },
];

const keyOf = (choice: Choice) => ("doc" in choice ? choice.doc : `frame:${choice.frame}`);
const labelOf = (choice: Choice) =>
  "doc" in choice
    ? choice.doc
    : (CONTROL_FRAMES.find((frame) => frame.id === choice.frame)!.wire.split("\n")[0] ?? "");
const CHOICES = GROUPS.flatMap((group) => group.choices);

/** A choice's colours: its envelope's family, a fragment in the family's lighter ink. */
function toneOf(choice: Choice): { tone: FamilyTone; text: string } {
  if ("frame" in choice || choice.doc === "envelope") {
    return { tone: TONES.frame, text: TONES.frame.ink };
  }
  const tone = TONES[familyOf(kindEntry(choice.doc).envelope)];
  return { tone, text: choice.doc.startsWith("partial_") ? tone.soft : tone.ink };
}

/** An example value, shortened to the table's column. */
const EXAMPLE_CHARS = 40;
const shorten = (text: string) =>
  text.length > EXAMPLE_CHARS ? `${text.slice(0, EXAMPLE_CHARS - 1)}…` : text;

const CODE_BOX =
  "amsp-code overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900";

export function AmspRecords() {
  const R = S.amsp.records;
  const [chosen, setChosen] = useState<Choice>({ doc: "session_meta" });
  const detailId = useId();
  const current = keyOf(chosen);

  return (
    <Section id="records" title={R.title} subtitle={R.subtitle}>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <label className="md:hidden">
          <span className="sr-only">{R.choose}</span>
          <select
            value={current}
            onChange={(event) =>
              setChosen(CHOICES.find((choice) => keyOf(choice) === event.target.value)!)
            }
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm dark:border-gray-800 dark:bg-gray-950"
          >
            {GROUPS.map((group) => (
              <optgroup key={group.id} label={R.families[group.id as keyof typeof R.families]}>
                {group.choices.map((choice) => (
                  <option key={keyOf(choice)} value={keyOf(choice)}>
                    {labelOf(choice)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <nav aria-label={R.choose} className="hidden md:block">
          <p className="mb-3 flex gap-3 font-mono text-[11px]">
            <span className={TONES.model.soft}>model_msg</span>
            <span className={TONES.event.soft}>event_msg</span>
          </p>
          {GROUPS.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {R.families[group.id as keyof typeof R.families]}
              </p>
              <ul>
                {group.choices.map((choice) => {
                  const key = keyOf(choice);
                  const active = key === current;
                  const { tone, text } = toneOf(choice);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        aria-controls={detailId}
                        aria-current={active || undefined}
                        onClick={() => setChosen(choice)}
                        className={`-ml-2 w-full rounded-md border-l-2 px-2 py-px text-left font-mono text-[13px] leading-5 transition-opacity ${text} ${
                          active
                            ? `border-current font-semibold ${tone.ground || "bg-gray-100 dark:bg-gray-800"}`
                            : "border-transparent opacity-80 hover:opacity-100"
                        }`}
                      >
                        {labelOf(choice)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div id={detailId} className="min-w-0">
          {"doc" in chosen ? (
            <RecordDetail record={RECORD_DOCS[chosen.doc] as RecordDoc} />
          ) : (
            <FrameDetail id={chosen.frame} />
          )}
        </div>
      </div>
    </Section>
  );
}

function RecordDetail({ record }: { record: RecordDoc }) {
  const R = S.amsp.records;
  const words = R.items[record.id];
  const entry = record.id === "envelope" ? null : kindEntry(record.id);
  const facts = entry
    ? [entry.stored ? R.stored : R.live, ...(record.id === "session_meta" ? [R.firstMessage] : [])]
    : [];
  const tone = entry ? TONES[familyOf(entry.envelope)] : null;
  return (
    <article>
      <h3 className="font-mono text-xl font-semibold tracking-tight">{record.id}</h3>
      {entry && tone && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span className={`rounded-sm px-1.5 font-mono leading-5 ${tone.ground} ${tone.ink}`}>
            type: {entry.envelope}
          </span>
          {facts.join(" · ")}
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{words.summary}</p>

      <h4 className="mt-6 text-xs font-semibold text-gray-500 dark:text-gray-400">{R.example}</h4>
      <div className={`mt-2 ${CODE_BOX}`}>
        <SiteCodeBlock
          code={JSON.stringify(record.example, null, 2)}
          language="json"
          highlight={highlightSiteCode}
        />
      </div>

      <h4 className="mt-6 text-xs font-semibold text-gray-500 dark:text-gray-400">
        {record.id === "envelope" ? R.envelopeFields : R.payloadFields}
      </h4>
      <FieldTable record={record} />
    </article>
  );
}

/** A field's meaning: the record's own words for it, else the meaning it has in every record. */
function meaningOf(record: RecordDoc, field: FieldDoc): string {
  const R = S.amsp.records;
  const own = R.items[record.id].fields as Record<string, string>;
  return own[field.path] ?? (R.common as Record<string, string>)[field.path] ?? "";
}

const TH =
  "border-b border-gray-200 py-2 pr-4 text-left text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400";
const TD = "border-b border-gray-200 py-2 pr-4 align-top dark:border-gray-800";

function FieldTable({ record }: { record: RecordDoc }) {
  const R = S.amsp.records;
  const rows = record.fields.map((field) => ({
    field,
    meaning: meaningOf(record, field),
    example: exampleOf(record, field),
  }));
  return (
    <>
      <table className="mt-2 hidden w-full table-fixed text-sm leading-6 md:table">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[20%]" />
          <col className="w-[10%]" />
          <col />
          <col className="w-[22%]" />
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>{R.head.field}</th>
            <th className={TH}>{R.head.type}</th>
            <th className={TH}>{R.head.required}</th>
            <th className={TH}>{R.head.meaning}</th>
            <th className={`${TH} pr-0`}>{R.head.example}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ field, meaning, example }) => (
            <tr key={field.path}>
              <td
                className={`${TD} font-mono text-[13px] break-words text-gray-900 dark:text-gray-100`}
              >
                {field.path}
              </td>
              <td
                className={`${TD} font-mono text-[12px] break-words text-gray-600 dark:text-gray-300`}
              >
                {field.type}
              </td>
              <td className={`${TD} text-xs`}>
                <Required required={field.required} />
              </td>
              <td className={`${TD} text-gray-600 dark:text-gray-300`}>{meaning}</td>
              <td
                className={`${TD} pr-0 font-mono text-[12px] break-words text-gray-600 dark:text-gray-300`}
              >
                {example === null ? "—" : shorten(example)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-2 divide-y divide-gray-200 border-y border-gray-200 md:hidden dark:divide-gray-800 dark:border-gray-800">
        {rows.map(({ field, meaning, example }) => (
          <li key={field.path} className="py-2.5 text-sm leading-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-mono text-[13px] font-medium break-all">{field.path}</span>
              <span className="text-xs">
                <Required required={field.required} />
              </span>
            </div>
            <p className="font-mono text-[12px] break-words text-gray-500 dark:text-gray-400">
              {field.type}
            </p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-300">{meaning}</p>
            {example !== null && (
              <p className="mt-0.5 font-mono text-[12px] break-all text-gray-500 dark:text-gray-400">
                {shorten(example)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Required({ required }: { required: boolean }) {
  const R = S.amsp.records;
  return required ? (
    <span className="font-medium text-gray-900 dark:text-gray-100">{R.required}</span>
  ) : (
    <span className="text-gray-500 dark:text-gray-400">{R.optional}</span>
  );
}

function FrameDetail({ id }: { id: FrameId }) {
  const R = S.amsp.records;
  const frame = CONTROL_FRAMES.find((candidate) => candidate.id === id)!;
  return (
    <article>
      <h3 className="font-mono text-xl font-semibold tracking-tight">
        {frame.wire.split("\n")[0]}
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{R.frame}</p>
      <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{R.frames[id]}</p>
      <h4 className="mt-6 text-xs font-semibold text-gray-500 dark:text-gray-400">{R.wire}</h4>
      <div className={`mt-2 ${CODE_BOX}`}>
        <SiteCodeBlock code={frame.wire} language="text" />
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{R.frameNote}</p>
    </article>
  );
}
