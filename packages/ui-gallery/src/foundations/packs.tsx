/**
 * Foundations › Theme packs: every pack's manifest (`pack.json`) as a table — its names in both
 * languages, what it builds on, its version, the theme API it targets, the swatches a picker draws
 * for each mode and the faces each font role puts first. The built-in packs come from the
 * registry (`BUILTIN_PACKS`), in its order, so a pack is listed the day it is registered; under
 * them, the packs an admin imported on the demo's server, read through the Web App's own wrapper
 * (`GET /api/themes`), as the appearance settings read them.
 *
 * The swatches are painted from the manifest's hex values, never from the page's CSS: a swatch is
 * what a picker shows before the pack's stylesheet is loaded.
 */
import { BUILTIN_PACKS, INITIAL_THEME_ID } from "@prismshadow/penguin-ui";
import type { ThemeModeName, ThemePackManifest } from "@prismshadow/penguin-ui";
import { useEffect, useState } from "react";
import { listThemePacks } from "../../../web/src/api/endpoints";
import { useGallery } from "../state";
import type { GalleryStrings } from "../strings";

const MODES: readonly ThemeModeName[] = ["light", "dark"];
const FONT_ROLES = ["sans", "ui", "cjk", "mono", "display"] as const;
type FontRole = (typeof FONT_ROLES)[number];

interface PackRow {
  pack: ThemePackManifest;
  imported: boolean;
}

const BUILTIN_ROWS: readonly PackRow[] = BUILTIN_PACKS.map((pack) => ({ pack, imported: false }));

/** The demo server's imported packs, once its answer is in; none until then or on a failure. */
function useImportedRows(): readonly PackRow[] {
  const [rows, setRows] = useState<readonly PackRow[]>([]);
  useEffect(() => {
    let live = true;
    listThemePacks()
      .then(({ themes }) => {
        if (live) setRows(themes.map((pack) => ({ pack, imported: true })));
      })
      .catch(() => {
        // The table lists the built-in packs on its own; an unanswered list adds no rows.
      });
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

/** What a pack builds on, in words: it is the base, it builds on Frost, or on the foundation. */
function baseWord(pack: ThemePackManifest, words: GalleryStrings["foundations"]["packs"]) {
  if (pack.id === INITIAL_THEME_ID) return words.isBase;
  return pack.base === "foundation" ? words.foundation : words.onFrost;
}

/** The faces a pack puts first, each once, with the roles that put it first. */
function faces(pack: ThemePackManifest): { family: string; roles: FontRole[] }[] {
  const out: { family: string; roles: FontRole[] }[] = [];
  for (const role of FONT_ROLES) {
    const family = pack.fonts[role];
    const face = out.find((entry) => entry.family === family);
    if (face) face.roles.push(role);
    else out.push({ family, roles: [role] });
  }
  return out;
}

function Swatch({ pack, mode }: { pack: ThemePackManifest; mode: ThemeModeName }) {
  const { S } = useGallery();
  const { canvas, ink, accent } = pack.swatches[mode];
  return (
    <span
      className="gp-swatch"
      style={{ background: canvas, color: ink }}
      data-tooltip={`${S.crumb.modes[mode]}: ${canvas} · ${ink} · ${accent}`}
    >
      Aa
      <span className="gp-swatch-accent" style={{ background: accent }} />
    </span>
  );
}

function Row({ row }: { row: PackRow }) {
  const { S, state } = useGallery();
  const words = S.foundations.packs;
  const { pack, imported } = row;
  const other = state.lang === "zh" ? pack.names.en : pack.names.zh;
  return (
    <tr>
      <th scope="row">
        <span className="gp-name">{pack.names[state.lang]}</span>
        <span className="gp-other">{other}</span>
        {imported && (
          <span className="gp-imported" data-tooltip={words.importedHint}>
            {words.imported}
          </span>
        )}
      </th>
      <td>{baseWord(pack, words)}</td>
      <td className="gf-mono">{pack.version}</td>
      <td className="gf-mono">{pack.api}</td>
      <td>
        <span className="gp-swatches">
          {MODES.map((mode) => (
            <Swatch key={mode} pack={pack} mode={mode} />
          ))}
        </span>
      </td>
      <td>
        {faces(pack).map((face) => (
          <span key={face.family} className="gp-face">
            <span>{face.family}</span>
            <span className="gp-roles">
              {face.roles.map((role) => words.fontRoles[role]).join(" · ")}
            </span>
          </span>
        ))}
      </td>
    </tr>
  );
}

export function PacksBoard() {
  const { S } = useGallery();
  const words = S.foundations.packs;
  const rows = [...BUILTIN_ROWS, ...useImportedRows()];
  return (
    <div className="gf-board">
      <p className="gf-note gf-muted">{words.intro}</p>
      <table className="gp-table">
        <thead>
          <tr>
            <th scope="col">{words.name}</th>
            <th scope="col">{words.base}</th>
            <th scope="col">{words.version}</th>
            <th scope="col">{words.api}</th>
            <th scope="col">{words.swatches}</th>
            <th scope="col">{words.fonts}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.pack.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
