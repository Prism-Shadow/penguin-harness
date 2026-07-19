/**
 * Code block (visual reference: better-chatbot's pre-block): top bar = language label + copy
 * button, body highlighted via Shiki — inline CSS variables for both the github-light /
 * github-dark themes, with dark mode switched via style overrides under html.dark (see
 * styles.css), so theme switching doesn't require re-highlighting.
 * Shiki is dynamically imported (its own chunk, loaded only once the first code block appears);
 * before loading completes and for unknown languages, it falls back to an unhighlighted <pre>.
 *
 * highlight=false (while a message is streaming) skips highlighting and falls back to plain
 * text: every streaming frame re-renders the full code with a growing length, and re-tokenizing
 * the whole block each time would be O(n^2) main-thread cost, and an in-progress highlight can't
 * be canceled; once streaming settles, highlight flips true and a single final highlight is done.
 */
import { useEffect, useState } from "react";
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import { GlyphIcon } from "../../components/ui/glyph-icon";

const COPIED_MS = 1500;

/** Copy button in the header bar (same visual style as MessageMeta's copy button; always visible — the header bar has no hover-gated container). */
function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <button
      type="button"
      title={copied ? S.common.copied : S.chat.copyCode}
      aria-label={S.chat.copyCode}
      onClick={copy}
      className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
    >
      <GlyphIcon d={copied ? STAT_ICONS.check : STAT_ICONS.copy} />
    </button>
  );
}

export function CodeBlock({
  language,
  code,
  highlight = true,
}: {
  language: string;
  code: string;
  highlight?: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!highlight) {
      setHtml(null);
      return;
    }
    let alive = true;
    void import("shiki")
      .then((shiki) =>
        shiki.codeToHtml(code, {
          lang: language || "text",
          themes: { light: "github-light", dark: "github-dark" },
        }),
      )
      .then((out) => {
        if (alive) setHtml(out);
      })
      .catch(() => {
        // Unknown language / failed to load: keep the unhighlighted fallback.
        if (alive) setHtml(null);
      });
    return () => {
      alive = false;
    };
  }, [code, language, highlight]);

  return (
    <div className="code-block my-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1 dark:border-gray-800 dark:bg-gray-900">
        <span className="font-mono text-xs lowercase text-gray-500 dark:text-gray-400">
          {language || "text"}
        </span>
        <CopyCodeButton code={code} />
      </div>
      <div className="overflow-x-auto bg-white text-[13px] leading-relaxed dark:bg-gray-950">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="m-0 px-3 py-2.5 font-mono text-gray-800 dark:text-gray-200">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
