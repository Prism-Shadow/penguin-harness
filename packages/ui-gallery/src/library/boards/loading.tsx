/** 加载: the spinner (the running-state ring) at three sizes, and the skeleton line, list and card. */
import { Skeleton, SkeletonCard, SkeletonList } from "../../../../web/src/components/ui/skeleton";
import { StatusIcon } from "../../../../web/src/components/ui/status-icon";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function LoadingBoard() {
  const { S } = useGallery();
  const t = S.library.loading;
  return (
    <div className="gf-board">
      <BoardGroup title={t.spinner} aside={t.sizes}>
        <div className="lib-row">
          {[13, 16, 24].map((size) => (
            <span key={size} className="lib-cell">
              <StatusIcon state="running" size={size} />
              <span className="lib-caption">{size}px</span>
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
