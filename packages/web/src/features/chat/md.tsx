/**
 * Markdown body memoized by text identity. The stream model mutates chat items in place and
 * only reassigns `text` when a delta arrives, so every settled message keeps the same string
 * instance across the per-frame version bumps — the shallow prop compare then skips its entire
 * micromark → mdast → React re-parse, and only the actively-streaming message re-renders.
 * Without this, each animation frame during a stream re-parsed the WHOLE transcript (O(n²)
 * over a long reply), which visibly froze the UI while large code blocks streamed in.
 *
 * Fenced code blocks render through CodeBlock (language chrome + copy button + Shiki
 * highlight). `streaming` disables highlighting while deltas are still arriving —
 * re-tokenizing a growing block every frame is O(n²) main-thread cost — and the settle
 * re-render (new string instance, streaming=false) highlights each block exactly once.
 * Inline code keeps the default rendering (`.md-body code` styling).
 */
import { isValidElement, memo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";

/** Flatten a react-markdown code element's children to plain text (string or string array in practice). */
function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
  return "";
}

/** Fenced-block adapter: unwraps the <pre><code class="language-x"> pair react-markdown emits into CodeBlock. */
function MdPre({ children, streaming }: { children?: ReactNode; streaming: boolean }) {
  if (isValidElement(children)) {
    const props = children.props as { className?: string; children?: unknown };
    const language = /language-([\w+-]+)/.exec(props.className ?? "")?.[1] ?? "";
    return (
      <CodeBlock
        language={language}
        code={codeText(props.children).replace(/\n$/, "")}
        highlight={!streaming}
      />
    );
  }
  return <pre>{children}</pre>;
}

export const Md = memo(function Md({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ pre: (p) => <MdPre streaming={streaming}>{p.children}</MdPre> }}
    >
      {text}
    </ReactMarkdown>
  );
});
