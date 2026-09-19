/**
 * Foundations › Shape & depth: the things radius, border and shadow are for, in one stack — a page
 * card with its controls and a box nested at the inner radius, a menu dropped from the card's head
 * (glass in Frost), a dialog over the dimmed page and a toast above everything — each layer naming
 * the stacking tier it takes. Then the app window through `.ui-shell`, where a theme decides how
 * its two columns relate (Frost's floating sheet on a field, Console's ruled columns, Primer's
 * plain window). Below it, the radius steps, the border widths and the five shadow levels on
 * plain boxes.
 */
import { useGallery } from "../state";
import { BoardGroup, ShellSpecimen } from "./shared";

const RADII = ["xs", "sm", "md", "lg", "xl", "pill", "control"] as const;
const SHADOWS = ["flat", "raised", "overlay", "modal", "drawer"] as const;
/** The page under the dialog, drawn as text lines: enough for the blur and the dim to act on. */
const LINES = [92, 78, 85, 64, 88, 70, 81, 58] as const;

function Tier({ children }: { children: string }) {
  return <span className="gf-tier gf-caption gf-mono">{children}</span>;
}

function Scene() {
  const { S } = useGallery();
  const t = S.foundations.scene;
  return (
    <div className="gf-scene">
      <div className="gf-scene-page">
        <Tier>{t.pageTier}</Tier>
        <div className="gf-card">
          <div className="gf-card-head">
            <strong>{t.cardTitle}</strong>
            <span className="gf-caption">{t.cardMeta}</span>
            <span className="gf-more" aria-hidden>
              ···
            </span>
          </div>
          <div className="gf-nested">
            <span className="gf-caption">{t.nested}</span>
          </div>
          <div className="gf-controls">
            <span className="gf-button" data-variant="primary">
              {t.primary}
            </span>
            <span className="gf-button">{t.secondary}</span>
            <span className="gf-badge">{t.badge}</span>
          </div>
          <span className="gf-input">{t.input}</span>
          <div className="gf-menu ui-glass" role="menu">
            {t.menuItems.map((item, i) => (
              <span key={item} className="gf-menu-row" data-active={i === 1 || undefined}>
                {item}
              </span>
            ))}
            <span className="gf-layer-tier gf-caption gf-mono">{t.menuTier}</span>
          </div>
        </div>
      </div>
      <div className="gf-scene-modal">
        <div className="gf-scene-lines" aria-hidden>
          {LINES.map((width, i) => (
            <span key={i} style={{ width: `${width}%` }} />
          ))}
        </div>
        <span className="gf-backdrop" />
        <Tier>{t.backdropTier}</Tier>
        <div className="gf-dialog ui-glass" role="dialog" aria-label={t.dialogTitle}>
          <strong>{t.dialogTitle}</strong>
          <p className="gf-muted">{t.dialogBody}</p>
          <div className="gf-controls gf-controls-end">
            <span className="gf-button">{t.cancel}</span>
            <span className="gf-button" data-variant="danger">
              {t.confirm}
            </span>
          </div>
        </div>
        <div className="gf-toast">
          <span>{t.toast}</span>
          <span className="gf-caption gf-mono">{t.toastTier}</span>
        </div>
      </div>
    </div>
  );
}

export function ShapeBoard() {
  const { S } = useGallery();
  return (
    <div className="gf-board">
      <Scene />
      <BoardGroup title={S.foundations.shell} aside={S.foundations.shellNote}>
        <ShellSpecimen />
      </BoardGroup>
      <div className="gf-pair">
        <BoardGroup title={S.foundations.radius}>
          <div className="gf-radii">
            {RADII.map((step) => (
              <span key={step} className="gf-radius">
                <span
                  className="gf-radius-box"
                  style={{ borderRadius: `var(--ui-radius-${step})` }}
                />
                <span className="gf-caption gf-mono">{step}</span>
              </span>
            ))}
          </div>
          <div className="gf-borders">
            {(["border-w", "border-w-thick"] as const).map((name) => (
              <span key={name} className="gf-border-row">
                <span className="gf-border" style={{ borderTopWidth: `var(--ui-${name})` }} />
                <span className="gf-caption gf-mono">{name}</span>
              </span>
            ))}
          </div>
        </BoardGroup>
        <BoardGroup title={S.foundations.shadows}>
          <div className="gf-shadows">
            {SHADOWS.map((level) => (
              <span
                key={level}
                className="gf-shadow"
                style={{ boxShadow: `var(--ui-shadow-${level})` }}
              >
                <span className="gf-caption gf-mono">{level}</span>
              </span>
            ))}
          </div>
        </BoardGroup>
      </div>
    </div>
  );
}
