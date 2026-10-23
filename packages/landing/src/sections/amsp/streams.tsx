/**
 * Where the stream flows: the two streams a reader opens, the two doors into the same handlers,
 * and the SDK's two readers, as three ruled groups of one-line rows, then the line that retires
 * v1. Routes and names come from lib/amsp-vocabulary.ts; the words from the dictionaries.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import {
  DOORS,
  KEY_HEADER,
  RETIRED,
  SDK_READERS,
  SDK_VERSION,
  STREAM_ROUTES,
} from "../../lib/amsp-vocabulary";
import { Section } from "../../components/section";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="border-b border-gray-200 pb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
        {title}
      </h3>
      <ul className="divide-y divide-gray-200 dark:divide-gray-800">{children}</ul>
    </div>
  );
}

function Row({
  name,
  code,
  text,
  mono = false,
}: {
  name: string;
  code: ReactNode;
  text: string;
  /** The name is an identifier (an SDK export), set as code. */
  mono?: boolean;
}) {
  return (
    <li className="grid gap-x-6 gap-y-1 py-3 text-sm leading-6 md:grid-cols-[10rem_minmax(0,1fr)]">
      <span className={`font-semibold text-gray-900 dark:text-gray-100 ${mono ? "font-mono" : ""}`}>
        {name}
      </span>
      <div className="min-w-0">
        <p className="text-gray-600 dark:text-gray-300">{text}</p>
        <div className="mt-1 font-mono text-[12.5px] leading-5 text-gray-500 dark:text-gray-400">
          {code}
        </div>
      </div>
    </li>
  );
}

const lines = (values: readonly string[]) =>
  values.map((value) => (
    <span key={value} className="block truncate whitespace-pre">
      {value}
    </span>
  ));

export function AmspStreams() {
  const T = S.amsp.streams;
  return (
    <Section id="streams" title={T.title} subtitle={T.subtitle}>
      <div className="mx-auto max-w-4xl space-y-10">
        <Group title={T.head.streams}>
          <Row
            name={T.streams.session.name}
            text={T.streams.session.text}
            code={STREAM_ROUTES.session}
          />
          <Row name={T.streams.user.name} text={T.streams.user.text} code={STREAM_ROUTES.user} />
        </Group>
        <Group title={T.head.doors}>
          {DOORS.map((door) => (
            <Row
              key={door.id}
              name={T.doors[door.id].name}
              text={T.doors[door.id].text}
              code={lines(door.id === "key" ? [KEY_HEADER, ...door.routes] : door.routes)}
            />
          ))}
        </Group>
        <Group title={T.head.sdk}>
          {SDK_READERS.map((reader) => (
            <Row
              key={reader}
              mono
              name={reader}
              text={T.sdk[reader]}
              code={`import { ${reader} } from "@prismshadow/amsp";`}
            />
          ))}
        </Group>
        <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
          {T.retired(RETIRED.prefix, RETIRED.code, SDK_VERSION)}
        </p>
      </div>
    </Section>
  );
}
