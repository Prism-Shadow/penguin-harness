/**
 * A channel message's body: Markdown through the app's shared pipeline, with `@mentions` kept
 * as chips and typed line breaks kept as line breaks.
 *
 * A message in a channel is prose somebody typed, so it renders the way every other Markdown
 * surface in this app does — headings, lists, tables, fenced code — instead of showing its own
 * markers. Two things separate it from a chat reply, and one remark pass covers both:
 *
 * - **Mentions.** `@ceo` is not Markdown, it is this product's own token, and the reader has to
 *   see at a glance which ones name them. Splitting it out of the text before the renderer runs
 *   is what lets a mention survive inside a list item, a heading or a table cell — and because
 *   the pass only ever touches `text` nodes, an `@` inside inline code or a fence stays literal.
 * - **Line breaks.** A composer with Shift+Enter for a new line makes single newlines
 *   meaningful; Markdown folds them into spaces. They become hard breaks here.
 *
 * A mention reaches the renderer as `<data value="agent:ceo">`: mdast has no mention node, no
 * Markdown syntax produces a `<data>` element (so claiming it in the components map collides
 * with nothing the parser or KaTeX emits), and it is the one HTML element that already means "a
 * machine value beside its human-readable label". Who is reading comes from context rather than
 * props, because the components map has to be a module constant.
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Components, Options } from "react-markdown";
import { S } from "../../lib/strings";
import { toneSurface } from "../../lib/tone";
import { Md } from "../chat/md";
import {
  mentionIsMe,
  mentionLabel,
  mentionNameHandles,
  mentionNote,
  mentionRuns,
} from "./channel-mentions";

/** The mdast shapes this pass touches, declared structurally rather than taking `@types/mdast` on. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
    hChildren?: Array<{ type: string; value: string }>;
  };
}
interface MdParent {
  children: MdNode[];
}

/** The element a mention becomes; see this module's comment for why `data` and not a span. */
const MENTION_TAG = "data";

function mentionNode(raw: string, token: string): MdNode {
  return {
    type: "mention",
    data: {
      hName: MENTION_TAG,
      hProperties: { value: token },
      // The raw token as the element's text: what the chip falls back to, and what a copy of
      // the rendered message carries.
      hChildren: [{ type: "text", value: raw }],
    },
  };
}

/**
 * One text node as the nodes that replace it — mention nodes for the `@` runs, hard breaks for
 * the newlines — or null when it holds neither and is left exactly as it is.
 */
function splitText(value: string, names: ReadonlyMap<string, string>): MdNode[] | null {
  const out: MdNode[] = [];
  let changed = false;
  for (const run of mentionRuns(value, names)) {
    if (run.mention !== null) {
      out.push(mentionNode(run.text, run.mention));
      changed = true;
      continue;
    }
    const lines = run.text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (i > 0) {
        out.push({ type: "break" });
        changed = true;
      }
      if (line !== "") out.push({ type: "text", value: line });
    }
  }
  return changed ? out : null;
}

/** Walks every parent, so a mention in a list item or a table cell is covered too. */
function walk(parent: MdParent, names: ReadonlyMap<string, string>): void {
  const children = parent.children;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]!;
    if (node.type === "text" && typeof node.value === "string") {
      const split = splitText(node.value, names);
      if (split !== null) {
        children.splice(i, 1, ...split);
        i += split.length - 1;
      }
      continue;
    }
    if (Array.isArray(node.children)) walk(node as MdParent, names);
  }
}

/** Runs after remark-gfm, on the tree it produced. */
export function remarkChannelMessage(options?: { names?: ReadonlyMap<string, string> }) {
  // Employees' names (name → agent id): a mention may be written by name, in any script.
  const names = options?.names ?? new Map<string, string>();
  return (tree: MdParent): void => walk(tree, names);
}

/** What a channel body adds to the shared remark stage — the pass above, and nothing else. */
export const CHANNEL_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkChannelMessage];

/** Who is reading, which is what decides whether a mention is highlighted. */
export interface ChannelReader {
  /** Employee id to display name. */
  names: ReadonlyMap<string, string>;
  /** Employee id to title, which a mention chip prints after the name. */
  titles: ReadonlyMap<string, string>;
  /** The reading user's own id; "" while it is unknown. */
  me: string;
  /** Every employee id, so a bare `@id` an employee claims is not read as the user's. */
  employeeIds: ReadonlySet<string>;
}

const NOBODY: ChannelReader = {
  names: new Map(),
  titles: new Map(),
  me: "",
  employeeIds: new Set(),
};
const ReaderContext = createContext<ChannelReader>(NOBODY);

/** Names every mention chip rendered below against this reader. */
export function ChannelReaderProvider({
  reader,
  children,
}: {
  reader: ChannelReader;
  children: ReactNode;
}) {
  return <ReaderContext.Provider value={reader}>{children}</ReaderContext.Provider>;
}

/**
 * A mention as a chip: the resolved name after the `@` — and the employee's title after it, a
 * tone lighter, when there is one to say — with the raw token in the tooltip;
 * attention-toned when it addresses the reader. The ordinary chip sits one step deeper than
 * the app's usual grey fill, because the bubble it is printed on is that grey (channel-view's
 * BUBBLE_SURFACE) and a chip the colour of its background is not a chip.
 */
export function MentionChip({
  raw,
  label,
  note = "",
  me,
}: {
  raw: string;
  label: string;
  note?: string;
  me: boolean;
}) {
  const noted = note !== "" && note !== label;
  return (
    <span
      title={raw}
      className={`rounded px-1 ${
        me
          ? `font-semibold ${toneSurface.attention}`
          : "bg-gray-200 font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100"
      }`}
    >
      @{label}
      {noted && <span className="font-normal opacity-70"> ({note})</span>}
      {me && <span className="sr-only"> ({S.company.channels.mentionsYou})</span>}
    </span>
  );
}

/** The `<data>` element the pass produced, as the chip. Its props are the element's, hence the width of `value`. */
function MentionNode({ value }: { value?: string | number | readonly string[] }) {
  const reader = useContext(ReaderContext);
  const token = typeof value === "string" ? value : "";
  return (
    <MentionChip
      raw={`@${token}`}
      label={mentionLabel(token, reader.names, S.company.principalAll)}
      note={mentionNote(token, reader.titles)}
      me={mentionIsMe(token, reader.me, reader.employeeIds)}
    />
  );
}

/** The one element a channel body overrides; the chat renderer's `pre` and `a` stay as they are. */
export const CHANNEL_COMPONENTS: Components = { [MENTION_TAG]: MentionNode };

/** A message body. The caller supplies the `md-body md-compact` container it renders into. */
export function ChannelMessageBody({ text }: { text: string }) {
  const reader = useContext(ReaderContext);
  // The plugin list is rebuilt only when the names change: a new array is a new pipeline.
  const plugins = useMemo<NonNullable<Options["remarkPlugins"]>>(
    () => [[remarkChannelMessage, { names: mentionNameHandles(reader.names) }]],
    [reader.names],
  );
  return <Md text={text} extraPlugins={plugins} components={CHANNEL_COMPONENTS} />;
}
