import { useEffect, useState } from "react";
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
  context: string;
  contextIcon: SiteGlyphName;
}) {
  return (
    <div className="scene-bar">
      <span className="scene-title">
        <SiteGlyph name={icon} width={19} height={19} />
        {title}
      </span>
      <span className="scene-context">
        <SiteGlyph name={contextIcon} width={15} height={15} />
        {context}
      </span>
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

function AppMark({ app, size = 42 }: { app: keyof typeof appTiles; size?: number }) {
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

/** The contract desk and its files are from the bilingual 0.2.14 workbench demonstration. */
export function AppGenerationDiagram() {
  const c = S.cases.workspace;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="product-scene"
      data-story-diagram=""
      data-active={active}
      role="group"
      aria-label={c.title}
    >
      <ScreenBar icon="layoutGrid" title={c.title} context={c.project} contextIcon="folderOpen" />
      <div className="scene-workspace">
        <ul className="scene-launcher" aria-label={c.title}>
          {(Object.keys(appTiles) as (keyof typeof appTiles)[]).map((app) => (
            <li key={app} data-selected={app === "legal" || undefined}>
              <AppMark app={app} />
              <span>{c.apps[app]}</span>
            </li>
          ))}
        </ul>
        <div className="scene-desk">
          <div className="scene-desk-title">
            <AppMark app="legal" size={32} />
            <div>
              <strong>{c.desk}</strong>
              <div className="scene-address">legal_agent / legal-desk</div>
            </div>
          </div>
          <table className="scene-files">
            <thead>
              <tr>
                <th scope="col">{c.file}</th>
                <th scope="col">{c.status}</th>
              </tr>
            </thead>
            <tbody>
              {c.files.map((file, i) => {
                const [title, source] = file.split(" - ");
                return (
                  <tr key={file}>
                    <td>
                      <div className="scene-filename">
                        <SiteGlyph name="file" width={16} height={16} />
                        <span>
                          {title}
                          {source && <small>{source}</small>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="scene-file-state" data-reviewing={i === 0 || undefined}>
                        {i === 0 ? (
                          <Spinner className="scene-activity" label={c.analyzing} />
                        ) : (
                          <SiteGlyph name="check" />
                        )}
                        {i === 0 ? c.analyzing : c.reviewed}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

/** Independent rounds on four task families from the GDPEVO Essential report. */
export function AgentEvaluationDiagram() {
  const c = S.selfImprove.workbench;
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  return (
    <div
      ref={ref}
      className="product-scene"
      data-story-diagram=""
      data-active={active && !reduced}
      role="group"
      aria-label={c.title}
    >
      <ScreenBar icon="trophy" title={c.title} context="GDPEVO Essential" contextIcon="bookOpen" />
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
