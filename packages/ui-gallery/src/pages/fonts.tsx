/**
 * `/fonts` — what the package's `fonts/` ships: each theme's families (resolved from its tokens)
 * set in an en and a zh paragraph at the three root sizes, the `@font-face` rules the page's styles
 * declare — one row per family, weight and style, with the number of `unicode-range` slices behind
 * it and their load status (MiSans alone declares ~200 slice faces) — and the licence texts under
 * `fonts/LICENSES/`.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { useEffect, useState } from "react";
import { ModeSwitch, ViewControls } from "../chrome/rail";
import { ChromeIcon } from "../chrome/icons";
import { SPECIMENS } from "../foundations/specimens";
import { BASE } from "../lib/location";
import { THEME_NAMES, TIER_PX } from "../lib/themes";
import { formatGalleryQuery } from "../lib/url-state";
import { FONT_LICENSES, licencePath } from "../sources";
import { useGallery } from "../state";

const ROLES = ["--ui-font-sans", "--ui-font-mono", "--ui-font-display", "--ui-font-cjk"] as const;

interface FaceRow {
  family: string;
  /** `400`, or a variable face's range `100 900`. */
  weight: string;
  style: string;
  /** How many `@font-face` rules (unicode-range slices) share this family, weight and style. */
  slices: number;
  status: Record<FontFaceLoadStatus, number>;
}

function useFaces(): FaceRow[] {
  const [faces, setFaces] = useState<FaceRow[]>([]);
  useEffect(() => {
    const read = () => {
      const rows = new Map<string, FaceRow>();
      document.fonts.forEach((face) => {
        const family = face.family.replace(/^["']|["']$/g, "");
        const key = `${family}|${face.weight}|${face.style}`;
        const row = rows.get(key) ?? {
          family,
          weight: face.weight,
          style: face.style,
          slices: 0,
          status: { unloaded: 0, loading: 0, loaded: 0, error: 0 },
        };
        row.slices++;
        row.status[face.status]++;
        rows.set(key, row);
      });
      setFaces(
        [...rows.values()].sort(
          (a, b) =>
            a.family.localeCompare(b.family) ||
            a.weight.localeCompare(b.weight, "en", { numeric: true }) ||
            a.style.localeCompare(b.style),
        ),
      );
    };
    read();
    document.fonts.addEventListener("loadingdone", read);
    void document.fonts.ready.then(read);
    return () => document.fonts.removeEventListener("loadingdone", read);
  }, []);
  return faces;
}

function Licence({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <details
      className="g-licence"
      onToggle={(event) => {
        const load = FONT_LICENSES[path];
        if ((event.target as HTMLDetailsElement).open && text === null && load)
          void load().then(setText);
      }}
    >
      <summary>{licencePath(path)}</summary>
      <pre className="g-code">{text ?? "…"}</pre>
    </details>
  );
}

export function FontsPage() {
  const { S, state, mode, tokens } = useGallery();
  const faces = useFaces();
  const licences = Object.keys(FONT_LICENSES).sort();
  const query = formatGalleryQuery({ ...state, variants: {} });

  useEffect(() => {
    if (!tokens) return;
    void document.fonts.ready.then(() => {
      document.documentElement.dataset.galleryReady = "1";
    });
  }, [tokens]);

  return (
    <div className="g-app">
      <div className="g-page g-chrome">
        <header className="g-page-head">
          <a className="g-icon-button" href={`${BASE}/${query}`} title={S.screens.back}>
            <ChromeIcon name="back" />
          </a>
          <h1>{S.fonts.title}</h1>
          <span className="g-page-head-controls">
            <ViewControls compact />
            <ModeSwitch />
          </span>
        </header>

        <section className="g-page-section">
          <h2>{S.fonts.specimens}</h2>
          <p className="g-muted">{S.fonts.specimensHint}</p>
          {!tokens && <p className="g-muted">{S.intro.resolving}</p>}
          {tokens &&
            THEME_IDS.map((themeId) => {
              const values = tokens[themeId][mode];
              return (
                <div key={themeId} className="g-font-theme">
                  <h3>{THEME_NAMES[themeId]}</h3>
                  {ROLES.map((role) => {
                    const family = values[role];
                    return (
                      <div key={role} className="g-font-role">
                        <div className="g-font-role-meta">
                          <code>{role}</code>
                          <span className="g-muted" data-unset={!family || undefined}>
                            {family || S.section.unset}
                          </span>
                        </div>
                        <div className="g-font-samples">
                          {(Object.keys(TIER_PX) as (keyof typeof TIER_PX)[]).map((tier) => (
                            <div
                              key={tier}
                              className="g-font-sample"
                              style={{ fontFamily: family || undefined, fontSize: TIER_PX[tier] }}
                            >
                              <span className="g-font-size">{TIER_PX[tier]}px</span>
                              {(["en", "zh"] as const).map((lang) => (
                                <p key={lang} lang={lang === "zh" ? "zh-CN" : "en"}>
                                  {role === "--ui-font-mono"
                                    ? SPECIMENS[lang].code
                                    : SPECIMENS[lang].paragraph}
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </section>

        <section className="g-page-section">
          <h2>{S.fonts.declared}</h2>
          <p className="g-muted">{S.fonts.declaredHint}</p>
          {faces.length === 0 ? (
            <p className="g-muted">{S.fonts.noFaces}</p>
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>{S.fonts.family}</th>
                  <th>{S.fonts.weight}</th>
                  <th>{S.fonts.slicesColumn}</th>
                  <th>{S.fonts.loadStatus}</th>
                </tr>
              </thead>
              <tbody>
                {faces.map((face) => (
                  <tr key={`${face.family}|${face.weight}|${face.style}`}>
                    <td
                      style={{
                        fontFamily: `"${face.family}"`,
                        fontWeight: face.weight.split(" ")[0],
                      }}
                    >
                      {face.family}
                    </td>
                    <td>
                      <code>
                        {face.weight}
                        {face.style !== "normal" ? ` ${face.style}` : ""}
                      </code>
                    </td>
                    <td className="g-num-cell">{face.slices}</td>
                    <td className="g-muted">
                      {(Object.keys(face.status) as FontFaceLoadStatus[])
                        .filter((status) => face.status[status] > 0)
                        .map((status) => `${S.fonts.status[status]} ${face.status[status]}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="g-page-section">
          <h2>{S.fonts.licences}</h2>
          {licences.length === 0 ? (
            <p className="g-muted">{S.fonts.noLicences}</p>
          ) : (
            licences.map((path) => <Licence key={path} path={path} />)
          )}
        </section>
      </div>
    </div>
  );
}
