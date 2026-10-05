/**
 * Comments beside the things a proposal lists: a scope entry, a test entry, a changed file. Each
 * gets a "comment" button that opens a composer under it, and — when it has comments — a count
 * that unfolds them there.
 *
 * What every such place needs (the comments, who is reading, the write) comes from one context
 * the proposal page provides, so the rows, and the diff dialog the impl section opens, take no
 * extra props for it. A place outside the provider (a test rendering a row alone) shows no
 * comment controls.
 */
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type {
  ProposalComment,
  ProposalCommentTarget,
  ProposalScopeEntry,
  ProposalTestEntry,
} from "@prismshadow/penguin-server/api";
import { GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { CommentComposer, CommentLine } from "./proposal-comment-line";
import {
  isOutdated,
  scopeComments,
  testComments,
  type DiffCommits,
} from "./proposal-comment-targets";

export interface ProposalCommentsValue {
  comments: readonly ProposalComment[];
  revision: number;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  /** The signed-in person's principal: whose pending comments carry Edit / Delete. */
  me: string | null;
  busy: boolean;
  /** A closed proposal takes no more comments. */
  closed: boolean;
  /** The commits the impl's diff reads at now, when known: a comment on other ones is outdated. */
  current: DiffCommits | null;
  onTarget: (target: ProposalCommentTarget, text: string) => Promise<boolean>;
  onEdit: (commentId: string, text: string) => Promise<boolean>;
  onDelete: (commentId: string) => Promise<boolean>;
}

const ProposalCommentsContext = createContext<ProposalCommentsValue | null>(null);

export function ProposalCommentsProvider({
  value,
  children,
}: {
  value: ProposalCommentsValue;
  children: ReactNode;
}) {
  return (
    <ProposalCommentsContext.Provider value={value}>{children}</ProposalCommentsContext.Provider>
  );
}

export const useProposalComments = (): ProposalCommentsValue | null =>
  useContext(ProposalCommentsContext);

/** The listed comments under their place, each marked outdated when the diff has moved past it. */
export function CommentList({
  comments,
  ctx,
}: {
  comments: readonly ProposalComment[];
  ctx: ProposalCommentsValue;
}) {
  return (
    <div className="mt-1 space-y-2 border-l-2 border-gray-200 pl-3 dark:border-gray-800">
      {comments.map((c) => (
        <CommentLine
          key={c.id}
          comment={c}
          names={ctx.names}
          locale={ctx.locale}
          outdated={isOutdated(c, ctx.current)}
          mine={ctx.me !== null && c.by === ctx.me}
          busy={ctx.busy}
          onEdit={ctx.onEdit}
          onDelete={ctx.onDelete}
        />
      ))}
    </div>
  );
}

/** The small "comment" glyph button a row carries; `label` names what it comments on. */
export function CommentButton({
  label,
  onClick,
  pressed,
}: {
  label: string;
  onClick: () => void;
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
      onClick={onClick}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
    >
      <GlyphIcon d={ICONS.messageSquare} size={ICON_SIZE.inlineGlyph} />
    </button>
  );
}

/**
 * The comment controls of one target, in two parts a row lays out itself: `button` (the
 * "comment" button and the count) goes on the row's line, `body` (the composer and the unfolded
 * comments) under it. Both are null outside the provider.
 */
export function useTargetComments(
  target: ProposalCommentTarget,
  comments: readonly ProposalComment[],
  label: string,
  quote: string,
): { button: ReactNode; body: ReactNode } {
  const ctx = useProposalComments();
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(false);
  if (ctx === null) return { button: null, body: null };
  const t = S.company.proposals;
  const pending = comments.some((c) => c.batchId === null);
  const button = (
    <span className={`inline-flex items-center ${ICON_GAP.tight}`}>
      {!ctx.closed && (
        <CommentButton label={label} pressed={composing} onClick={() => setComposing((v) => !v)} />
      )}
      {comments.length > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`rounded px-1 text-xs tabular-nums ${
            pending
              ? toneInk.attention
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          {t.targets.count(comments.length)}
        </button>
      )}
    </span>
  );
  const body = (
    <>
      {composing && (
        <CommentComposer
          quote={quote}
          label={t.targets.commentingOn}
          busy={ctx.busy}
          onCancel={() => setComposing(false)}
          onSubmit={async (text) => {
            const ok = await ctx.onTarget(target, text);
            if (ok) {
              setComposing(false);
              setOpen(true);
            }
            return ok;
          }}
        />
      )}
      {open && comments.length > 0 && <CommentList comments={comments} ctx={ctx} />}
    </>
  );
  return { button, body };
}

/** A scope entry's comment controls (see useTargetComments). */
export function useScopeEntryComments(entry: ProposalScopeEntry) {
  const ctx = useProposalComments();
  const t = S.company.proposals;
  return useTargetComments(
    { kind: "scope", file: entry.file, scopeKind: entry.kind },
    ctx === null ? [] : scopeComments(ctx.comments, entry.file, entry.kind, ctx.revision),
    t.targets.commentScope,
    `${t.scopeKind[entry.kind]} ${entry.file}`,
  );
}

/** A test entry's comment controls, keyed by its file (see useTargetComments). */
export function useTestEntryComments(entry: ProposalTestEntry) {
  const ctx = useProposalComments();
  return useTargetComments(
    { kind: "test", file: entry.file },
    ctx === null ? [] : testComments(ctx.comments, entry.file, ctx.revision),
    S.company.proposals.targets.commentTest,
    entry.file,
  );
}
