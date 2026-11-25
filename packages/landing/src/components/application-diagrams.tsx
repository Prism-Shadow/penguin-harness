import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ImageIcon, SiteGlyph, type SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { AppIconShape } from "../../../ui/src/components/icons/app-icon-shape/app-icon-shape";
import { Spinner } from "../../../ui/src/components/icons/spinner/spinner";
import { sessionToolArt } from "../../../ui/src/components/icons/glyph-app-icon/session-tool-art";
import slidesIcon from "../../../../plugins/use-bento-slides/workbenches/slides/ui/icon.svg";
import imagesIcon from "../../../../plugins/multimodal-tools/workbenches/images/ui/icon.svg";
import supportIcon from "../../../../plugins/penguin-support/workbenches/support/ui/icon.svg";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";
import { useWidth } from "../lib/use-width";
import { S } from "../lib/strings";
import "./application-diagrams.css";

export function ScreenBar({
  icon,
  title,
  count,
  context,
  contextIcon,
}: {
  icon: SiteGlyphName;
  title: string;
  /** How many items the screen lists, shown after its title as a list header does. */
  count?: number;
  context?: string;
  contextIcon?: SiteGlyphName;
}) {
  return (
    <div className="scene-bar">
      <span className="scene-title">
        <SiteGlyph name={icon} width={19} height={19} />
        {title}
        {count !== undefined && (
          <span className="scene-count" data-app-count="">
            <span key={count} className="scene-count-value">
              {count}
            </span>
          </span>
        )}
      </span>
      {context && (
        <span className="scene-context">
          {contextIcon && <SiteGlyph name={contextIcon} width={15} height={15} />}
          {context}
        </span>
      )}
    </div>
  );
}

type Tone = "brand" | "deep" | "soft" | "slate";

/**
 * Every app the demo project can hold. The first nine are the start dashboard's three builder
 * examples, the shipped workbench art, the gallery's expense log and the session launcher's own
 * illustrations; the rest are line glyphs from the shared registry on tiles in the brand's blues,
 * so a generated app looks like one the App Center would draw for it.
 */
const appTiles = {
  docs: <SiteGlyph name="bookOpen" />,
  investment: <SiteGlyph name="barChart" />,
  legal: <SiteGlyph name="file" />,
  slides: slidesIcon,
  images: imagesIcon,
  support: supportIcon,
  expenses: null,
  terminal: sessionToolArt.get("session-tools-terminal"),
  browser: sessionToolArt.get("session-tools-builtin-browser"),
  meetings: glyphTile("microphone", "brand"),
  data: glyphTile("database", "deep"),
  board: glyphTile("kanban", "soft"),
  review: glyphTile("angleBrackets", "slate"),
  mail: glyphTile("paperPlane", "soft"),
  sales: glyphTile("dashboard", "brand"),
  hiring: glyphTile("users", "deep"),
  translate: glyphTile("globe", "soft"),
  planner: glyphTile("calendar", "slate"),
  competitor: glyphTile("eye", "brand"),
  inventory: glyphTile("archive", "soft"),
  weekly: glyphTile("penLine", "deep"),
  monitor: glyphTile("pulse", "slate"),
  quotes: glyphTile("coin", "soft"),
  audit: glyphTile("shieldCheck", "brand"),
  alerts: glyphTile("bell", "deep"),
  tutor: glyphTile("lightbulb", "soft"),
};

type AppKey = keyof typeof appTiles;

function glyphTile(name: SiteGlyphName, tone: Tone) {
  return { glyph: name, tone };
}

/** The apps the home screen opens on, in home-screen order. */
const INSTALLED_APPS: readonly AppKey[] = [
  "docs",
  "investment",
  "legal",
  "slides",
  "images",
  "support",
  "expenses",
  "terminal",
  "browser",
];

