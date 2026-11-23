/**
 * A glyph that acts, alone and flat: no box at rest or on hover — the ink deepens instead, from
 * the subtle ink to the body's. It sits inline beside the name it is about: a package's homepage
 * after its author, the plugin a row's part came from after the part's name. Its label is both
 * its accessible name and its tooltip, since nothing else on screen says what it does.
 *
 * Two forms. With `href` it is a link that opens in a new tab keeping no handle on this one (the
 * link's hand cursor); with `onClick` it is a button (the control's arrow).
 *
 * Props only: the glyph and the label are the caller's.
 */
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

const LOOK =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:text-fg";

export type GlyphActionProps = {
  /** A registry path from `ICONS`. */
  glyph: string;
  /** The accessible name and the tooltip. */
  label: string;
} & (
  | { onClick: () => void; href?: undefined }
  | {
      /** Opens in a new tab that keeps no handle on this one. */
      href: string;
      onClick?: undefined;
    }
);

export function GlyphAction(props: GlyphActionProps) {
  const { glyph, label } = props;
  const named = { "aria-label": label, "data-tooltip": label, "data-tooltip-content": "text" };
  const icon = <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />;
  if (props.href !== undefined) {
    return (
      <a href={props.href} target="_blank" rel="noopener noreferrer" className={LOOK} {...named}>
        {icon}
      </a>
    );
  }
  return (
    <button type="button" onClick={props.onClick} className={LOOK} {...named}>
      {icon}
    </button>
  );
}
