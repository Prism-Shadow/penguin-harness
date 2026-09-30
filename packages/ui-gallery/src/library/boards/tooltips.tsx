/** 悬停提示: the package's one tooltip, by attribute (read by the frame's TooltipLayer) and by component, and on a truncated line. */
import { Button, ICONS, Tooltip } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const EDIT = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z";
const COPY =
  "M9 9h9v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1";
const GEAR =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";

function Glyph({ d }: { d: string }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export function TooltipsBoard() {
  const { S } = useGallery();
  const t = S.library.tooltips;
  return (
    <div className="gf-board">
      <BoardGroup title={t.attribute} aside={t.attributeHint}>
        <div className="lib-row">
          <Button size="icon" aria-label={t.edit} data-tooltip={t.edit}>
            <Glyph d={EDIT} />
          </Button>
          <Button size="icon" aria-label={t.copy} data-tooltip={t.copy}>
            <Glyph d={COPY} />
          </Button>
          <Button size="icon" aria-label={t.settings} data-tooltip={t.settings}>
            <Glyph d={GEAR} />
          </Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.component} aside={t.componentHint}>
        <div className="lib-row">
          {/* Icon-only triggers: a hint never shows over a label the reader can already read whole. */}
          <Tooltip label={t.besideTip} placement="right">
            <Button size="icon" aria-label={t.besideTip}>
              <Glyph d={ICONS.chevronRight} />
            </Button>
          </Tooltip>
          <Tooltip label={t.belowTip} placement="bottom">
            <Button size="icon" aria-label={t.belowTip}>
              <Glyph d={ICONS.arrowDownToLine} />
            </Button>
          </Tooltip>
        </div>
      </BoardGroup>
      <BoardGroup title={t.truncated} aside={t.truncatedHint}>
        <div className="lib-box" data-narrow>
          <span
            className="lib-truncated px-3 py-2"
            data-tooltip={t.command}
            data-tooltip-content="code"
            tabIndex={0}
          >
            {t.command}
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
