/**
 * Foundations › Icons: every icon of the shared registry (read from its source, see
 * lib/icon-registry.ts) drawn by the package's own renderer, `GlyphIcon`, grouped by the file that
 * declares it, after the size rungs of `ICON_SIZE`, and then the marks drawn as components. Each
 * registry glyph and each mark is drawn in every icon set and the theme shows its own, so
 * switching the theme switches the set: Primer's line drawings, Frost's line drawings with their
 * duotone bodies, Console's pixel drawings. A path declared under several names shows once,
 * marked with its count; a fragment the entries are composed from is not a glyph and stays a line.
 */
import type { ReactElement } from "react";
import {
  CheckIcon,
  Chevron,
  ChevronDown,
  CloseIcon,
  DownloadIcon,
  GlyphIcon,
  PlusIcon,
  UploadIcon,
} from "@prismshadow/penguin-ui";
import { WEB_ICON_SIZES, WEB_ICONS } from "../sources";
import { useGallery } from "../state";
import { BoardGroup } from "./shared";

/** The marks drawn as components, by the key the icon sets name them under. */
const MARKS: readonly { key: string; mark: ReactElement }[] = [
  { key: "caret", mark: <ChevronDown size={16} /> },
  { key: "check", mark: <CheckIcon size={16} /> },
  { key: "plus", mark: <PlusIcon size={16} /> },
  { key: "download", mark: <DownloadIcon size={16} /> },
  { key: "upload", mark: <UploadIcon size={16} /> },
  { key: "close", mark: <CloseIcon size={16} /> },
  { key: "chevron", mark: <Chevron open={false} size={16} /> },
];

export function IconsBoard() {
  const { S } = useGallery();
  const sources = [...new Set(WEB_ICONS.map((icon) => icon.sources[0] ?? ""))];
  const sample =
    WEB_ICONS.find((icon) => icon.names.includes("ICONS.gear"))?.d ?? WEB_ICONS[0]?.d ?? "";
  return (
    <div className="gf-board">
      <BoardGroup
        title={S.foundations.iconSizes}
        aside={S.foundations.iconRegistry(WEB_ICONS.length, sources.length)}
      >
        <div className="gf-icon-sizes">
          {WEB_ICON_SIZES.map(({ name, px }) => (
            <span key={name} className="gf-icon-size" data-tooltip={`ICON_SIZE.${name}`}>
              <GlyphIcon d={sample} size={px} />
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
                  data-tooltip={`${icon.names.join("\n")}\n— ${icon.sources.join(", ")}`}
                >
                  <GlyphIcon d={icon.d} size={16} />
                  <span className="gf-caption gf-mono gf-icon-name">
                    {icon.names[0]?.replace(/_ICONS?$/, "").replace(/^(?:[A-Z_]+_)?ICONS\./, "")}
                  </span>
                  {icon.names.length > 1 && (
                    <span
                      className="gf-caption gf-icon-dupes"
                      data-tooltip={S.foundations.duplicateNames}
                    >
                      ×{icon.names.length}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </BoardGroup>
        );
      })}
      <BoardGroup title={S.foundations.iconMarks} aside={MARKS.length}>
        <div className="gf-icon-grid">
          {MARKS.map(({ key, mark }) => (
            <span key={key} className="gf-icon">
              {mark}
              <span className="gf-caption gf-mono gf-icon-name">{key}</span>
            </span>
          ))}
        </div>
      </BoardGroup>
    </div>
  );
}
