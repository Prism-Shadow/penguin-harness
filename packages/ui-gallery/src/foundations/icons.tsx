/**
 * Foundations › Icons: every line icon the Web App declares (read from its source, see
 * lib/icon-registry.ts; W1 moves the registry into the package) drawn at the theme's stroke, cap and
 * join, grouped by the file that declares it, after the size rungs of `ICON_SIZE`. A path spelled
 * out under several names shows once, marked with its count — W1's deduplication list; an alias
 * (a lookup table pointing at the one constant) is a name in the tooltip, not a duplicate. Icons
 * drawn inline in JSX carry no constant name, so the aside says how many were left unread.
 */
import { WEB_ICON_FILES, WEB_ICON_SIZES, WEB_ICONS, WEB_ICONS_UNREAD } from "../sources";
import { useGallery } from "../state";
import { BoardGroup, Glyph } from "./shared";

export function IconsBoard() {
  const { S } = useGallery();
  const sources = WEB_ICON_FILES;
  // The size rungs are drawn with one known icon: a rename fails the board rather than swapping
  // the sample for whatever sorts first.
  const sample = WEB_ICONS.find((icon) => icon.names.includes("GEAR_ICON"));
  if (!sample) throw new Error("the icon registry has no GEAR_ICON to draw the size rungs with");
  return (
    <div className="gf-board">
      <BoardGroup
        title={S.foundations.iconSizes}
        aside={
          WEB_ICONS_UNREAD > 0
            ? `${S.foundations.iconRegistry(WEB_ICONS.length, sources.length)} · ${S.foundations.iconsUnread(WEB_ICONS_UNREAD)}`
            : S.foundations.iconRegistry(WEB_ICONS.length, sources.length)
        }
      >
        <div className="gf-icon-sizes">
          {WEB_ICON_SIZES.map(({ name, px }) => (
            <span key={name} className="gf-icon-size" title={`ICON_SIZE.${name}`}>
              <Glyph d={sample.d} size={px} />
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
                  {icon.declaredNames.length > 1 && (
                    <span className="gf-caption gf-icon-dupes" title={S.foundations.duplicateNames}>
                      ×{icon.declaredNames.length}
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
