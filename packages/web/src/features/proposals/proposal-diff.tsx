/**
 * An impl branch's diff view, in the dialog the impl section's `+N/−M` opens
 * (proposal-diff-dialog.tsx): the changed-files tree on the left, each file's diff on the right,
 * unified or split (remembered per browser), whitespace ignored on request. A click on a file in
 * the tree opens it and scrolls to it. Inside the page's comments provider, a file and a range of
 * its lines take comments, recorded against the commits this diff was read at.
 *
 * The server reads the diff from the delivery repository's mirror, or — when the mirror cannot
 * answer — from GitHub's comparison; the view says when it is the latter and what that leaves
 * out. A file over the server's caps, and a binary one, keeps its counts and says why it has no
 * hunks. The totals are the sums over the files, the same sums `+N/−M` makes.
 *
 * ProposalDiff holds the state and the request; DiffView draws from props alone, so a test can
 * render each state without a DOM.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProposalImplChanges } from "@prismshadow/penguin-server/api";
import { Button, Checkbox, ICON_GAP, Segmented, Skeleton } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { OrgEmptyLine, useOrg } from "../company/org-layout";
import { DiffFileBlock, DiffTree } from "./proposal-diff-file";
import { ProposalCommentsProvider, useProposalComments } from "./proposal-target-comments";
import {
  browserStorage,
  fileAnchorId,
  groupByDirectory,
  isOpen,
  openFile,
  readDiffLayout,
  toggleFile,
  totalsOf,
  writeDiffLayout,
  type DiffLayout,
} from "./proposal-diff-model";

export type ChangesState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; changes: ProposalImplChanges };

export function ProposalDiff({ number }: { number: number }) {
  const { projectId, orgId } = useOrg();
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [layout, setLayout] = useState<DiffLayout>(() => readDiffLayout(browserStorage()));
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const [state, setState] = useState<ChangesState>({ kind: "loading" });
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  // A newer request, or leaving the view, makes an answer in flight stale.
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setState({ kind: "loading" });
    try {
      const changes = await api.getOrgProposalImplChanges(
        projectId,
        orgId,
        number,
        ignoreWhitespace,
      );
      if (ticket.current === mine) setState({ kind: "ready", changes });
    } catch (err) {
      if (ticket.current === mine) setState({ kind: "error", message: apiErrorText(err) });
    }
  }, [projectId, orgId, number, ignoreWhitespace]);

  useEffect(() => {
    void load();
    return () => {
      ticket.current += 1;
    };
  }, [load]);

  // Scroll once the jumped-to file is open, so its block has its height.
  useEffect(() => {
    if (jumpTo === null) return;
    document.getElementById(jumpTo)?.scrollIntoView({ block: "start" });
    setJumpTo(null);
  }, [jumpTo]);

  const fileCount = state.kind === "ready" ? state.changes.files.length : 0;
  return (
    <DiffView
      state={state}
      layout={layout}
      ignoreWhitespace={ignoreWhitespace}
      flipped={flipped}
      onLayout={(next) => {
        setLayout(next);
        writeDiffLayout(browserStorage(), next);
      }}
      onIgnoreWhitespace={setIgnoreWhitespace}
      onToggle={(path) => setFlipped((f) => toggleFile(f, path))}
      onJump={(path, anchorId) => {
        setFlipped((f) => openFile(f, path, fileCount));
        setJumpTo(anchorId);
      }}
      onRetry={() => void load()}
    />
  );
}

export interface DiffViewProps {
  state: ChangesState;
  layout: DiffLayout;
  ignoreWhitespace: boolean;
  /** The files folded or unfolded against their default (isOpen). */
  flipped: ReadonlySet<string>;
  onLayout: (layout: DiffLayout) => void;
  onIgnoreWhitespace: (on: boolean) => void;
  onToggle: (path: string) => void;
  onJump: (path: string, anchorId: string) => void;
  onRetry: () => void;
}

export function DiffView(props: DiffViewProps) {
  const t = S.company.proposals.implDiff;
  const { state, layout, ignoreWhitespace } = props;
  const totals =
    state.kind === "ready"
      ? { files: state.changes.files.length, ...totalsOf(state.changes.files) }
      : null;
  return (
    <section aria-label={t.title} className="flex h-full min-h-0 flex-col gap-2">
      <div className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
        {totals !== null && (
          <span className="tabular-nums text-gray-500 dark:text-gray-400">
            {t.totals(totals.files, totals.additions, totals.deletions)}
          </span>
        )}
        <div role="group" aria-label={t.layout} className="ml-auto w-36">
          <Segmented
            cols={2}
            value={layout}
            onChange={props.onLayout}
            options={[
              { value: "unified", label: t.unified },
              { value: "split", label: t.split },
            ]}
          />
        </div>
        <Checkbox
          checked={ignoreWhitespace}
          onChange={props.onIgnoreWhitespace}
          label={t.ignoreWhitespace}
        />
      </div>
      <DiffBody {...props} />
    </section>
  );
}

function DiffBody({
  state,
  layout,
  ignoreWhitespace,
  flipped,
  onToggle,
  onJump,
  onRetry,
}: DiffViewProps) {
  const t = S.company.proposals.implDiff;
  const ctx = useProposalComments();
  const changes = state.kind === "ready" ? state.changes : null;
  // The tree's order is the pane's order, so reading down one reads down the other.
  const groups = useMemo(() => groupByDirectory(changes?.files ?? []), [changes]);
  if (state.kind === "loading") {
    return (
      <div aria-busy="true" aria-label={t.loading} className="space-y-1">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
        <span className={toneInk.danger}>
          {t.loadFailed}: {state.message}
        </span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t.retry}
        </Button>
      </div>
    );
  }
  const { changes: c } = state;
  const notes = (
    <>
      {c.source === "github" && (
        <p className={toneInk.attention}>{t.fromGithub(c.fallbackReason ?? "")}</p>
      )}
      {c.truncated && <p className={toneInk.attention}>{t.truncated(c.files.length)}</p>}
    </>
  );
  if (c.files.length === 0) {
    return (
      <>
        {notes}
        <OrgEmptyLine>{ignoreWhitespace ? t.emptyWhitespace : t.empty}</OrgEmptyLine>
      </>
    );
  }
  const ordered = groups.flatMap((g) => g.files);
  const commits = { headSha: c.headSha, baseSha: c.baseSha };
  const files = (
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)]">
      <nav aria-label={t.files} className="max-h-40 min-h-0 overflow-y-auto md:max-h-none">
        <DiffTree
          groups={groups}
          onJump={(path) => onJump(path, fileAnchorId(ordered.findIndex((f) => f.path === path)))}
        />
      </nav>
      <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto">
        {ordered.map((file, i) => (
          <DiffFileBlock
            key={file.path}
            file={file}
            anchorId={fileAnchorId(i)}
            open={isOpen(file.path, ordered.length, flipped)}
            layout={layout}
            limits={c.limits}
            commits={commits}
            onToggle={() => onToggle(file.path)}
          />
        ))}
      </div>
    </div>
  );
  return (
    <>
      {notes}
      {ctx === null ? (
        files
      ) : (
        // A comment here is current against the diff on screen, whatever the detail last said.
        <ProposalCommentsProvider value={{ ...ctx, current: commits }}>
          {!ctx.closed && (
            <p className="text-gray-400 dark:text-gray-500">{S.company.proposals.targets.hint}</p>
          )}
          {files}
        </ProposalCommentsProvider>
      )}
    </>
  );
}
