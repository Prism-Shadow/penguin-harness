/**
 * Foundations › Focus: the focus ring drawn permanently on a primary and a secondary button and on
 * a link, the input focus treatment, a text selection, and a scroll box wearing the theme's
 * scrollbar.
 */
import { useGallery } from "../state";
import { BoardGroup } from "./shared";
import { SPECIMENS } from "./specimens";

export function FocusBoard() {
  const { S, state } = useGallery();
  const specimen = SPECIMENS[state.lang];
  // Select a run of whole words (Chinese has no spaces, so it falls back to a fixed slice).
  const text = specimen.paragraph;
  const from = text.indexOf(" ", 20) > 0 ? text.indexOf(" ", 20) + 1 : 20;
  const to = text.indexOf(" ", from + 30) > 0 ? text.indexOf(" ", from + 30) : from + 30;
  return (
    <div className="gf-board">
      <div className="gf-pair">
        <BoardGroup title={S.foundations.focusRing}>
          <div className="gf-controls">
            <span className="gf-button gf-focused" data-variant="primary">
              {S.foundations.scene.primary}
            </span>
            <span className="gf-button gf-focused">{S.foundations.scene.secondary}</span>
            <span className="gf-link gf-focused">{S.foundations.sampleLink}</span>
          </div>
        </BoardGroup>
        <BoardGroup title={S.foundations.inputFocus}>
          <span className="gf-input gf-input-focused">{S.foundations.scene.input}</span>
        </BoardGroup>
      </div>
      <div className="gf-pair">
        <BoardGroup title={S.foundations.selection}>
          <p className="gf-selection">
            {text.slice(0, from)}
            <mark>{text.slice(from, to)}</mark>
            {text.slice(to)}
          </p>
        </BoardGroup>
        <BoardGroup title={S.foundations.scrollbar}>
          <div className="gf-scroll" tabIndex={0}>
            {Array.from({ length: 12 }, (_, i) => (
              <p key={i}>{specimen.ui}</p>
            ))}
          </div>
        </BoardGroup>
      </div>
    </div>
  );
}
