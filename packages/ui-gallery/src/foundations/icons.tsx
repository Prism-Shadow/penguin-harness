/**
 * Foundations › Icons: every line icon the Web App declares (read from its source, see
 * lib/icon-registry.ts; W1 moves the registry into the package) drawn at the theme's stroke, cap and
 * join, grouped by the file that declares it, after the size rungs of `ICON_SIZE`. A path declared
 * under several names shows once, marked with its count — W1's deduplication list.
 */
import { WEB_ICON_SIZES, WEB_ICONS } from "../sources";
import { useGallery } from "../state";
import { BoardGroup, Glyph } from "./shared";

export function IconsBoard() {
  const { S } = useGallery();
  const sources = [...new Set(WEB_ICONS.map((icon) => icon.sources[0] ?? ""))];
  const sample =
    WEB_ICONS.find((icon) => icon.names.includes("GEAR_ICON"))?.d ?? WEB_ICONS[0]?.d ?? "";
  return (
    <div className="gf-board">
      <BoardGroup
        title={S.foundations.iconSizes}
        aside={S.foundations.iconRegistry(WEB_ICONS.length, sources.length)}
      >
        <div className="gf-icon-sizes">
          {WEB_ICON_SIZES.map(({ name, px }) => (
            <span key={name} className="gf-icon-size" title={`ICON_SIZE.${name}`}>
              <Glyph d={sample} size={px} />
              <span className="gf-caption gf-mono">
                {name} {px}
              </span>
            </span>
          ))}
        </div>
      </BoardGroup>
      {sources.map((source) => {
        const icons = WEB_ICONS.filter((icon) => icon.sources[0] === source);
        return (
          <BoardGroup
            key={source}
            title={<span className="gf-mono">{source}</span>}
            aside={icons.length}
          >
            <div className="gf-icon-grid">
              {icons.map((icon) => (
                <span
                  key={icon.d}
                  className="gf-icon"
                  title={`${icon.names.join("\n")}\n— ${icon.sources.join(", ")}`}
                >
                  <Glyph d={icon.d} size={16} />
                  <span className="gf-caption gf-mono gf-icon-name">
                    {icon.names[0]?.replace(/_ICONS?$/, "").replace(/^[A-Z_]+ICONS\./, "")}
                  </span>
                  {icon.names.length > 1 && (
                    <span className="gf-caption gf-icon-dupes" title={S.foundations.duplicateNames}>
                      ×{icon.names.length}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </BoardGroup>
        );
      })}
    </div>
  );
}
