/**
 * CONTRACT.md: the signature section — the "X first" principles that keep
 * self-evolution stable, rendered as a Markdown file inside a file-window card
 * with a copy button that yields the underlying Markdown verbatim.
 * High-level covenant only; implementation detail stays out of the landing page.
 */
import { S } from "../lib/strings";
import { Section } from "../components/section";
import { CopyButton } from "../components/copy-button";

/** The card rendered as real Markdown (what the copy button places on the clipboard). */
function contractMarkdown(): string {
  return [
    "# CONTRACT.md",
    "",
    `> ${S.contract.intro}`,
    "",
    ...S.contract.items.map((item) => `- **${item.term}** — ${item.text}`),
    "",
    `> ${S.contract.outro}`,
    "",
  ].join("\n");
}

export function Contract() {
  return (
    <Section
      id="contract"
      eyebrow={S.contract.eyebrow}
      title={S.contract.title}
      subtitle={S.contract.subtitle}
    >
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {/* File chrome */}
        <div className="flex items-center gap-3 border-b border-gray-200 py-2 pr-2.5 pl-4 dark:border-gray-800">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            CONTRACT.md
          </span>
          <CopyButton text={contractMarkdown()} />
        </div>

        {/* Markdown-flavored body */}
        <div className="px-5 py-6 font-mono text-[13px] leading-7 sm:px-8">
          <p className="text-gray-400 dark:text-gray-500">
            <span className="text-brand-600 dark:text-brand-300"># </span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">CONTRACT.md</span>
          </p>
          <p className="mt-3 border-l-2 border-gray-200 pl-3 text-gray-500 italic dark:border-gray-700 dark:text-gray-400">
            <span className="mr-1 text-gray-300 select-none dark:text-gray-600">&gt;</span>
            {S.contract.intro}
          </p>
          <ul className="mt-5 space-y-3">
            {S.contract.items.map((item) => (
              <li key={item.term} className="flex gap-2.5">
                <span className="text-brand-600 select-none dark:text-brand-300" aria-hidden="true">
                  -
                </span>
                <p className="text-gray-600 dark:text-gray-400">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    **{item.term}**
                  </span>
                  <span className="mx-1.5 text-gray-300 dark:text-gray-600">—</span>
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-gray-400 italic dark:text-gray-500">
            <span className="mr-1 select-none">&gt;</span>
            {S.contract.outro}
          </p>
        </div>
      </div>
    </Section>
  );
}
