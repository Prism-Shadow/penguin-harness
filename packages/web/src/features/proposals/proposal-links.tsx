/**
 * `proposal:<n>[#<pattern>]` references in Markdown, as capsules.
 *
 * A proposal's one stable link is its number (its title changes with every revision, and its
 * body carries no file links), so that is the reference every Markdown surface — a channel
 * message, a chat reply, a proposal body — renders as a capsule: `#12 <title> · <unread>`,
 * naming the proposal by the index the company store holds, and opening it on click. An
 * optional `#<pattern>` after the number is a regular expression over the proposal's headings
 * and paragraph first lines; the page matches it once the proposal is loaded and scrolls
 * there, so the capsule only has to carry it.
 *
 * The pass is the mention pass's twin (features/company/channel-markdown.tsx): a remark plugin
 * that splits references out of `text` nodes into `<data value="proposal:12#…">` elements —
 * so a reference inside inline code or a fence stays literal — plus the same rewrite for a
 * `[label](proposal:12)` link, whose node is replaced whole (the title is what the capsule
 * says; a hand-written label would go stale with the first revision). `<data>` is claimed for
 * the reason the mention pass gives: no Markdown syntax produces it, so the two passes share
 * the element and dispatch on the value's prefix. Without the plugin installed (no index), the
 * reference renders as the text it was.
 */
import type { Components, Options } from "react-markdown";
import { useInRouterContext, useNavigate } from "react-router";
import { S } from "../../lib/strings";
import { toneSurface } from "../../lib/tone";
import { useCompanyOptional } from "../../state/company";
import { orgProposalPath, parseOrgKey } from "../company/company-nav";
import {
  PROPOSAL_REF_RE,
  parseProposalRef,
  proposalHashFor,
  proposalRefText,
  trimPatternPunctuation,
} from "./proposals-model";
import type { ProposalRef } from "./proposals-model";

/** The mdast shapes this pass touches, declared structurally rather than taking `@types/mdast` on. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
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

/** The element a reference becomes, shared with the mention pass. */
const CAPSULE_TAG = "data";

/** The value's prefix that tells a proposal capsule from a mention on the shared element. */
export const PROPOSAL_VALUE_PREFIX = "proposal:";

function capsuleNode(ref: ProposalRef): MdNode {
  const text = proposalRefText(ref);
  return {
    type: "proposalRef",
    data: {
      hName: CAPSULE_TAG,
      hProperties: { value: text },
      // The reference as the element's text: what a copy of the rendered body carries, and
      // what the capsule falls back to without an index.
      hChildren: [{ type: "text", value: text }],
    },
  };
}

/** One text node as the nodes that replace it, or null when it holds no reference. */
function splitText(value: string): MdNode[] | null {
  const out: MdNode[] = [];
  let last = 0;
  let changed = false;
  PROPOSAL_REF_RE.lastIndex = 0;
  for (let m = PROPOSAL_REF_RE.exec(value); m !== null; m = PROPOSAL_REF_RE.exec(value)) {
    const number = Number(m[1]);
    if (!Number.isSafeInteger(number) || number <= 0) continue;
    // Sentence punctuation after a bare pattern belongs to the sentence (`see proposal:12#Rename.`).
    const rawPattern = m[2];
    const pattern = rawPattern === undefined ? undefined : trimPatternPunctuation(rawPattern);
    const consumed =
      rawPattern === undefined
        ? m[0].length
        : m[0].length - (rawPattern.length - (pattern ?? "").length);
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    out.push(
      capsuleNode(pattern === undefined || pattern === "" ? { number } : { number, pattern }),
    );
    last = m.index + consumed;
    PROPOSAL_REF_RE.lastIndex = last;
    changed = true;
  }
  if (!changed) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** Walks every parent, so a reference in a list item or a table cell is covered too. */
function walk(parent: MdParent): void {
  const children = parent.children;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]!;
    if (node.type === "text" && typeof node.value === "string") {
      const split = splitText(node.value);
      if (split !== null) {
        children.splice(i, 1, ...split);
        i += split.length - 1;
      }
      continue;
    }
    if (node.type === "link" && typeof node.url === "string") {
      const ref = parseProposalRef(node.url);
      if (ref !== null) {
        children[i] = capsuleNode(ref);
        continue;
      }
    }
    if (Array.isArray(node.children)) walk(node as MdParent);
  }
}

/** Runs after remark-gfm, on the tree it produced. */
export function remarkProposalLinks() {
  return (tree: MdParent): void => walk(tree);
}

/** What a surface adds to the shared remark stage for proposal capsules — this pass, and nothing else. */
export const PROPOSAL_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkProposalLinks];

/**
 * The capsule: number and title, and the unread count after a dot when there is one; the
 * proposal's own page on click, with the pattern carried in the hash for the page to resolve.
 * The index is the open organization's — a reference always names a proposal of the
 * organization whose surface it is read on — so with no index (the plugin not installed, or
 * the listing not yet read) the capsule is the reference's text, and with an index that does
 * not know the number it is the bare `#n`. Outside the app's providers (a static render of a
 * body) there is nothing to name it by, and the text stands.
 */
export function ProposalCapsule({ value }: { value: string }) {
  const ref = parseProposalRef(value);
  const company = useCompanyOptional();
  const routed = useInRouterContext();
  if (ref === null || company === null || !routed || !company.proposalsEnabled) {
    return <>{value}</>;
  }
  return <LinkedCapsule value={value} ref_={ref} />;
}

function LinkedCapsule({ value, ref_ }: { value: string; ref_: ProposalRef }) {
  const company = useCompanyOptional();
  const navigate = useNavigate();
  const item = company?.proposalOf(ref_.number) ?? null;
  const open = parseOrgKey(company?.currentOrgKey ?? company?.lastOrgKey ?? null);
  const label =
    item === null ? `#${ref_.number}` : S.company.proposals.capsule(ref_.number, item.title);
  const unread = item?.unread ?? 0;
  return (
    <button
      type="button"
      title={`${S.company.proposals.openProposal} · ${value}`}
      disabled={open === null}
      onClick={() => {
        if (open === null) return;
        navigate(
          `${orgProposalPath(open.projectId, open.orgId, ref_.number)}${proposalHashFor(ref_)}`,
        );
      }}
      className={`inline-flex max-w-full items-baseline gap-1 rounded px-1 align-baseline text-[0.92em] font-medium ${
        unread > 0
          ? toneSurface.attention
          : "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
      } disabled:cursor-default`}
    >
      <span className="truncate">{label}</span>
      {unread > 0 && (
        <span
          className="tabular-nums opacity-80"
          aria-label={S.company.proposals.capsuleUnread(unread)}
        >
          · {unread}
        </span>
      )}
    </button>
  );
}

/**
 * The `<data>` element the pass produced, as the capsule. A value that is not a reference is
 * somebody else's `<data>` (the mention pass's, on a surface that stacks both) and is left to
 * its text. Its props are the element's, hence the width of `value`.
 */
export function ProposalDataNode({
  value,
  children,
}: {
  value?: string | number | readonly string[];
  children?: React.ReactNode;
}) {
  const text = typeof value === "string" ? value : "";
  if (!text.startsWith(PROPOSAL_VALUE_PREFIX)) return <>{children}</>;
  return <ProposalCapsule value={text} />;
}

/** The one element a plain Markdown surface overrides for capsules; the chat renderer's `pre` and `a` stay as they are. */
export const PROPOSAL_COMPONENTS: Components = { [CAPSULE_TAG]: ProposalDataNode };
