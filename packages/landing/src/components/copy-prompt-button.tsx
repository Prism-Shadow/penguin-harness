/**
 * Copies the prompt that hands AMSP to a coding agent: read the Agent API guide, then write code
 * with the SDK. The hero and the run section share it, so the words and the mechanism are one. The
 * button shows a check for a moment after a copy, and a screen reader hears that it was copied.
 */
import { useEffect, useState } from "react";
import { CheckIcon, TerminalIcon, writeSiteClipboard } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { DOCS_URL } from "../lib/links";

/** How long the button shows its check after a copy. */
const COPIED_MS = 2000;

export function CopyPromptButton({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    // The prompt is read by a coding agent elsewhere, so the guide's address must be absolute.
    const guide = new URL(`${DOCS_URL}agent-api/`, window.location.origin).href;
    if (await writeSiteClipboard(S.amsp.agentPrompt(guide))) setCopied(true);
  };

  const size = compact ? "h-8 px-3 text-xs font-semibold" : "h-11 px-5 text-[15px] font-medium";
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white whitespace-nowrap text-gray-900 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 ${size}`}
      >
        {copied ? (
          <CheckIcon className="site-copy-done h-4 w-4" />
        ) : (
          <TerminalIcon className="h-4 w-4" />
        )}
        {S.amsp.copyPrompt}
      </button>
      <span role="status" className="sr-only">
        {copied ? S.amsp.copied : ""}
      </span>
    </>
  );
}
