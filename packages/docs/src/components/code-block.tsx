/**
 * Fenced code block: the same surface for every block, holding either Shiki's highlighted
 * markup or a plain <pre> fallback. The fallback is what renders first (and forever, for
 * a language with no grammar), so a block is readable before the highlighter chunk lands
 * and stays readable if it never does.
 *
 * The two states carry identical padding and type, so the swap on highlight does not
 * reflow the page.
 */
import { useEffect, useState } from "react";
import { highlight, isHighlightable } from "../lib/highlight";

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!isHighlightable(language)) {
      setHtml(null);
      return;
    }
    let alive = true;
    void highlight(code, language).then((result) => {
      if (alive) setHtml(result);
    });
    return () => {
      alive = false;
    };
  }, [code, language]);

  return (
    <div className="md-code">
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
