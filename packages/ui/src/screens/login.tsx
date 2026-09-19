/**
 * `/screens/login` — the sign-in page: the language and light/dark switches in the corner, the
 * brand mark and the card with its two roomy (`base`) fields, the primary submit and the two
 * footnotes, over the circuit traces. Those traces are the page's one decoration in every theme —
 * the product's own brand element, drawn once and static (K-redesign §1.3 row 14).
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { FixtureLang, Fixtures } from "../fixtures";
import { Glyph } from "./glyph";
import { Segmented } from "./parts";

/**
 * The login background's circuit traces, reduced to a fixed drawing: thin orthogonal polylines
 * ending in a via, one per outer cell of a 3 × 3 grid so the centre stays clear for the card.
 */
const TRACES: ReadonlyArray<{ d: string; via: [number, number] }> = [
  { d: "M40 120H220V200H330", via: [330, 200] },
  { d: "M380 40V110H500", via: [500, 110] },
  { d: "M1400 90H1180V210H1080", via: [1080, 210] },
  { d: "M60 450H180V380H300", via: [300, 380] },
  { d: "M1390 470H1250V560H1130", via: [1130, 560] },
  { d: "M120 860V740H280V700", via: [280, 700] },
  { d: "M1000 880V800H880", via: [880, 800] },
  { d: "M1340 860V760H1200V720", via: [1200, 720] },
];

function Circuit() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full text-line"
    >
      {TRACES.map((t) => (
        <g key={t.d}>
          <path d={t.d} fill="none" stroke="currentColor" strokeWidth="1" />
          <circle
            cx={t.via[0]}
            cy={t.via[1]}
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </g>
      ))}
    </svg>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-sm font-(--ui-weight-medium) text-fg">
        {label}
        <span aria-hidden className="text-tone-danger-fg">
          *
        </span>
      </span>
      {children}
    </label>
  );
}

function Corner({ f }: { f: Fixtures }) {
  const a = f.copy.auth;
  const s = f.copy.settings;
  return (
    <div className="absolute right-4 top-4 flex items-center gap-2">
      <div aria-label={a.language}>
        <Segmented options={[a.langZh, a.langEn]} value={f.lang === "zh" ? 0 : 1} />
      </div>
      <div aria-label={s.theme}>
        <Segmented options={[s.light, s.dark, s.system]} value={2} />
      </div>
    </div>
  );
}

export function LoginScreen({
  lang,
  logoSrc = "/penguin-logo.svg",
}: {
  lang: FixtureLang;
  logoSrc?: string;
}) {
  const f = fixturesFor(lang);
  const a = f.copy.auth;
  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-canvas p-4 text-fg">
      <Circuit />
      <Corner f={f} />
      <div className="relative w-full max-w-sm">
        <img src={logoSrc} alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl" />
        <h1 className="ui-display mb-6 text-center text-3xl font-(--ui-weight-strong) tracking-tight text-fg">
          {f.copy.appName}
        </h1>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <Field label={a.username}>
              <span className="block w-full rounded-md border border-line-emphasis bg-surface px-3 py-2 text-base text-fg ring-2 ring-[var(--ui-accent-muted)]">
                {f.user.id}
                <span aria-hidden className="ml-px inline-block h-5 w-px translate-y-1 bg-fg" />
              </span>
            </Field>
            <Field label={a.password}>
              <span className="flex w-full items-center rounded-md border border-line-emphasis bg-surface px-3 py-2 text-base">
                <span className="min-w-0 flex-1 tracking-[0.2em] text-fg">••••••••••••</span>
                <span title={a.showPassword} className="text-fg-subtle">
                  <Glyph name="eye" size={15} />
                </span>
              </span>
            </Field>
            <span
              role="button"
              className="flex w-full items-center justify-center rounded-control border border-accent bg-accent px-3 py-2.5 text-sm font-(--ui-weight-medium) text-accent-fg"
            >
              {a.signIn}
            </span>
          </form>
          <p className="mt-4 text-center text-xs text-fg-subtle">{a.defaultAdminNote}</p>
          <p className="mt-1.5 text-center text-xs text-fg-subtle">{a.forgotAdminNote}</p>
        </div>
      </div>
    </div>
  );
}
