/**
 * The RFC index page: the repository's design RFCs (PRFCs), grouped by where each one stands —
 * landed, open, drafting — each row with its status and a link into the document, the English and
 * Chinese versions linking separately. The documents are read at build time; the page holds no
 * copy of them.
 */
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { useDocumentMeta } from "../lib/document-meta";
import { buildRfcIndex } from "../lib/rfcs";
import type { RfcEntry, RfcStatus } from "../lib/rfcs";
import { S } from "../lib/strings";

const documents = import.meta.glob("../../../../rfcs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const entries = buildRfcIndex(documents);

const GROUPS: readonly RfcStatus[] = ["landed", "open", "drafting"];

const statusLabel = (status: RfcStatus): string =>
  status === "landed" ? S.rfcs.statusLanded : status === "open" ? S.rfcs.statusOpen : S.rfcs.statusDrafting;

function RfcRow({ entry }: { entry: RfcEntry }) {
  const { locale } = useSiteLocale();
  const title = locale === "zh" ? (entry.titleZh ?? entry.title) : entry.title;
  const primary = locale === "zh" ? (entry.zh ?? entry.en) : (entry.en ?? entry.zh);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100 py-3 dark:border-gray-800">
      <span className="w-28 shrink-0 font-mono text-sm text-gray-500 dark:text-gray-400">
        {entry.number}
      </span>
      <span className="min-w-0 flex-1">
        {primary ? (
          <a
            href={primary.href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-gray-900 underline-offset-4 hover:underline dark:text-white"
          >
            {title}
          </a>
        ) : (
          <span className="font-medium text-gray-900 dark:text-white">{title}</span>
        )}
        {entry.openRevision && (
          <>
            {" · "}
            <a
              href={entry.openRevision.href}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-gray-500 underline-offset-4 hover:underline dark:text-gray-400"
            >
              {S.rfcs.openRevision}
            </a>
          </>
        )}
      </span>
      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {statusLabel(entry.status)}
      </span>
      {entry.en && (
        <a
          href={entry.en.href}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-gray-500 underline-offset-4 hover:underline dark:text-gray-400"
        >
          English
        </a>
      )}
      {entry.zh && (
        <a
          href={entry.zh.href}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-gray-500 underline-offset-4 hover:underline dark:text-gray-400"
        >
          中文
        </a>
      )}
    </li>
  );
}

export function RfcsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(`${S.rfcs.title} | ${S.siteName}`, S.rfcs.description);
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
          {S.rfcs.title}
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-pretty text-gray-600 dark:text-gray-400">
          {S.rfcs.description}
        </p>
        {GROUPS.filter((status) => entries.some((entry) => entry.status === status)).map(
          (status) => (
            <div key={status} className="mt-10">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {statusLabel(status)}
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                  {S.rfcs.count(entries.filter((entry) => entry.status === status).length)}
                </span>
              </h2>
              <ul className="mt-3">
                {entries
                  .filter((entry) => entry.status === status)
                  .map((entry) => (
                    <RfcRow key={entry.id} entry={entry} />
                  ))}
              </ul>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
