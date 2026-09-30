/** 加载: the running-state spinner on its three rungs, and the skeleton line, list and card. */
import { Skeleton, SkeletonCard, SkeletonList, StatusIcon } from "@prismshadow/penguin-ui";
import type { StatusIconSize } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** The rungs and the pixels each one draws at. */
const SPINNER_RUNGS: readonly (readonly [StatusIconSize, number])[] = [
  ["xs", 10],
  ["sm", 12],
  ["md", 14],
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
    </div>
  );
}
