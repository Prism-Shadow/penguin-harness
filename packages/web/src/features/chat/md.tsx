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
 *
 * Two optional props open the renderer to a surface with its own nodes — the channel message
 * body, which keeps `@mentions` as chips — without a second copy of the pipeline drifting from
 * this one. They only ever ADD to the shared stage and to the maps below; nothing a surface
 * passes can take the shared plugins away.
 */
import { createContext, isValidElement, memo, useContext, useMemo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps, Options } from "react-markdown";
import { NO_REHYPE_PLUGINS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import { NEW_TAB, replyLinkBehavior } from "../../lib/reply-link";
import type { WorkspaceLinks } from "../../lib/reply-link";
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
 * The Workspace the Markdown below belongs to, when it belongs to one. Only a conversation
 * provides it (MessageStream); every other surface — Memory, the handbook, tickets — renders
 * without it and keeps a new tab for every link.
 */
const WorkspaceLinksContext = createContext<WorkspaceLinks | null>(null);

/**
 * Makes the links in the Markdown below Workspace-aware: a link naming a file of `workspace`
 * opens it through `onOpenFile` (the Files panel) instead of a new tab — see lib/reply-link.ts
 * for how an href is sorted. With no `onOpenFile` the links keep the new-tab behaviour.
 *
 * The value is memoized on its two inputs: a context change re-renders every link in the
 * transcript, memoized message bodies included, so `onOpenFile` has to be a stable callback.
 */
export function WorkspaceLinksProvider({
  workspace,
  onOpenFile,
  children,
}: {
  workspace: string | null;
  onOpenFile: ((path: string) => void) | undefined;
  children: ReactNode;
}) {
  const links = useMemo<WorkspaceLinks | null>(
    () => (onOpenFile === undefined ? null : { workspace, openFile: onOpenFile }),
    [workspace, onOpenFile],
  );
  return <WorkspaceLinksContext.Provider value={links}>{children}</WorkspaceLinksContext.Provider>;
}

/**
 * Link adapter. Outside a conversation every link opens in a new tab (`target="_blank"` +
 * `rel="noreferrer"`, which also implies `noopener`), unconditionally, so a click never
 * navigates the SPA away. Inside one (WorkspaceLinksProvider above) only an external link does;
 * a Workspace file opens in the Files panel, an `#anchor` scrolls within the page, and a
 * relative href with nowhere to go stays put — a relative href resolves against the SPA's own
 * route, so a new tab on it is a second copy of the App on a page that does not exist.
 * All other anchor props react-markdown supplies (`href`, `title` from `[text](url "title")`,
 * ...) are forwarded as-is — only its non-DOM `node` prop is stripped — and the behaviour sits
 * after the spread so it always wins. Long-URL wrapping is CSS (`.md-body a` in styles.css).
 */
function MdLink({
  node: _node,
  children,
  ...anchorProps
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const links = useContext(WorkspaceLinksContext);
  const behavior = links === null ? NEW_TAB : replyLinkBehavior(anchorProps.href, links);
  return (
    <a {...anchorProps} {...behavior}>
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
 * flips on. The `a` adapter closes over nothing — the Workspace it needs comes from context, not
 * from a closure — so both maps share the one `MdLink` reference.
 */
const STREAMING_COMPONENTS: Components = {
  pre: (props) => <MdPre streaming>{props.children}</MdPre>,
  a: MdLink,
};
const SETTLED_COMPONENTS: Components = {
  pre: (props) => <MdPre streaming={false}>{props.children}</MdPre>,
  a: MdLink,
};

/**
 * The settled map, for the read-only Markdown surfaces outside the chat (the shared file
 * browser) that keep the code-block chrome and swap only the link and image adapters.
 */
export const SETTLED_MD_COMPONENTS: Components = SETTLED_COMPONENTS;

export const Md = memo(function Md({
  text,
  streaming = false,
  extraPlugins,
  components,
}: {
  text: string;
  streaming?: boolean;
  /**
   * Remark plugins a surface adds to the shared stage, for a node of its own — the channel
   * message body adds the pass that turns its `@mentions` into elements. They are appended to
   * REMARK_PLUGINS rather than replacing it: a renderer that dropped the shared list would end
   * bare URLs and typeset math differently from every other one, which is the drift
   * markdown-plugins.ts exists to prevent.
   */
  extraPlugins?: NonNullable<Options["remarkPlugins"]>;
  /**
   * Element overrides merged over the two maps below, which keep `pre` and `a`. A module
   * constant, for the same reason those are: react-markdown uses a component as the element
   * *type*, so a fresh function per render remounts everything it renders.
   */
  components?: Components;
}) {
  const base = streaming ? STREAMING_COMPONENTS : SETTLED_COMPONENTS;
  return (
    <ReactMarkdown
      remarkPlugins={
        extraPlugins === undefined ? REMARK_PLUGINS : [...REMARK_PLUGINS, ...extraPlugins]
      }
      rehypePlugins={streaming ? NO_REHYPE_PLUGINS : REHYPE_PLUGINS}
      components={components === undefined ? base : { ...base, ...components }}
    >
      {text}
    </ReactMarkdown>
  );
});