/**
 * What one sentence can generate, in the order the demo asks for it. The terminal and the browser
 * ship with the product, so they are never generated. The list must stay longer than the grid
 * shows at once: it repeats, and an app must have scrolled away before its name comes round again.
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
  "legal",
  "docs",
  "investment",
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

function AppMark({ app, size = 52 }: { app: AppKey; size?: number }) {
  const art = appTiles[app];
  const drawn = typeof art === "object" && art !== null && "glyph" in art;
  return (
    <AppIconShape
      size={size}
      aria-hidden
      className={`scene-app-mark ${drawn ? `scene-app-tone-${art.tone}` : `scene-app-${app}`}`}
    >
      {typeof art === "string" ? (
        <ImageIcon
          icon={{ url: art, tint: false }}
          size={size}
          fallback={<SiteGlyph name="layoutGrid" />}
        />
      ) : drawn ? (
        <SiteGlyph name={art.glyph} />
      ) : (
        (art ?? S.cases.workspace.apps[app][0]?.toUpperCase())
      )}
    </AppIconShape>
  );
}

/** Edge of a home-screen icon and of the ring an installing app wears just outside it, in px. */
const ICON_PX = 52;
const RING_PX = ICON_PX + 12;
const RING_RADIUS = (RING_PX - 2) / 2;

/** A new sentence is sent this often, so a few apps are always generating at once. */
const SEND_MS = 700;
/** How long each app takes to generate, by turn: uneven, so installs land out of step. */
const GENERATE_MS = [2700, 3500, 2300, 3100] as const;

/**
 * The Harness OS App Center as a home screen that keeps filling: one sentence after another goes
 * in, each becomes an app that installs in its own time, and the screen scrolls a row whenever
 * the last one fills. The count in the title is the number of installed apps.
 */
export function AppGenerationDiagram() {
  const c = S.cases.workspace;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = active && !reduced;
  // The grid is laid out for the width it is shown at: a phone's four columns or a desktop's six.
  const { ref: stage, width } = useWidth<HTMLDivElement>(640);
  const columns = width < 480 ? 4 : 6;
  const rows = columns === 4 ? 5 : 4;
  // A run opens with the last row empty, so the first sentences visibly fill the screen.
  const opening = columns * (rows - 1);

  /** Sentences sent so far, and the ones whose apps are still generating. */
  const [sent, setSent] = useState(0);
  const [pending, setPending] = useState<readonly number[]>([]);

  useEffect(() => {
    setSent(0);
    setPending([]);
    if (!running) return;
    let turn = 0;
    const timer = window.setInterval(() => {
      const next = turn++;
      setSent(next + 1);
      setPending((list) => [...list, next]);
    }, SEND_MS);
    return () => window.clearInterval(timer);
  }, [running, columns]);

  // An app is installed when its ring closes: the ring's own animation ends the generating state,
  // so the two cannot drift apart.
  const land = useCallback((turn: number) => {
    setPending((list) => list.filter((item) => item !== turn));
  }, []);

  // Still, the screen is full and everything on it is installed.
  const total = reduced ? columns * rows : opening + sent;
  const installed = total - pending.length;
  const scrolled = Math.max(0, Math.ceil(total / columns) - rows);
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
      <ScreenBar
        icon="layoutGrid"
        title={c.title}
        count={installed}
        context={c.project}
        contextIcon="folderOpen"
      />
      <div className="scene-builder-bar" aria-hidden="true">
        <span className="scene-builder-badge">
          <SiteGlyph name="robot" width={13} height={13} />
          {c.builderLabel}
        </span>
        <span className="scene-builder-prompt">
          <span className="scene-builder-prompt-text" key={sent}>
            {c.prompts[asking]}
          </span>
        </span>
        <span className="scene-builder-status">
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
      </div>
      <div
        ref={stage}
        className="scene-os-stage"
        style={{ "--scene-columns": columns, "--scene-rows": rows } as CSSProperties}
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
              : pending.includes(turn)
                ? "generating"
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
                  <AppMark app={app} size={ICON_PX} />
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
                        className="scene-install-progress"
                        style={{ animationDuration: `${GENERATE_MS[turn % GENERATE_MS.length]}ms` }}
                        onAnimationEnd={() => land(turn)}
                      />
                    </svg>
                  )}
                </span>
                <span className="scene-app-label">{c.apps[app]}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
