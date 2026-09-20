/**
 * Markdown & code: what an answer is written in.
 *
 * - Prose: a docs answer — headings on the Markdown scale, a paragraph with a link and inline code,
 *   a list, a table, a quoted note, a formula;
 * - Code: `src/rag.ts` in a code block with its header, copy button and line numbers, and the
 *   command that runs it;
 * - Diff: the session's two changes as unified diffs;
 * - Log: the corpus clone's command log, with its exit status and duration.
 *
 * Static stand-ins for W5's `Prose`, `CodeBlock`, `InlineCode`, `DiffViewer` and W4's `LogView`.
 * Code is monochrome until W5 picks each theme's Shiki pair.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FileDiff, Fixtures, InlineFixture, ToolCallItem } from "../fixtures";
import { defineModule, viewFor } from "../module";
import { duration } from "../screens/format";
import { CodeBlock, GlyphIcon, IconButton } from "./parts";

function InlineText({ parts }: { parts: readonly InlineFixture[] }) {
  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : "code" in part ? (
          <code
            key={i}
            className="rounded-sm bg-surface-muted px-1 py-0.5 font-mono text-[0.85em] text-fg"
          >
            {part.code}
          </code>
        ) : (
          <span key={i} className="text-link underline decoration-current/40 underline-offset-2">
            {part.link}
          </span>
        ),
      )}
    </>
  );
}

function Prose({ f }: { f: Fixtures }) {
  const d = f.docsAnswer;
  const h = "text-fg font-(--ui-weight-strong)";
  return (
    <article className="mx-auto grid max-w-2xl gap-4 text-(length:--ui-text-prose-size) leading-(--ui-text-prose-lh) text-fg">
      <h1 className={`text-(length:--ui-md-h1-size) leading-snug ${h}`}>{d.title}</h1>
      <p>
        <InlineText parts={d.intro} />
      </p>
      <h2 className={`pt-2 text-(length:--ui-md-h2-size) leading-snug ${h}`}>{d.scopesTitle}</h2>
      <ul className="grid grid-cols-[minmax(0,1fr)] list-disc gap-1 pl-5">
        {d.scopes.map((scope, i) => (
          <li key={i}>
            <InlineText parts={scope} />
          </li>
        ))}
      </ul>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {d.table.head.map((cell) => (
              <th
                key={cell}
                className="border border-line bg-surface-muted px-3 py-1.5 text-left font-(--ui-weight-strong)"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`border border-line px-3 py-1.5 ${i === 0 ? "font-mono text-xs" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <blockquote className="border-l-2 border-line-emphasis pl-4 text-fg-muted">
        <InlineText parts={d.note} />
      </blockquote>
      <h3 className={`pt-2 text-(length:--ui-md-h3-size) leading-snug ${h}`}>{d.rankingTitle}</h3>
      <p>{d.ranking}</p>
      <p className="overflow-x-auto text-center font-mono text-sm text-fg">{d.formula}</p>
    </article>
  );
}

function Code({ f }: { f: Fixtures }) {
  const copy = f.copy.common.copy;
  const source = f.filePreview.content.split("\n").slice(0, 24).join("\n");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <CodeBlock
        lang={f.filePreview.language}
        path={f.filePreview.path}
        code={source}
        copy={copy}
        numbered
      />
      <CodeBlock lang="bash" code={f.session.runCommand} copy={copy} />
    </div>
  );
}

/** A unified diff: the file and its counts, then hunk headers and numbered old/new lines. */
function DiffViewer({ diff, limit }: { diff: FileDiff; limit?: number }) {
  return (
    <section className="ui-frame overflow-hidden rounded-md border border-line font-mono text-xs leading-5">
      <div
        data-slot="head"
        className="flex items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 py-1 text-fg-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <GlyphIcon name="file" size={12} />
          <span className="min-w-0 truncate">{diff.path}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span className="text-tone-success-fg">+{diff.added}</span>
          <span className="text-tone-danger-fg">−{diff.removed}</span>
        </span>
      </div>
      <div data-slot="body" className="overflow-x-auto bg-[var(--ui-code-bg)]">
        {diff.hunks.map((hunk) => (
          <div key={hunk.header}>
            <div className="bg-[var(--ui-diff-hunk-bg)] px-3 text-fg-subtle">{hunk.header}</div>
            {hunk.lines.slice(0, limit).map((line, i) => (
              <div
                key={i}
                className={`flex whitespace-pre ${
                  line.kind === "add"
                    ? "bg-[var(--ui-diff-add-bg)]"
                    : line.kind === "del"
                      ? "bg-[var(--ui-diff-del-bg)]"
                      : ""
                }`}
              >
                <span className="w-9 shrink-0 select-none pr-1.5 text-right text-[var(--ui-code-gutter)]">
                  {line.oldNo ?? ""}
                </span>
                <span className="w-9 shrink-0 select-none pr-1.5 text-right text-[var(--ui-code-gutter)]">
                  {line.newNo ?? ""}
                </span>
                <span
                  className={`w-4 shrink-0 select-none text-center ${
                    line.kind === "add"
                      ? "text-tone-success-fg"
                      : line.kind === "del"
                        ? "text-tone-danger-fg"
                        : "text-fg-subtle"
                  }`}
                >
                  {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                </span>
                <span className="pr-3 text-fg">{line.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Diff({ f }: { f: Fixtures }) {
  const calls = f.session.turns[1]!.items.filter(
    (i): i is ToolCallItem & { diff: FileDiff } => i.kind === "tool_call" && i.diff !== undefined,
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {calls.map((call, i) => (
        <DiffViewer key={call.id} diff={call.diff} limit={i === 0 ? undefined : 12} />
      ))}
    </div>
  );
}

/** A command log: the command in its head, the output, and the exit status in its foot. */
function LogView({ command, output, foot }: { command: string; output: string; foot: ReactNode }) {
  return (
    <section className="ui-frame overflow-hidden rounded-md border border-line font-mono text-xs">
      <div
        data-slot="head"
        className="flex items-center gap-2 border-b border-line bg-surface-muted px-3 py-1.5 text-fg-muted"
      >
        <GlyphIcon name="terminal" size={13} />
        <span className="min-w-0 truncate text-fg">{command.split("\n")[0]}</span>
      </div>
      <pre
        data-slot="body"
        className="overflow-x-auto whitespace-pre bg-[var(--ui-code-bg)] px-3 py-2 leading-5 text-fg-muted"
      >
        {output}
      </pre>
      <div
        data-slot="foot"
        className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-fg-subtle"
      >
        {foot}
      </div>
    </section>
  );
}

function Log({ f }: { f: Fixtures }) {
  const c = f.copy.chat;
  // The corpus clone: an `exec_command`, so its arguments carry `cmd` and its output exists.
  const clone = f.session.turns[0]!.items.find(
    (i): i is ToolCallItem => i.kind === "tool_call" && i.name === "exec_command",
  );
  if (!clone) throw new Error("fixture: turn 1 has no exec_command to log");
  const { cmd } = JSON.parse(clone.argumentsJson) as { cmd: string };
  // The status is the call's own, never a green tick typed in: a failed call looks failed.
  const failed = clone.state === "failed";
  return (
    <LogView
      command={`$ ${cmd}`}
      output={clone.output!}
      foot={
        <>
          <GlyphIcon
            name={failed ? "circleCross" : "circleCheck"}
            size={13}
            className={failed ? "text-tone-danger-fg" : "text-tone-success-fg"}
          />
          <span className="tabular-nums">
            {c.exitStatus(failed ? 1 : 0, duration(clone.durationMs!))}
          </span>
          <span className="min-w-0 flex-1" />
          <span>{c.outputComplete}</span>
        </>
      }
    />
  );
}

const VARIANTS = { prose: Prose, code: Code, diff: Diff, log: Log } as const;

export const module = defineModule({
  id: "content",
  title: "Markdown & code",
  description:
    "A docs answer in Markdown — headings, links, inline code, a table, math and a quote — a code block, a unified diff and a command log.",
  width: "wide",
  variants: [
    { key: "prose", title: "Prose" },
    { key: "code", title: "Code" },
    { key: "diff", title: "Diff" },
    { key: "log", title: "Log" },
  ],
  parts: [
    "content-prose",
    "content-code-block",
    "content-typography",
    "content-diff-viewer",
    "data-log-view",
  ],
  render: (variant, { lang }) => {
    const View = viewFor(VARIANTS, variant);
    return <View f={fixturesFor(lang)} />;
  },
});
