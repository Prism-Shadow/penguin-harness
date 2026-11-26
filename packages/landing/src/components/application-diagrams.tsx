import { useEffect, useState, type CSSProperties } from "react";
import { ImageIcon, SiteGlyph, type SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { AppIconShape } from "../../../ui/src/components/icons/app-icon-shape/app-icon-shape";
import { Spinner } from "../../../ui/src/components/icons/spinner/spinner";
import { sessionToolArt } from "../../../ui/src/components/icons/glyph-app-icon/session-tool-art";
import slidesIcon from "../../../../plugins/use-bento-slides/workbenches/slides/ui/icon.svg";
import imagesIcon from "../../../../plugins/multimodal-tools/workbenches/images/ui/icon.svg";
import supportIcon from "../../../../plugins/penguin-support/workbenches/support/ui/icon.svg";
// The pinned package exports no workbench files, so its icon is read by path.
import benchmarkIcon from "../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/ui/icon.svg";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";
import { useWidth } from "../lib/use-width";
import { S } from "../lib/strings";
import "./application-diagrams.css";

export function ScreenBar({ icon, title }: { icon: SiteGlyphName; title: string }) {
  return (
    <div className="scene-bar">
      <span className="scene-title">
        <SiteGlyph name={icon} width={19} height={19} />
        {title}
      </span>
    </div>
  );
}

/** A glyph on a two-colour field: the tile the product draws for a system app. */
function glyphTile(glyph: SiteGlyphName, from: string, to: string) {
  return { glyph, from, to };
}

/**
 * Every app the demo project holds, each with an icon of its own, as an app in the App Center has:
 * a shipped workbench and the session tools wear their artwork, the start dashboard's three
 * builder examples their glyph tiles, and every other app a glyph for what it does on a
 * two-colour field, the way the product draws its system apps.
 */
const appTiles = {
  models: glyphTile("chip", "violet", "blue"),
  plugins: glyphTile("puzzle", "pink", "red"),
  evolution: benchmarkIcon,
  docs: <SiteGlyph name="bookOpen" />,
  investment: <SiteGlyph name="barChart" />,
  legal: <SiteGlyph name="file" />,
  slides: slidesIcon,
  images: imagesIcon,
  support: supportIcon,
  expenses: glyphTile("coin", "amber", "orange"),
  terminal: sessionToolArt.get("session-tools-terminal"),
  browser: sessionToolArt.get("session-tools-builtin-browser"),
  machines: glyphTile("server", "teal", "blue"),
  usage: glyphTile("barChart", "green", "teal"),
  meetings: glyphTile("microphone", "blue", "violet"),
  data: glyphTile("database", "teal", "green"),
  board: glyphTile("kanban", "violet", "pink"),
  review: glyphTile("angleBrackets", "slate", "blue"),
  mail: glyphTile("paperPlane", "blue", "teal"),
  sales: glyphTile("dashboard", "orange", "red"),
  hiring: glyphTile("users", "pink", "violet"),
  translate: glyphTile("globe", "teal", "blue"),
  planner: glyphTile("calendar", "red", "orange"),
  competitor: glyphTile("eye", "violet", "blue"),
  inventory: glyphTile("archive", "amber", "orange"),
  weekly: glyphTile("penLine", "green", "teal"),
  monitor: glyphTile("pulse", "red", "pink"),
  quotes: glyphTile("percent", "green", "blue"),
  audit: glyphTile("shieldCheck", "blue", "slate"),
  alerts: glyphTile("bell", "orange", "amber"),
  tutor: glyphTile("lightbulb", "amber", "red"),
  contracts: glyphTile("rectangleCheck", "slate", "violet"),
};

type AppKey = keyof typeof appTiles;

/**
 * The apps already on the home screen when a run opens, in home-screen order. A run shows as many
 * of them as leave room for the generated ones, so the list must fill the widest screen.
 */
const INSTALLED_APPS: readonly AppKey[] = [
  "models",
  "plugins",
  "evolution",
  "docs",
  "investment",
  "legal",
  "slides",
  "images",
  "support",
  "expenses",
  "terminal",
  "browser",
  "machines",
  "usage",
  "meetings",
  "data",
  "board",
  "review",
  "mail",
  "sales",
  "hiring",
  "translate",
  "planner",
];

/** What a run generates, one sentence each, in the order the demo asks for them. */
const GENERATED_APPS = [
  "competitor",
  "inventory",
  "weekly",
  "monitor",
  "quotes",
  "audit",
  "alerts",
  "tutor",
  "contracts",
] as const satisfies readonly AppKey[];

/** The name under a tile. The workbench the next section shows is one of the system apps. */
function appName(app: AppKey): string {
  return app === "evolution" ? S.selfImprove.workbench.title : S.cases.workspace.apps[app];
}

/** Edge of a home-screen icon, and of the ring a building app wears just outside it, in px. */
const ICON_PX = 56;
const RING_PX = ICON_PX + 12;
const RING_RADIUS = (RING_PX - 2) / 2;
/** The arc's share of the ring, as the product's install ring draws it. */
const RING_ARC = 0.28;

function AppMark({ app }: { app: AppKey }) {
  const art = appTiles[app];
  if (typeof art === "string")
    return (
      <AppIconShape size={ICON_PX} aria-hidden className="scene-app-mark">
        <ImageIcon
          icon={{ url: art, tint: false }}
          size={ICON_PX}
          fallback={<SiteGlyph name="layoutGrid" />}
        />
      </AppIconShape>
    );
  if (typeof art === "object" && art !== null && "from" in art)
    return (
      <AppIconShape
        size={ICON_PX}
        aria-hidden
        className="scene-app-mark scene-app-system"
        style={
          {
            "--system-from": `var(--ui-icon-tint-${art.from})`,
            "--system-to": `var(--ui-icon-tint-${art.to})`,
          } as CSSProperties
        }
      >
        <SiteGlyph name={art.glyph} />
      </AppIconShape>
    );
  return (
    <AppIconShape size={ICON_PX} aria-hidden className={`scene-app-mark scene-app-${app}`}>
      {art}
    </AppIconShape>
  );
}

/** The grid's narrowest column and its gutter, in px: the App Center's own. */
const COLUMN_PX = 112;
const GUTTER_PX = 16;
/** The room the home screen keeps clear on each side of its grid, in px. */
const STAGE_INSET_PX = 24;
/** A phone's three columns at the least, and no more than the installed list can fill. */
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 8;
const ROWS = 4;

/** A new sentence is sent this often: time to read it being typed and to see its app appear. */
const SEND_MS = 2000;
/** How long an app builds: a little over one send, so one or two are building at a time. */
const BUILD_MS = 2800;
/** The full screen rests this long, then the generated apps leave and the run starts over. */
const REST_MS = 3200;
const LEAVE_MS = 500;

/**
 * The Harness OS App Center, drawn after the product's own page: its header and actions, its home
 * screen of icon-and-name tiles, and a composer docked under it. A run types one sentence after
 * another into the composer; each becomes an app that builds under the install ring and joins the
 * home screen, until the generated apps have filled it. The screen rests, the generated apps
 * leave, and the run starts over. The count beside the title is the number of installed apps.
 */
export function AppGenerationDiagram() {
  const c = S.cases.workspace;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = active && !reduced;
  // As many columns as fit at the product's tile width: the tiles keep their size at every width.
  const { ref: stage, width } = useWidth<HTMLDivElement>(1100);
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(
      MIN_COLUMNS,
      Math.floor((width - 2 * STAGE_INSET_PX + GUTTER_PX) / (COLUMN_PX + GUTTER_PX)),
    ),
  );
  // The generated apps take the last places on the screen, so a finished run fills it exactly.
  const opening = columns * ROWS - GENERATED_APPS.length;

  /** Sentences sent in this run, the apps still building, and whether the run is being cleared. */
  const [sent, setSent] = useState(0);
  const [building, setBuilding] = useState<readonly number[]>([]);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reset = () => {
      setSent(0);
      setBuilding([]);
      setLeaving(false);
    };
    reset();
    if (!running) return;
    const timers = new Set<number>();
    const after = (ms: number, run: () => void) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        run();
      }, ms);
      timers.add(timer);
    };
    const start = () => {
      reset();
      GENERATED_APPS.forEach((_, turn) => {
        const at = (turn + 1) * SEND_MS;
        after(at, () => {
          setSent(turn + 1);
          setBuilding((list) => [...list, turn]);
        });
        after(at + BUILD_MS, () => setBuilding((list) => list.filter((item) => item !== turn)));
      });
      const done = GENERATED_APPS.length * SEND_MS + BUILD_MS + REST_MS;
      after(done, () => setLeaving(true));
      after(done + LEAVE_MS, start);
    };
    start();
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [running]);

  // Still, the run is finished: the screen is full and everything on it is installed.
  const shown = reduced ? GENERATED_APPS.length : sent;
  const installed = opening + (leaving ? 0 : shown - building.length);
  // The sentence being typed is the one the next app will come from; a finished run keeps its last.
  const asking = GENERATED_APPS[Math.min(shown, GENERATED_APPS.length - 1)]!;
  const apps = [...INSTALLED_APPS.slice(0, opening), ...GENERATED_APPS.slice(0, shown)];
  // Between the first sentence and the last install the composer says it is generating.
  const working = running && !leaving && (shown < GENERATED_APPS.length || building.length > 0);

  return (
    <div
      ref={ref}
      className="product-scene product-scene-apps"
      data-story-diagram=""
      data-active={running}
      role="group"
      aria-label={c.title}
    >
      <div className="scene-app-header">
        <span className="scene-app-title">
          {c.title}
          <span className="scene-count" data-app-count="">
            <span key={installed} className="scene-count-value">
              {installed}
            </span>
          </span>
        </span>
        <span className="scene-app-actions" aria-hidden="true">
          <span className="scene-app-action">
            <SiteGlyph name="folderPlus" width={14} height={14} />
            {c.newFolder}
          </span>
          <span className="scene-app-action scene-app-action-primary">
            <SiteGlyph name="sparkles" width={14} height={14} />
            {c.createWithAi}
          </span>
        </span>
      </div>
      <div
        ref={stage}
        className="scene-os-stage"
        style={{ "--scene-columns": columns, "--scene-rows": ROWS } as CSSProperties}
      >
        <ul className="scene-launcher" aria-label={c.title}>
          {apps.map((app, index) => {
            const turn = index - opening;
            const generated = running && turn >= 0;
            const state = !generated
              ? "installed"
              : leaving
                ? "leaving"
                : building.includes(turn)
                  ? "building"
                  : "landed";
            return (
              <li
                key={app}
                data-app-state={state}
                style={
                  {
                    "--tile-column": index % columns,
                    "--tile-row": Math.floor(index / columns),
                  } as CSSProperties
                }
              >
                <span className="scene-app-slot">
                  {state === "landed" && <span className="scene-app-ripple" aria-hidden="true" />}
                  <AppMark app={app} />
                  {generated && (
                    <svg
                      className="scene-install-ring"
                      viewBox={`0 0 ${RING_PX} ${RING_PX}`}
                      width={RING_PX}
                      height={RING_PX}
                      aria-hidden="true"
                    >
                      <circle cx={RING_PX / 2} cy={RING_PX / 2} r={RING_RADIUS} />
                      <circle
                        cx={RING_PX / 2}
                        cy={RING_PX / 2}
                        r={RING_RADIUS}
                        pathLength={1}
                        strokeDasharray={`${RING_ARC} 1`}
                      />
                    </svg>
                  )}
                </span>
                <span className="scene-app-label">{appName(app)}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="scene-composer-dock" aria-hidden="true">
        <div className="scene-composer">
          <span className="scene-composer-text" key={asking}>
            {c.prompts[asking]}
          </span>
          <div className="scene-composer-row">
            <span className="scene-composer-chip">
              <SiteGlyph name="robot" width={13} height={13} />
              {c.builderLabel}
            </span>
            <span className="scene-composer-status">
              {working ? (
                <>
                  <Spinner className="scene-activity" label={c.generating} />
                  {c.generating}
                </>
              ) : (
                <>
                  <SiteGlyph name="check" width={13} height={13} />
                  {c.installing}
                </>
              )}
            </span>
            <span className="scene-composer-send">
              <SiteGlyph name="arrowUp" width={14} height={14} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
