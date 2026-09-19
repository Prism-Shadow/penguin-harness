/**
 * `/screens/settings` — the settings dialog over the running chat: the paged dialog's grouped
 * rail (Personal / Server) on Appearance, its preference rows — segmented controls, the accent
 * swatches, switches — and the "?" of Tool short names opened as a floating panel, the surface Frost
 * frosts through `.ui-glass`.
 *
 * The pieces that carry a hook take their host's name (hooks.ts, Appendix B): `Modal` owns the
 * glass of the dialog card, `FloatingPanel` the glass of the popover, and the rail's group titles
 * are the `PagedDialog`'s eyebrows.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FixtureLang, Fixtures } from "../fixtures";
import { ChatTranscript } from "./chat";
import { Glyph } from "./glyph";
import type { GlyphName } from "./glyph";
import { ChatHeader, NEUTRAL_FILL, Segmented, Sidebar } from "./parts";
import { Composer } from "./transcript";

type PageKey = keyof Fixtures["copy"]["settings"]["pages"];

const RAIL: ReadonlyArray<{
  group: "groupPersonal" | "groupServer";
  pages: readonly [PageKey, GlyphName][];
}> = [
  {
    group: "groupPersonal",
    pages: [
      ["profile", "user"],
      ["general", "settings"],
      ["appearance", "sun"],
      ["account", "shieldUser"],
    ],
  },
  {
    group: "groupServer",
    pages: [
      ["proxy", "globe"],
      ["uploads", "upload"],
      ["company", "building"],
      ["users", "users"],
    ],
  },
];

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${
        on ? "bg-accent" : `${NEUTRAL_FILL} ring-1 ring-inset ring-line`
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full border border-line bg-tone-neutral-emphasis-fg shadow-sm ${
          on ? "translate-x-[1.125rem]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

/** The popover a "?" opens: a transient layer over the dialog, which is where glass belongs. */
function FloatingPanel({ children }: { children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className="ui-glass absolute left-0 top-[calc(100%+0.25rem)] z-10 w-80 rounded-md border border-line bg-overlay px-3 py-2 text-xs leading-relaxed text-fg-muted shadow-lg"
    >
      {children}
    </div>
  );
}

function PrefRow({
  label,
  info,
  children,
  popover,
}: {
  label: string;
  info: string;
  children: ReactNode;
  popover?: string;
}) {
  return (
    <div className="relative flex items-center justify-between gap-4 py-3.5 first:pt-0">
      <p className="flex items-center gap-1.5 text-sm font-(--ui-weight-medium) text-fg">
        {label}
        <span title={info} className={popover ? "text-fg" : "text-fg-subtle"}>
          <Glyph name="help" size={14} />
        </span>
      </p>
      <div className="shrink-0">{children}</div>
      {popover && <FloatingPanel>{popover}</FloatingPanel>}
    </div>
  );
}

/** The dialog card itself: the one surface over the page, and the only glass in this screen. */
function Modal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="ui-glass flex h-[min(40rem,85vh)] w-full max-w-3xl overflow-hidden rounded-lg border border-line bg-overlay shadow-xl"
    >
      {children}
    </div>
  );
}

function PagedDialog({ f }: { f: Fixtures }) {
  const c = f.copy.settings;
  return (
    <Modal label={c.title}>
      <nav className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3">
        {RAIL.map(({ group, pages }, gi) => (
          <div key={group} className={gi > 0 ? "mt-3" : ""}>
            <p className="ui-eyebrow px-2.5 pb-1 text-xs font-(--ui-weight-medium) text-fg-muted">
              {c[group]}
            </p>
            {pages.map(([key, glyph]) => (
              <span
                key={key}
                className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm ${
                  key === "appearance"
                    ? "bg-accent-muted font-(--ui-weight-medium) text-fg"
                    : "text-fg-muted"
                }`}
              >
                <span className="text-fg-subtle">
                  <Glyph name={glyph} size={15} />
                </span>
                <span className="min-w-0 truncate">{c.pages[key]}</span>
              </span>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-6 pt-5">
          {/* The rail already names the page with its glyph; the title needs no second one. */}
          <h2 className="text-lg font-(--ui-weight-strong) text-fg">{c.pages.appearance}</h2>
          <span
            role="button"
            aria-label={c.close}
            title={c.close}
            className="flex h-7 w-7 items-center justify-center rounded-control text-fg-subtle hover:text-fg"
          >
            <Glyph name="cross" size={14} />
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          <div className="divide-y divide-line-muted">
            <PrefRow label={c.theme} info={c.themeInfo}>
              <Segmented options={[c.light, c.dark, c.system]} value={2} />
            </PrefRow>
            <PrefRow label={c.terminalTheme} info={c.terminalThemeInfo}>
              <Segmented options={[c.followApp, c.light, c.dark]} value={0} />
            </PrefRow>
            <PrefRow label={c.fontSize} info={c.fontSizeInfo}>
              <Segmented options={[c.fontSizes.sm, c.fontSizes.md, c.fontSizes.lg]} value={1} />
            </PrefRow>
            <PrefRow label={c.accent} info={c.accentInfo}>
              <div className="flex items-center gap-1.5">
                {f.forms.swatches.map((swatch, i) => (
                  <span
                    key={swatch.id}
                    title={swatch.label}
                    aria-label={swatch.label}
                    style={{ background: swatch.color }}
                    className={`h-5 w-5 rounded-full border border-line ${
                      i === 0 ? "ring-2 ring-line-emphasis ring-offset-2 ring-offset-overlay" : ""
                    }`}
                  />
                ))}
              </div>
            </PrefRow>
            <PrefRow label={c.launcher} info={c.launcherInfo}>
              <Switch on />
            </PrefRow>
            <PrefRow label={c.toolAliases} info={c.toolAliasesInfo} popover={c.toolAliasesInfo}>
              <Switch on={false} />
            </PrefRow>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function SettingsScreen({ lang }: { lang: FixtureLang }) {
  const f = fixturesFor(lang);
  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-canvas text-fg">
      <Sidebar f={f} activeSessionId={f.session.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={f} dock="none" />
        <main className="flex min-h-0 flex-1 flex-col">
          <ChatTranscript f={f} />
          <Composer f={f} />
        </main>
      </div>
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--ui-overlay-backdrop)] p-4">
        <PagedDialog f={f} />
      </div>
    </div>
  );
}
