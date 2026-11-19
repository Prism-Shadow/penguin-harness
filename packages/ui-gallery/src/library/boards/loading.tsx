/**
 * 加载: the running-state spinner on its three rungs; the waiting state — its rows, its page and a
 * caller's own cards, shown as they look once a wait is slow, and a replay that answers one region
 * inside the delay and the other after it, so the first never shows a placeholder and the second
 * shows it only from the delay on; the progress bar on its three heights, toned and
 * indeterminate; and the transfer row in every place a conversation's history coming over from a
 * machine shows it — standing in for the transcript (counting, not yet counted, waiting for the
 * machine), over the transcript (going on, and waiting in the same line), under an unfolded
 * output.
 */
import { useEffect, useState } from "react";
import {
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  ProgressBar,
  RetryStatus,
  SkeletonCard,
  StatusIcon,
  TransferProgress,
  WAITING_DELAY_MS,
  Waiting,
} from "@prismshadow/penguin-ui";
import type { ProgressBarSize, StatusIconSize } from "@prismshadow/penguin-ui";
import { BoardGroup, ReplayButton } from "../../foundations/shared";
import { useGallery } from "../../state";

/** The rungs and the pixels each one draws at. */
const SPINNER_RUNGS: readonly (readonly [StatusIconSize, number])[] = [
  ["xs", 10],
  ["sm", 12],
  ["md", 14],
];

/** The bar's heights, each at its own reading. */
const BAR_RUNGS: readonly (readonly [ProgressBarSize, number])[] = [
  ["xs", 30],
  ["sm", 60],
  ["md", 90],
];

/** The demo's amounts, as the Web App formats them: one unit per total, the done figure padded. */
const AMOUNTS = {
  window: { amount: "\u2007120 / 380 KB", value: 120, max: 380 },
  fill: { amount: "3.2 / 9.6 MB", value: 3.2, max: 9.6 },
  older: { amount: "\u2007\u200740 / 210 KB", value: 40, max: 210 },
  body: { amount: "\u200712 / 480 KB", value: 12, max: 480 },
} as const;

export function LoadingBoard() {
  const { S } = useGallery();
  const t = S.library.loading;
  // The link-down row counts down to a moment a little ahead, as the server's retry would.
  const [nextAt] = useState(() => Date.now() + 6_000);
  return (
    <div className="gf-board">
      <BoardGroup title={t.spinner} aside={t.sizes}>
        <div className="lib-row">
          {SPINNER_RUNGS.map(([size, px]) => (
            <span key={size} className="lib-cell">
              <StatusIcon state="running" size={size} />
              <span className="lib-caption">
                {size} · {px}px
              </span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.waiting} aside={t.waitingHint(WAITING_DELAY_MS)}>
        <div className="lib-stack">
          <div className="grid gap-1">
            <span className="lib-caption">{t.waitingRows}</span>
            <div className="lib-box">
              <Waiting rows={3} delay={0} />
            </div>
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.waitingPage}</span>
            <Waiting form="page" delay={0} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.waitingCards}</span>
            <Waiting delay={0} className="grid gap-3 sm:grid-cols-2">
              <SkeletonCard />
              <SkeletonCard />
            </Waiting>
          </div>
        </div>
      </BoardGroup>
      <WaitingReplay />
      <BoardGroup title={t.progress} aside={t.progressHint}>
        <div className="lib-stack">
          {BAR_RUNGS.map(([size, value]) => (
            <div key={size} className="grid gap-1">
              <span className="lib-caption">
                {size} · {value}%
              </span>
              <ProgressBar size={size} value={value} label={t.progressLabel} />
            </div>
          ))}
          <div className="grid gap-1">
            <span className="lib-caption">{t.progressOver}</span>
            <ProgressBar value={100} tone="danger" label={t.progressLabel} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.progressIndeterminate}</span>
            <ProgressBar indeterminate size="md" label={t.progressLabel} />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.transfer} aside={t.transferHint}>
        <div className="lib-stack" style={{ maxWidth: "36rem" }}>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferPane}</span>
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} {...AMOUNTS.window} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferUncounted}</span>
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferPaneWaiting}</span>
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} {...AMOUNTS.window} />
            <RetryStatus
              phase="waiting"
              label={t.transferTrying(2)}
              countdown={(s) => t.transferRetryIn(s, 2)}
              nextAt={nextAt}
              retry={{ label: t.transferRetryNow, onClick: noop }}
              size="sm"
            />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferTop}</span>
            <TransferProgress mark={null} label={t.transferFill} {...AMOUNTS.fill} />
            <TransferProgress mark={null} label={t.transferOlder} {...AMOUNTS.older} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferTopWaiting}</span>
            <TransferProgress
              mark={
                <GlyphIcon
                  d={ICONS.hourglass}
                  size={ICON_SIZE.inlineGlyph}
                  className="text-tone-attention-fg"
                />
              }
              label={t.transferTrying(2)}
              {...AMOUNTS.fill}
            />
          </div>
          <div className="grid gap-1" data-sample="slow">
            <span className="lib-caption">{t.transferSlowCaption}</span>
            <TransferProgress
              mark={
                <GlyphIcon
                  d={ICONS.hourglass}
                  size={ICON_SIZE.inlineGlyph}
                  className="text-tone-attention-fg"
                />
              }
              label={t.transferSlow("gpu-box")}
              {...AMOUNTS.fill}
            />
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} {...AMOUNTS.window} />
            <RetryStatus phase="waiting" label={t.transferSlow("gpu-box")} size="sm" />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferBody}</span>
            <TransferProgress label={t.transferBodyLabel} {...AMOUNTS.body} />
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}

/** How long the slow region of the replay takes to answer, in ms. */
const SLOW_ANSWER_MS = 1600;

/**
 * One region of the replay: it waits on a read that answers after `answerMs`, then shows its
 * content. Remounted by the replay, so each run starts its wait from nothing.
 */
function ReplayRegion({ answerMs, content }: { answerMs: number; content: string }) {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAnswered(true), answerMs);
    return () => clearTimeout(timer);
  }, [answerMs]);
  return (
    <div className="lib-box" style={{ minHeight: "7.5rem" }}>
      {answered ? <p className="p-3 text-sm text-fg">{content}</p> : <Waiting rows={3} />}
    </div>
  );
}

/** A quick answer beside a slow one, replayed: the quick one never shows its wait. */
function WaitingReplay() {
  const { S } = useGallery();
  const t = S.library.loading;
  const [run, setRun] = useState(0);
  return (
    <BoardGroup
      title={t.waitingReplay}
      aside={t.waitingReplayHint}
      action={<ReplayButton onClick={() => setRun((n) => n + 1)} />}
    >
      <div className="lib-stack" style={{ maxWidth: "36rem" }}>
        <div className="grid gap-1">
          <span className="lib-caption">{t.waitingQuick(WAITING_DELAY_MS / 2)}</span>
          <ReplayRegion
            key={`quick-${run}`}
            answerMs={WAITING_DELAY_MS / 2}
            content={t.waitingContent}
          />
        </div>
        <div className="grid gap-1">
          <span className="lib-caption">{t.waitingSlow(SLOW_ANSWER_MS)}</span>
          <ReplayRegion key={`slow-${run}`} answerMs={SLOW_ANSWER_MS} content={t.waitingContent} />
        </div>
      </div>
    </BoardGroup>
  );
}

function noop() {}
