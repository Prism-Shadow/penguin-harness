/**
 * A deliberately tiny Markdown renderer for the screen mock-ups: paragraphs, `-` lists, pipe
 * tables, fenced code, `**bold**`, `` `code` `` and bare links — exactly what the fixtures
 * write, styled with token utilities after the web app's `.md-body` rules. The real renderer
 * (`Prose`, react-markdown + Shiki) moves into the package in W5 and replaces this.
 */
import type { ReactNode } from "react";
import { Glyph } from "./glyph";
import { NEUTRAL_FILL } from "./parts";

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; lang: string; text: string };

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function parse(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i += 1;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(cells(lines[i++]!));
      const [head = [], , ...body] = rows;
      blocks.push({ kind: "table", head, rows: body });
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) items.push(lines[i++]!.slice(2));
      blocks.push({ kind: "ul", items });
    } else if (line.trim() === "") {
      i += 1;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && !/^(```|\||- )/.test(lines[i]!)) {
        para.push(lines[i++]!);
      }
      blocks.push({ kind: "p", text: para.join(" ") });
    }
  }
  return blocks;
}

/** The inline runs the renderer styles — bold, code, a bare link — as one capture group. */
export const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)）]+[^\s)）.,。，;；:：])/g;

/** A line of text with its inline runs styled; a streamed reply renders each chunk through it. */
export function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-(--ui-weight-strong) text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code
          key={i}
          className={`rounded-sm px-1 py-0.5 font-mono text-[0.85em] text-fg ${NEUTRAL_FILL}`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          onClick={(e) => e.preventDefault()}
          className="text-link underline decoration-current/40 underline-offset-2 [overflow-wrap:anywhere] hover:text-link-hover"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

/** A fenced code block: the app's language header with a copy mark, then the code. */
export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  return (
    <div className="ui-frame my-2 overflow-hidden rounded-lg border border-line">
      <div
        data-slot="head"
        className="flex items-center justify-between border-b border-line bg-surface-muted px-3 py-1"
      >
        <span className="font-mono text-xs lowercase text-fg-muted">{lang || "text"}</span>
        <span className="text-fg-subtle">
          <Glyph name="copy" size={13} />
        </span>
      </div>
      <pre
        data-slot="body"
        className="overflow-x-auto bg-[var(--ui-code-bg)] px-3 py-2.5 font-mono text-[length:var(--ui-text-code-size)] leading-relaxed text-fg"
      >
        {text}
      </pre>
    </div>
  );
}

/**
 * `size`: `base` is the transcript's assistant prose; `sm` is a disclosure body (thinking) and
 * the dock's narrower panels. Prose is reading text, so it takes the reading face (`font-sans`)
 * even where a theme sets its chrome in another.
 */
export function Markdown({
  text,
  size = "base",
  streaming = false,
}: {
  text: string;
  size?: "base" | "sm";
  streaming?: boolean;
}) {
  const blocks = parse(text);
  const body = size === "base" ? "text-base" : "text-sm";
  return (
    <div className={`${body} font-sans leading-relaxed text-fg [overflow-wrap:break-word]`}>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        const caret = streaming && last ? <StreamingCaret /> : null;
        switch (b.kind) {
          case "p":
            return (
              <p key={i} className="my-2 leading-[1.7] first:mt-0 last:mb-0">
                {inline(b.text)}
                {caret}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="my-2 list-disc pl-5 first:mt-0 last:mb-0">
                {b.items.map((item, j) => (
                  <li key={j} className="my-1">
                    {inline(item)}
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={i} className="my-2 overflow-x-auto first:mt-0 last:mb-0">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th
                          key={j}
                          className="border border-line bg-surface-muted px-2 py-1 text-left font-(--ui-weight-strong)"
                        >
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, j) => (
                          <td key={j} className="border border-line px-2 py-1 align-top">
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return <CodeBlock key={i} lang={b.lang} text={b.text} />;
        }
      })}
    </div>
  );
}

/** The live caret after streaming text. Console turns it into a stepped block via `.ui-live`. */
export function StreamingCaret() {
  return (
    <span
      aria-hidden
      data-live="caret"
      className="ui-live ml-0.5 inline-block animate-pulse text-fg-subtle"
    >
      ▌
    </span>
  );
}
