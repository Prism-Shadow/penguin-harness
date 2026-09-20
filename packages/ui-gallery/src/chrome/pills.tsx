/**
 * The quotable breadcrumb and the pill rows: a module's variants (one row, the active pick filled)
 * and a part demo's axes (one group per axis, plus `all` for a matrix demo).
 */
import type { DemoAxes } from "../../../ui/src/demo";
import type { Module, ModuleVariant } from "../../../ui/src/module";
import { formatVariantKey, MATRIX_KEY } from "../lib/demos";
import type { VariantPick } from "../lib/demos";
import { useText } from "../preview";
import { useGallery } from "../state";
import { useCopy } from "./copy";
import { ChromeIcon } from "./icons";

export function Breadcrumb({ text, className = "" }: { text: string; className?: string }) {
  const { S } = useGallery();
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      className={`g-crumb ${className}`}
      title={S.section.copyBreadcrumb}
      onClick={() => copy("crumb", text)}
    >
      <ChromeIcon name={copied ? "check" : "copy"} size={13} />
      <span>{copied ? S.section.copied : text}</span>
    </button>
  );
}

export function VariantPills({
  module,
  current,
  onPick,
}: {
  module: Module;
  current: ModuleVariant;
  onPick: (key: string) => void;
}) {
  const { S } = useGallery();
  const text = useText();
  return (
    <div className="g-pills" role="group" aria-label={S.section.variants}>
      {module.variants.map((variant) => (
        <button
          key={variant.key}
          type="button"
          className="g-pill"
          aria-pressed={variant.key === current.key}
          title={variant.description}
          onClick={() => onPick(variant.key)}
        >
          {text.variant(module, variant)}
        </button>
      ))}
    </div>
  );
}

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
    <div className="g-pills g-pills-axes" role="group" aria-label={S.section.variants}>
      {matrix && (
        <span className="g-pill-group">
          <button
            type="button"
            className="g-pill"
            aria-pressed={pick.kind === "matrix"}
            onClick={() => onPick(MATRIX_KEY)}
          >
            {MATRIX_KEY}
          </button>
        </span>
      )}
      {names.map((axis) => (
        <span key={axis} className="g-pill-group" role="group" aria-label={axis}>
          {(axes?.[axis] ?? []).map((value) => (
            <button
              key={value}
              type="button"
              className="g-pill"
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
