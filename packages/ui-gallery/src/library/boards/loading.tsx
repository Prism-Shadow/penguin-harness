/**
 * 加载: the running-state spinner on its three rungs, the skeleton line, list and card, and the
 * progress bar on its three heights, toned and indeterminate.
 */
import {
  ProgressBar,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  StatusIcon,
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

export function LoadingBoard() {
  const { S } = useGallery();
  const t = S.library.loading;
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
    </div>
  );
}
