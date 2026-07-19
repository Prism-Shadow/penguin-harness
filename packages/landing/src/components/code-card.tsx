/**
 * Terminal-style code card: rounded border, a slim header with a label + copy button,
 * and a monospace body. Comment lines (starting with #) render muted; no highlighter
 * dependency — landing snippets are short shell commands.
 */
import { TerminalIcon } from "./icons";
import { CopyButton } from "./copy-button";

export function CodeCard({
  code,
  label,
  className = "",
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const lines = code.split("\n");
  return (
    <div
      className={`overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{label ?? "shell"}</span>
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-6">
        <code>
          {lines.map((line, i) => {
            const isComment = line.trimStart().startsWith("#");
            return (
              <span
                key={i}
                className={`block whitespace-pre ${
                  isComment
                    ? "text-gray-400 dark:text-gray-500"
                    : "text-gray-800 dark:text-gray-200"
                }`}
              >
                {line.length > 0 ? line : " "}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
