/**
 * Markdown as reading text: `Md` renders a Markdown string through the shared pipeline
 * (markdown-plugins.ts), and `Prose` is `Md` in its reading box — the `.md-body` typography in
 * prose.css, in one of three densities.
 *
 * `Md` is memoized by text identity. A chat's stream model mutates items in place and only
 * reassigns `text` when a delta arrives, so every settled message keeps the same string instance
 * across the per-frame version bumps — the shallow prop compare then skips its entire
 * micromark → mdast → React re-parse, and only the actively-streaming message re-renders. Without
 * this, each animation frame during a stream re-parsed the WHOLE transcript (O(n²) over a long
 * reply), which visibly froze the UI while large code blocks streamed in.
 *
 * Fenced code blocks render through CodeBlock (language chrome + copy button + highlighting).
 * `streaming` disables highlighting while deltas are still arriving — re-tokenizing a growing
 * block every frame is O(n²) work — and the settle re-render (new string instance,
 * streaming=false) highlights each block exactly once. Inline code keeps the default rendering
 * (`.md-body code` in prose.css).
 *
 * KaTeX is held back the same way, for the same reason: `streaming` swaps the rehype stage out, so
 * a formula shows its own TeX source until the message settles and is typeset once (see
 * NO_REHYPE_PLUGINS in markdown-plugins.ts for the measurements). KaTeX's own stylesheet is
 * imported here, so a consumer never loads it on its own; the `.katex` rules in prose.css out-rank
 * it by specificity, whichever of the two a bundle happens to emit first.
 *
 * Links open in a new tab unless a `ProseLinksProvider` above decides otherwise — the Web App's
 * conversation sends a link to a Workspace file to its Files panel that way.
 *
 * Two optional props open the renderer to a surface with its own nodes — the channel message body,
 * which keeps `@mentions` as chips — without a second copy of the pipeline drifting from this one.
 * They only ever ADD to the shared stage and to the maps below; nothing a surface passes can take
 * the shared plugins away.
 */
import { createContext, isValidElement, memo, useContext } from "react";
import type { ComponentPropsWithoutRef, MouseEvent, ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps, Options } from "react-markdown";
import { CodeBlock } from "../code-block/code-block";
import { NO_REHYPE_PLUGINS, REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown-plugins";
import "katex/dist/katex.min.css";
import "./prose.css";

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

/** The attributes a rendered link adds on top of its own. */
export interface ProseLinkBehavior {
  target?: "_blank";
  rel?: "noreferrer";
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** Decides what a link does from its href. */
export type ProseLinkResolver = (href: string | undefined) => ProseLinkBehavior;

/**
 * A new tab with no handle back to this window (`noreferrer` implies `noopener`): every link when
 * no resolver is provided.
 */
export const PROSE_NEW_TAB: ProseLinkBehavior = { target: "_blank", rel: "noreferrer" };

const ProseLinksContext = createContext<ProseLinkResolver | null>(null);

/**
 * Hands the Markdown below a link resolver; `null` restores the default, a new tab for every link.
 * A context change re-renders every link in the tree, memoized bodies included, so pass a resolver
 * that keeps its identity while its inputs do.
 */
export function ProseLinksProvider({
  resolve,
  children,
}: {
  resolve: ProseLinkResolver | null;
  children?: ReactNode;
}): ReactElement {
  return <ProseLinksContext.Provider value={resolve}>{children}</ProseLinksContext.Provider>;
}

/**
 * Link adapter. With no resolver above, every link opens in a new tab (`target="_blank"` +
 * `rel="noreferrer"`, which also implies `noopener`), unconditionally, so a click never navigates
 * the app away. A resolver decides per href. All other anchor props react-markdown supplies
 * (`href`, ...) are forwarded as-is — only its non-DOM `node` prop is stripped — and the behaviour
 * sits after the spread so it always wins. A link title (`[text](url "title")`) becomes the shared
 * tooltip's text rather than a native `title`, like every other hover hint. Long-URL wrapping is
 * CSS (`.md-body a` in prose.css).
 */
function MdLink({
  node: _node,
  children,
  title,
  ...anchorProps
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const resolve = useContext(ProseLinksContext);
  const behavior = resolve === null ? PROSE_NEW_TAB : resolve(anchorProps.href);
  return (
    <a {...anchorProps} data-tooltip={title} {...behavior}>
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
 * flips on. The `a` adapter closes over nothing — its resolver comes from context, not from a
 * closure — so both maps share the one `MdLink` reference.
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
 * The settled map, for a read-only Markdown surface that renders through react-markdown itself
 * and keeps the code-block chrome. A surface that only swaps the link and image adapters (the
 * file browser) passes them to `Md` instead.
 */
export const SETTLED_MD_COMPONENTS: Components = SETTLED_COMPONENTS;

export interface MdProps {
  text: string;
  /** The text is still arriving: no highlighting, no KaTeX, until it settles. */
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
   * Element overrides merged over the two maps above, which keep `pre` and `a`. A module
   * constant, for the same reason those are: react-markdown uses a component as the element
   * *type*, so a fresh function per render remounts everything it renders.
   */
  components?: Components;
}

/** The Markdown alone, for a caller that supplies its own `.md-body` box. */
export const Md = memo(function Md({ text, streaming = false, extraPlugins, components }: MdProps) {
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

/**
 * How dense the reading box is: `body` the full typography; `compact` one size tighter, for a
 * message that is a line in a stream (a channel bubble); `flush` the full typography with the
 * outermost block's margins dropped, for a box that brings its own inset.
 */
export type ProseVariant = "body" | "compact" | "flush";

const VARIANT: Record<ProseVariant, string> = {
  body: "md-body",
  compact: "md-body md-compact",
  flush: "md-body md-body-flush",
};

export interface ProseProps extends MdProps {
  variant?: ProseVariant;
  /** Size, ink and layout from the caller; the box sets the reading face and the typography. */
  className?: string;
}

/** Markdown in its reading box. */
export function Prose({ variant = "body", className = "", ...md }: ProseProps) {
  return (
    <div className={`${VARIANT[variant]} font-sans ${className}`}>
      <Md {...md} />
    </div>
  );
}
