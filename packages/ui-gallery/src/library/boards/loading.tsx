/**
 * 加载: the running-state spinner on its three rungs, the skeleton line, list and card, the
 * progress bar on its three heights, toned and indeterminate, and the transfer row in every place
 * a conversation's history coming over from a machine shows it — standing in for the transcript
 * (counting, not yet counted, waiting for the machine), over the transcript (going on, and
 * waiting in the same line), under an unfolded output.
 */
import { useState } from "react";
import {
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  ProgressBar,
  RetryStatus,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  StatusIcon,
  TransferProgress,
} from "@prismshadow/penguin-ui";
import type { ProgressBarSize, StatusIconSize } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
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
      <BoardGroup title={t.skeleton}>
        <div className="lib-stack">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </BoardGroup>
      <BoardGroup title={t.list}>
        <div className="lib-box">
          <SkeletonList rows={3} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.card}>
        <div className="lib-stack">
          <SkeletonCard />
        </div>
      </BoardGroup>
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

function noop() {}
