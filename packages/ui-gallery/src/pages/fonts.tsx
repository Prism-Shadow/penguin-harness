/**
 * `/fonts`, `/fonts/specimens`, `/fonts/licences` — the 字体 section, three pages under one nav:
 *
 * - Defaults: each theme's default Latin, CJK and mono face as the package states them
 *   (lib/theme-fonts.ts), the active theme's row marked; then the pairing chosen in the top bar
 *   and the faces actually rendering (the readout).
 * - Specimens: each theme's families, resolved from its tokens, set in an en and a zh paragraph
 *   at the five text sizes; then the `@font-face` rules the page's styles declare, one row per
 *   family, weight and style, with the number of `unicode-range` slices and their load status.
 * - Licences: the licence texts under the package's `fonts/LICENSES/`.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FontReadoutLine } from "../chrome/font-readout";
import { FontsNav } from "../chrome/sidenav";
import { Site } from "../chrome/site";
import { SPECIMENS } from "../foundations/specimens";
import type { FontsPageId } from "../lib/routes";
import { isSystemFont, themeFontRows } from "../lib/theme-fonts";
import { fontLabel, TEXT_SIZE_PX_NUMBER, TEXT_SIZES } from "../lib/themes";
import { FONT_LICENSES, licencePath } from "../sources";
import { useGallery } from "../state";
import { useText } from "../text";

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

/** The section frame the three pages share. */
function FontsSite({
  page,
  title,
  children,
}: {
  page: FontsPageId;
  title: string;
  children: ReactNode;
}) {
  const { S } = useGallery();
  return (
    <Site
      page="fonts"
      nav={(onNavigate) => <FontsNav activeId={page} {...(onNavigate ? { onNavigate } : {})} />}
      wide
    >
      <article className="g-doc g-doc-wide">
        <header className="g-doc-head">
          <p className="g-eyebrow">{S.site.fonts}</p>
          <h1 className="g-h1">{title}</h1>
        </header>
        {children}
      </article>
    </Site>
  );
}

function DefaultsPage() {
  const { S, state } = useGallery();
  const text = useText();
  const face = (name: string) => (isSystemFont(name) ? S.fonts.system : name);
  const words = { theme: S.rail.fontTheme, system: S.rail.fontSystem };
  const active = text.theme(state.theme);
  const choice = (id: string, label: string) =>
    id === "theme" ? S.fonts.followsTheme(active) : label;

  useEffect(() => {
    void document.fonts.ready.then(() => {
      document.documentElement.dataset.galleryReady = "1";
    });
  }, []);

  return (
    <FontsSite page="defaults" title={S.fonts.defaultsTitle}>
      <section id="defaults" className="g-section">
        <p className="g-section-lead">{S.fonts.defaultsHint}</p>
        <table className="g-table g-fonts-table">
          <thead>
            <tr>
              <th>{S.rail.theme}</th>
              <th>{S.readout.latin}</th>
              <th>{S.readout.cjk}</th>
              <th>{S.readout.mono}</th>
            </tr>
          </thead>
          <tbody>
            {themeFontRows().map((row) => (
              <tr key={row.theme} aria-current={row.theme === state.theme ? "true" : undefined}>
                <th scope="row">{text.theme(row.theme)}</th>
                <td>{face(row.latin)}</td>
                <td>{face(row.cjk)}</td>
                <td>{face(row.mono)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="current" className="g-section">
        <h2 className="g-h2">{S.fonts.current}</h2>
        <p className="g-section-lead">{S.fonts.currentHint}</p>
        <dl className="g-fonts-current">
          <div>
            <dt>{S.rail.fontLatin}</dt>
            <dd>{choice(state.latin, fontLabel(state.latin, words))}</dd>
          </div>
          <div>
            <dt>{S.rail.fontCjk}</dt>
            <dd>{choice(state.cjk, fontLabel(state.cjk, words))}</dd>
          </div>
        </dl>
        <FontReadoutLine />
      </section>
    </FontsSite>
  );
}

function SpecimensPage() {
  const { S, mode, tokens } = useGallery();
  const text = useText();
  const faces = useFaces();

  useEffect(() => {
    if (!tokens) return;
    void document.fonts.ready.then(() => {
      document.documentElement.dataset.galleryReady = "1";
    });
  }, [tokens]);

  return (
    <FontsSite page="specimens" title={S.fonts.specimensTitle}>
      <section id="specimens" className="g-section">
        <p className="g-section-lead">{S.fonts.specimensHint}</p>
        {!tokens && <p className="g-muted">{S.intro.resolving}</p>}
        {tokens &&
          THEME_IDS.map((themeId) => {
            const values = tokens[themeId][mode];
            return (
              <div key={themeId} className="g-font-theme">
                <h3>{text.theme(themeId)}</h3>
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
                        {TEXT_SIZES.map((size) => (
                          <div
                            key={size}
                            className="g-font-sample"
                            style={{
                              fontFamily: family || undefined,
                              fontSize: TEXT_SIZE_PX_NUMBER[size],
                            }}
                          >
                            <span className="g-font-size">{TEXT_SIZE_PX_NUMBER[size]}px</span>
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

      <section id="declared" className="g-section">
        <h2 className="g-h2">{S.fonts.declared}</h2>
        <p className="g-section-lead">{S.fonts.declaredHint}</p>
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
    </FontsSite>
  );
}

function LicencesPage() {
  const { S } = useGallery();
  const licences = Object.keys(FONT_LICENSES).sort();
  return (
    <FontsSite page="licences" title={S.fonts.licencesTitle}>
      <section id="licences" className="g-section">
        {licences.length === 0 ? (
          <p className="g-muted">{S.fonts.noLicences}</p>
        ) : (
          licences.map((path) => <Licence key={path} path={path} />)
        )}
      </section>
    </FontsSite>
  );
}

export function FontsPage({ page }: { page: FontsPageId }) {
  if (page === "specimens") return <SpecimensPage />;
  if (page === "licences") return <LicencesPage />;
  return <DefaultsPage />;
}
