/**
 * `SiteCodeCard`, a terminal-style card for a short command: a label and a copy button over a
 * monospace body whose `#` comment lines read muted. Its look is site-content.css's.
 *
 * A module of its own, apart from the article's code block (site-code.tsx): a bundler splits by
 * module, so a page that shows a command card would otherwise carry the block and its table of
 * grammar loaders in its first chunk.
 */
import { SiteCopyButton } from "./site-copy";
import { TerminalIcon } from "./site-icons";

/** No highlighter: the card holds short shell commands, where the muted comments are enough. */
export function SiteCodeCard({
  code,
  label = "shell",
  copy,
  className = "",
}: {
  code: string;
  label?: string;
  /** The copy button's label, and what a screen reader hears once the command is copied. */
  copy: { label: string; announcement: string };
  className?: string;
}) {
  const lines = code.split("\n");
  return (
    <div className={`site-code-card ${className}`}>
      <div className="site-code-card-head flex items-center justify-between gap-2 px-3 py-2">
        <span className="site-code-card-label inline-flex min-w-0 items-center gap-1.5 text-xs">
          <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{label}</span>
        </span>
        <SiteCopyButton text={code} label={copy.label} announcement={copy.announcement} />
      </div>
      <pre className="site-code-card-body overflow-x-auto px-4 py-3">
        <code>
          {lines.map((line, i) => (
            <span
              key={i}
              className="site-code-card-line block whitespace-pre"
              data-comment={line.trimStart().startsWith("#") || undefined}
            >
              {line.length > 0 ? line : " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
