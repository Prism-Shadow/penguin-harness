import { useEffect, useState, type CSSProperties } from "react";
import { ImageIcon, SiteGlyph, type SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { AppIconShape } from "../../../ui/src/components/icons/app-icon-shape/app-icon-shape";
import { Spinner } from "../../../ui/src/components/icons/spinner/spinner";
import { sessionToolArt } from "../../../ui/src/components/icons/glyph-app-icon/session-tool-art";
import slidesIcon from "../../../../plugins/use-bento-slides/workbenches/slides/ui/icon.svg";
import imagesIcon from "../../../../plugins/multimodal-tools/workbenches/images/ui/icon.svg";
import supportIcon from "../../../../plugins/penguin-support/workbenches/support/ui/icon.svg";
import benchmarkIcon from "../../../../plugins/agent-evaluation/workbenches/benchmark/ui/icon.svg";
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

/** A system app's tile: its page's glyph on the two-colour field the product gives that app. */
function systemTile(glyph: SiteGlyphName, from: string, to: string) {
  return { glyph, from, to };
}

/**
 * Every app the demo project can hold, drawn the way the App Center draws each kind: a system app
 * wears its glyph on its own colour field, a shipped workbench and the session tools their own
 * artwork, the start dashboard's three builder examples their glyph tiles, and an app with no
 * icon of its own (`null`) the first letter of its name on a tinted tile.
 */
const appTiles = {
  models: systemTile("chip", "violet", "blue"),
  plugins: systemTile("puzzle", "pink", "red"),
  machines: systemTile("server", "teal", "blue"),
  usage: systemTile("barChart", "green", "teal"),
  evolution: benchmarkIcon,
  docs: <SiteGlyph name="bookOpen" />,
  investment: <SiteGlyph name="barChart" />,
  legal: <SiteGlyph name="file" />,
  slides: slidesIcon,
  images: imagesIcon,
  support: supportIcon,
  expenses: null,
  terminal: sessionToolArt.get("session-tools-terminal"),
  browser: sessionToolArt.get("session-tools-builtin-browser"),
  meetings: null,
  data: null,
  board: null,
  review: null,
  mail: null,
  sales: null,
  hiring: null,
  translate: null,
  planner: null,
  competitor: null,
  inventory: null,
  weekly: null,
  monitor: null,
  quotes: null,
  audit: null,
  alerts: null,
  tutor: null,
  contracts: null,
  trips: null,
  followup: null,
  budget: null,
  invoices: null,
  quiz: null,
  assets: null,
  roster: null,
};

type AppKey = keyof typeof appTiles;

/**
 * The apps the home screen opens on, in home-screen order. The first twelve are what the
 * narrowest screen shows at rest.
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
];

/**
 * What one sentence can generate, in the order the demo asks for it. System apps and the session
 * tools ship with the product, so they are never generated. The list repeats, so it must stay
 * longer than the widest screen shows at once, and the apps the screen opens on come last: an app
 * must have scrolled away before its name comes round again.
 */
const GENERATED_APPS = [
  "meetings",
  "data",
  "board",
  "review",
  "mail",
  "sales",
  "hiring",
  "translate",
  "planner",
  "competitor",
  "inventory",
  "weekly",
  "monitor",
  "quotes",
  "audit",
  "alerts",
  "tutor",
  "contracts",
  "trips",
  "followup",
  "budget",
  "invoices",
  "quiz",
  "assets",
  "roster",
  "docs",
  "investment",
  "legal",
  "slides",
  "images",
  "support",
  "expenses",
] as const satisfies readonly AppKey[];

type GeneratedAppKey = (typeof GENERATED_APPS)[number];

/** The app in a home-screen position: the opening ones, then the generated list over and over. */
function appAt(index: number): AppKey {
  return (
    INSTALLED_APPS[index] ??
    GENERATED_APPS[(index - INSTALLED_APPS.length) % GENERATED_APPS.length]!
  );
}

/** The name under a tile. The workbench the next section shows is one of the system apps. */
function appName(app: AppKey): string {
  return app === "evolution" ? S.selfImprove.workbench.title : S.cases.workspace.apps[app];
}

/** How many tints a letter tile can take: the product's palette for apps without an icon. */
const LETTER_HUES = 8;

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
  if (art === null) {
    // A stable tint per app, as the product derives one from the app's id.
    const hue = Object.keys(appTiles).indexOf(app) % LETTER_HUES;
    return (
      <AppIconShape
        size={ICON_PX}
        aria-hidden
        className={`scene-app-mark scene-app-letter scene-app-hue-${hue}`}
      >
        {[...appName(app)][0]?.toUpperCase()}
      </AppIconShape>
    );
  }
  if (typeof art === "object" && "from" in art)
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
/** A phone's three columns at the least, and no more than the generated list can keep distinct. */
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 8;
const ROWS = 4;

/** A new sentence is sent this often, so a few apps are always building at once. */
const SEND_MS = 700;
/** How long each app takes to build, by turn: uneven, so installs land out of step. */
const BUILD_MS = [2700, 3500, 2300, 3100] as const;

/**
 * The Harness OS App Center, drawn after the product's own page: its header and actions, its home
 * screen of icon-and-name tiles, and a composer docked under it. One sentence after another goes
 * into the composer; each becomes an app that builds under the install ring in its own time, and
 * the screen scrolls a row whenever the last one fills. The count beside the title is the number
 * of installed apps.
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
  // A run opens with the last row empty, so the first sentences visibly fill the screen.
  const opening = columns * (ROWS - 1);

  /** Sentences sent so far, and the ones whose apps are still building. */
  const [sent, setSent] = useState(0);
  const [building, setBuilding] = useState<readonly number[]>([]);

  useEffect(() => {
    setSent(0);
    setBuilding([]);
    if (!running) return;
    let turn = 0;
    const timers = new Set<number>();
    const send = window.setInterval(() => {
      const mine = turn++;
      setSent(mine + 1);
      setBuilding((list) => [...list, mine]);
      const done = window.setTimeout(
        () => {
          timers.delete(done);
          setBuilding((list) => list.filter((item) => item !== mine));
        },
        BUILD_MS[mine % BUILD_MS.length],
      );
      timers.add(done);
    }, SEND_MS);
    return () => {
      window.clearInterval(send);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [running, columns]);

  // Still, the screen is full and everything on it is installed.
  const total = reduced ? columns * ROWS : opening + sent;
  const installed = total - building.length;
  const scrolled = Math.max(0, Math.ceil(total / columns) - ROWS);
  // One row above the screen stays mounted while it scrolls out of sight.
  const first = Math.max(0, scrolled - 1) * columns;
  // The sentence being typed is the one the next app will come from.
  const asking = appAt(opening + sent) as GeneratedAppKey;

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
        <ul
          className="scene-launcher"
          aria-label={c.title}
          style={{ "--scene-scrolled": scrolled } as CSSProperties}
        >
          {Array.from({ length: total - first }, (_, offset) => {
            const index = first + offset;
            const app = appAt(index);
            const turn = index - opening;
            const generated = running && turn >= 0;
            const state = !generated
              ? "installed"
              : building.includes(turn)
                ? "building"
                : "landed";
            return (
              <li
                key={index}
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
          <span className="scene-composer-text" key={sent}>
            {c.prompts[asking]}
          </span>
          <div className="scene-composer-row">
            <span className="scene-composer-chip">
              <SiteGlyph name="robot" width={13} height={13} />
              {c.builderLabel}
            </span>
            <span className="scene-composer-status">
              {running ? (
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
