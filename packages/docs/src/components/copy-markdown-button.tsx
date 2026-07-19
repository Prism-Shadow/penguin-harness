/**
 * "Copy Markdown" button: puts the page's Markdown source on the clipboard with a
 * transient "copied" state — so a page can be pasted into a model context, an issue
 * or a note as clean Markdown rather than rendered HTML.
 */
import { useEffect, useRef, useState } from "react";
import { S } from "../lib/strings";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context): fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={copied ? S.doc.copied : S.doc.copyMarkdown}
      aria-label={copied ? S.doc.copied : S.doc.copyMarkdown}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      <span>{copied ? S.doc.copied : S.doc.copyMarkdown}</span>
    </button>
  );
}
