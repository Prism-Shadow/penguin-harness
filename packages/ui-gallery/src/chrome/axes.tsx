/**
 * A part demo's axes as segmented groups: one group per axis, plus `all` for a matrix demo. The
 * pick is a part's `v.<part-id>=` in the URL, so a chosen combination is quotable.
 */
import type { DemoAxes } from "../../../ui/src/demo";
import { formatVariantKey, MATRIX_KEY } from "../lib/demos";
import type { VariantPick } from "../lib/demos";
import { useGallery } from "../state";

export function AxisPills({
  axes,
  matrix,
  pick,
  onPick,
}: {
  axes: DemoAxes | undefined;
  matrix: boolean | undefined;
  pick: VariantPick;
  onPick: (key: string) => void;
}) {
  const { S } = useGallery();
  const names = Object.keys(axes ?? {});
  if (names.length === 0) return null;
  const choose = (axis: string, value: string) => {
    const selection = pick.kind === "single" ? { ...pick.selection } : {};
    selection[axis] = value;
    onPick(formatVariantKey(axes, { kind: "single", selection }));
  };
  return (
    <div className="g-axes" role="group" aria-label={S.section.variants}>
      {matrix && (
        <span className="g-seg">
          <button
            type="button"
            aria-pressed={pick.kind === "matrix"}
            onClick={() => onPick(MATRIX_KEY)}
          >
            {MATRIX_KEY}
          </button>
        </span>
      )}
      {names.map((axis) => (
        <span key={axis} className="g-seg" role="group" aria-label={axis}>
          {(axes?.[axis] ?? []).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={pick.kind === "single" && pick.selection[axis] === value}
              onClick={() => choose(axis, value)}
            >
              {value}
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}
