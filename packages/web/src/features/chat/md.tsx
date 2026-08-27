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
 *
 * KaTeX is held back the same way, for the same reason: `streaming` swaps the rehype stage
 * out, so a formula shows its own TeX source until the message settles and is typeset once
 * (see NO_REHYPE_PLUGINS in lib/markdown-plugins.ts for the measurements).
 */
import { isValidElement, memo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import { NO_REHYPE_PLUGINS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import { CodeBlock } from "./code-block";

/** Flatten a react-markdown code element's children to plain text (string or string array in practice). */
function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
  return "";
}

/**
 * Fenced-block adapter: unwraps the <pre><code class="language-x"> pair react-markdown emits into
 * CodeBlock.
 *
 * `language-math` is the exception. remark-math models block math as a fence in that language and
 * rehype-katex replaces the whole pair before this adapter is consulted — except while streaming,
 * where the rehype stage is off, and the block would otherwise pick up CodeBlock's chrome and copy
 * button for the few hundred milliseconds before it settles into a formula. A plain <pre> is the
 * source either way, so the settle changes the typesetting and nothing else.
 */
function MdPre({ children, streaming }: { children?: ReactNode; streaming: boolean }) {
  if (isValidElement(children)) {
    const props = children.props as { className?: string; children?: unknown };
    const language = /language-([\w+-]+)/.exec(props.className ?? "")?.[1] ?? "";
    if (language === "math") return <pre>{children}</pre>;
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

/**
 * Link adapter: every chat link opens in a new tab (`target="_blank"` + `rel="noreferrer"`,
 * which also implies `noopener`), unconditionally — including relative and `#anchor` hrefs a
 * model may emit — so clicking a reply link never navigates the SPA away from the live
 * conversation. All other anchor props react-markdown supplies (`href`, `title` from
 * `[text](url "title")`, ...) are forwarded as-is — only its non-DOM `node` prop is stripped —
 * and `target`/`rel` sit after the spread so the new-tab behavior always wins.
 * Long-URL wrapping is CSS (`.md-body a` in styles.css), not handled here.
 */
function MdLink({
  node: _node,
  children,
  ...anchorProps
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  return (
    <a {...anchorProps} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * The two `components` maps, built once at module scope instead of inline per render.
 * react-markdown uses `components.pre` as the element **type**, so a fresh arrow each render is
 * a new type on every commit: React unmounts and remounts every code block, dropping the user's
 * text selection and resetting each block's Copy-button state — ~8 times a second while a reply
 * streams, including for blocks that closed long ago. `streaming` is the only thing the adapter
 * closes over, so one frozen map per value is enough; the single flip between them happens on
 * the settle render, which re-parses the message anyway — the same render the rehype stage
 * flips on. The `a` adapter closes over nothing, so both maps share the one `MdLink` reference.
 */
const STREAMING_COMPONENTS: Components = {
  pre: (props) => <MdPre streaming>{props.children}</MdPre>,
  a: MdLink,
};
const SETTLED_COMPONENTS: Components = {
  pre: (props) => <MdPre streaming={false}>{props.children}</MdPre>,
  a: MdLink,
};

export const Md = memo(function Md({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={streaming ? NO_REHYPE_PLUGINS : REHYPE_PLUGINS}
      components={streaming ? STREAMING_COMPONENTS : SETTLED_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});
