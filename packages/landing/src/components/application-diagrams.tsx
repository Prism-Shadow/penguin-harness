import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ImageIcon, SiteGlyph, type SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { AppIconShape } from "../../../ui/src/components/icons/app-icon-shape/app-icon-shape";
import { Spinner } from "../../../ui/src/components/icons/spinner/spinner";
import { sessionToolArt } from "../../../ui/src/components/icons/glyph-app-icon/session-tool-art";
import slidesIcon from "../../../../plugins/use-bento-slides/workbenches/slides/ui/icon.svg";
import imagesIcon from "../../../../plugins/multimodal-tools/workbenches/images/ui/icon.svg";
import supportIcon from "../../../../plugins/penguin-support/workbenches/support/ui/icon.svg";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { useVisibleActivity } from "../lib/visible-activity";
import { S } from "../lib/strings";
import "./application-diagrams.css";

function ScreenBar({
  icon,
  title,
  context,
  contextIcon,
}: {
  icon: SiteGlyphName;
  title: string;
  context?: string;
  contextIcon?: SiteGlyphName;
}) {
  return (
    <div className="scene-bar">
      <span className="scene-title">
        <SiteGlyph name={icon} width={19} height={19} />
        {title}
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

// The start dashboard's three builder examples, the shipped workbench art, the gallery's
// expense log and the session launcher's own illustrations. The combination belongs to this demo project.
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
};

type AppKey = keyof typeof appTiles;

const FEATURED_APPS = ["legal", "docs", "investment", "slides"] as const;
type FeaturedAppKey = (typeof FEATURED_APPS)[number];

/** Radial vectors (dx, dy, rotation) for the Harness OS springboard convergence & shockwave choreography. */
const tileConvergeVectors: Record<AppKey, [string, string, string]> = {
  docs: ["-56px", "-38px", "-12deg"],
  investment: ["0px", "-48px", "6deg"],
  legal: ["56px", "-38px", "12deg"],
  slides: ["-68px", "0px", "-9deg"],
  images: ["0px", "-26px", "0deg"],
  support: ["68px", "0px", "9deg"],
  expenses: ["-56px", "38px", "10deg"],
  terminal: ["0px", "48px", "-6deg"],
  browser: ["56px", "38px", "-12deg"],
};

/** SVG coordinates (in a 600x300 viewBox) of the 3x3 app slots for the background energy network. */
const tileNodeCoords: Record<AppKey, [number, number]> = {
  docs: [110, 62],
  investment: [300, 62],
  legal: [490, 62],
  slides: [110, 152],
  images: [300, 152],
  support: [490, 152],
  expenses: [110, 242],
  terminal: [300, 242],
  browser: [490, 242],
};

function AppMark({ app, size = 52 }: { app: AppKey; size?: number }) {
  const art = appTiles[app];
  return (
    <AppIconShape size={size} aria-hidden className={`scene-app-mark scene-app-${app}`}>
      {typeof art === "string" ? (
        <ImageIcon
          icon={{ url: art, tint: false }}
          size={size}
          fallback={<SiteGlyph name="layoutGrid" />}
        />
      ) : (
        (art ?? S.cases.workspace.apps[app][0]?.toUpperCase())
      )}
    </AppIconShape>
  );
}

type BuilderStage = "converge" | "generating" | "installed";

/**
 * The Harness OS App Center: a pure app-icon springboard animation demonstrating how one sentence
 * turns into an agent-powered app and packs into one desktop Harness OS alongside every other app.
 */
export function AppGenerationDiagram() {
  const c = S.cases.workspace;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const running = active && !reduced;
  const apps = Object.keys(appTiles) as AppKey[];

  const [round, setRound] = useState(0);
  const [stage, setStage] = useState<BuilderStage>("installed");

  useEffect(() => {
    if (!running) {
      setRound(0);
      setStage("installed");
      return;
    }
    setStage("converge");
    let timer: number;
    const stepConverge = () => {
      timer = window.setTimeout(() => {
        setStage("generating");
        timer = window.setTimeout(() => {
          setStage("installed");
          timer = window.setTimeout(() => {
            setRound((r) => r + 1);
            setStage("converge");
            stepConverge();
          }, 1500);
        }, 1350);
      }, 850);
    };
    stepConverge();
    return () => window.clearTimeout(timer);
  }, [running]);

  const currentFeatured: FeaturedAppKey = running
    ? FEATURED_APPS[round % FEATURED_APPS.length]!
    : "legal";
  const currentStage: BuilderStage = running ? stage : "installed";
  const [targetX, targetY] = tileNodeCoords[currentFeatured];
  const beamPath = `M300,8 Q300,${Math.round(targetY * 0.45)} ${targetX},${targetY}`;

  return (
    <div
      ref={ref}
      className="product-scene product-scene-apps"
      data-story-diagram=""
      data-active={running}
      data-stage={currentStage}
      role="group"
      aria-label={c.title}
    >
      <ScreenBar icon="layoutGrid" title={c.title} context={c.project} contextIcon="folderOpen" />
      <div className="scene-builder-bar" aria-hidden="true">
        <span className="scene-builder-badge">
          <SiteGlyph name="robot" width={13} height={13} />
          {c.builderLabel}
        </span>
        <span className="scene-builder-prompt" key={`prompt-${currentFeatured}-${round}`}>
          <span className="scene-builder-prompt-text">{c.prompts[currentFeatured]}</span>
          <span className="scene-builder-progress" />
        </span>
        <span
          className="scene-builder-status"
          data-generating={currentStage === "generating" || undefined}
        >
          {currentStage === "generating" ? (
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
      <div className="scene-os-stage">
        <svg
          className="scene-os-network"
          viewBox="0 0 600 300"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g className="scene-os-grid-lines">
            <line x1="110" y1="62" x2="490" y2="62" />
            <line x1="110" y1="152" x2="490" y2="152" />
            <line x1="110" y1="242" x2="490" y2="242" />
            <line x1="110" y1="62" x2="110" y2="242" />
            <line x1="300" y1="62" x2="300" y2="242" />
            <line x1="490" y1="62" x2="490" y2="242" />
          </g>
          <path d={beamPath} className="scene-os-beam" />
          {running && (
            <>
              <circle r="3.5" className="scene-os-pulse-dot">
                <animateMotion dur="1.1s" repeatCount="indefinite" path={beamPath} />
              </circle>
              <circle r="2.5" className="scene-os-pulse-dot" opacity="0.65">
                <animateMotion dur="1.1s" begin="0.55s" repeatCount="indefinite" path={beamPath} />
              </circle>
            </>
          )}
        </svg>
        <ul className="scene-launcher" aria-label={c.title}>
          {apps.map((app, index) => {
            const [dx, dy, rot] = tileConvergeVectors[app];
            const isTarget = app === currentFeatured;
            const tileState = isTarget
              ? currentStage
              : currentStage === "converge"
                ? "converge"
                : "idle";
            return (
              <li
                key={app}
                data-selected={isTarget || undefined}
                data-generated={isTarget || undefined}
                data-tile-state={tileState}
                style={
                  {
                    "--tile-idx": index,
                    "--tile-dx": dx,
                    "--tile-dy": dy,
                    "--tile-rot": rot,
                  } as CSSProperties
                }
              >
                <div
                  className="scene-app-slot"
                  key={isTarget ? `${app}-${round}-${currentStage}` : `${app}-${round}`}
                >
                  {isTarget && currentStage === "installed" && (
                    <>
                      <span className="scene-app-ripple" aria-hidden="true" />
                      <span
                        className="scene-app-ripple scene-app-ripple-outer"
                        aria-hidden="true"
                      />
                    </>
                  )}
                  <AppMark app={app} />
                  {isTarget && currentStage === "generating" && (
                    <span className="scene-ios-sweep" aria-hidden="true" />
                  )}
                  {isTarget && (
                    <svg className="scene-install-ring" viewBox="0 0 64 64" aria-hidden="true">
                      <rect
                        x="2.5"
                        y="2.5"
                        width="59"
                        height="59"
                        rx="15"
                        fill="none"
                        pathLength={100}
                      />
                    </svg>
                  )}
                  {isTarget && currentStage === "installed" && (
                    <span className="scene-app-badge" aria-hidden="true">
                      <SiteGlyph name="check" width={11} height={11} />
                    </span>
                  )}
                </div>
                <span className="scene-app-label">{c.apps[app]}</span>
              </li>
            );
          })}
        </ul>
        <div className="scene-os-dock" aria-hidden="true">
          {FEATURED_APPS.map((featured) => (
            <span
              key={featured}
              className={`scene-os-dot ${featured === currentFeatured ? "scene-os-dot-active" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const taskMarks: SiteGlyphName[] = ["shieldCheck", "bubbleLines", "barChart", "folderOpen"];

/** Separate schedules keep a busy run from moving in lockstep with another agent. */
function AgentRun({ index, running }: { index: number; running: boolean }) {
  const c = S.selfImprove.workbench;
  const task = c.tasks[index]!;
  const [phase, setPhase] = useState(index);
  useEffect(() => {
    setPhase(index);
    if (!running) return;
    const period = 2850 + index * 190;
    let timer: number;
    function advance() {
      setPhase((current) => (current + 1) % c.stages.length);
      timer = window.setTimeout(advance, period);
    }
    timer = window.setTimeout(advance, 1400 + index * 650);
    return () => window.clearTimeout(timer);
  }, [running, index, c.stages.length]);
  const current = running ? phase : index;
  return (
    <tr data-agent-loop={task.name}>
      <th scope="row">
        <div className="scene-agent">
          <span className="scene-agent-icon">
            <SiteGlyph name={taskMarks[index]!} />
          </span>
          <span>
            <strong>{task.name}</strong>
            <small>{task.task}</small>
          </span>
        </div>
      </th>
      {c.stages.map((stage, i) => {
        const state = current === i ? "active" : current > i ? "done" : "waiting";
        return (
          <td key={stage} data-phase={state} aria-current={state === "active" ? "step" : undefined}>
            <span className="scene-phase">
              {state === "active" ? (
                <Spinner className="scene-activity" label={c.activeStages[i]!} />
              ) : state === "done" ? (
                <SiteGlyph name="check" />
              ) : (
                <span className="scene-wait" />
              )}
              <span className="scene-stage-label">
                {state === "active" ? c.activeStages[i] : stage}
              </span>
            </span>
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Unified Self-Evolution Workbench: fuses the Optimizer/Evaluator loop diagram above with the
 * independent multi-agent evolution rounds below.
 */
export function AgentEvaluationDiagram({ workflow }: { workflow?: ReactNode }) {
  const c = S.selfImprove.workbench;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  return (
    <div
      ref={ref}
      className="product-scene product-scene-evolution"
      data-story-diagram=""
      data-active={active && !reduced}
      role="group"
      aria-label={c.title}
    >
      <ScreenBar icon="trophy" title={c.title} />
      {workflow && <div className="scene-workflow-pane">{workflow}</div>}
      <table className="scene-runs">
        <thead>
          <tr>
            <th scope="col">{c.agents}</th>
            {c.stages.map((stage) => (
              <th scope="col" key={stage}>
                {stage}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.tasks.map((task, index) => (
            <AgentRun key={task.name} index={index} running={active && !reduced} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
