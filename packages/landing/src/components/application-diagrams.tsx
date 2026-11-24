import { useId } from "react";
import { SiteGlyph, useSiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { diagramLabels } from "../lib/application-diagram-strings";
import { useVisibleActivity } from "../lib/visible-activity";
import "./application-diagrams.css";

/**
 * An exploded drawing of the contract desk. The two bent sheets share a binding;
 * marks on the contract point to the reviewed clauses on the report.
 */
function ContractPress() {
  const id = useId();
  const dotted = `${id}-dots`;
  const contour = "M21 191 229 114 443 178 237 264Z";
  return (
    <svg aria-hidden="true" viewBox="0 0 465 300" className="contract-press">
      <defs>
        <pattern id={dotted} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r=".85" fill="currentColor" />
        </pattern>
      </defs>
      <ellipse
        cx="237"
        cy="150"
        rx="222"
        ry="139"
        fill={`url(#${dotted})`}
        color="#476185"
        opacity=".64"
      />
      {/* The layers of the workbench meet in one backplane. */}
      <g strokeLinejoin="round">
        <path d="m21 203 216 74 206-85v9l-206 86L21 212z" fill="#102c56" stroke="#517292" />
        <path d={contour} transform="translate(0 12)" fill="#1d365b" stroke="#8ebdf6" />
        <path d="m21 191 216 73 206-86v8l-206 86L21 199z" fill="#154ca6" stroke="#82b4ff" />
        <path d={contour} fill="#2561b6" stroke="#a6d1ff" />
        <path
          d="m45 190 184-68 188 56-181 75z"
          fill="none"
          stroke="#6095d8"
          strokeDasharray="3 4"
        />
        <path d="m41 200 40 13m3 1 7 2m308-18 24-10" fill="none" stroke="#c6eaff" strokeWidth="2" />
        <path d="m90 180 121-46 156 46-121 52z" fill="#1e447b" />
        <g stroke="#a3cef2" strokeDasharray="3 4" opacity=".75">
          <path d="M72 164v21m139-36v19m162 5v17" />
        </g>
      </g>
      {/* Back cover, layered paper edges, and the two faces of the open report. */}
      <g className="press-pages" strokeLinejoin="round">
        <path d="m58 162 93-108 80 12 29-49 96 29 28 122-132 54-133-42z" fill="#0c294d" />
        <path
          d="m56 156 76-94 95 27 27-63 99 22 25 113-129 54-129-44z"
          fill="#367ec5"
          stroke="#b3ddf6"
          strokeWidth="2"
        />
        <path
          d="m59 154 79-99 95 26 24-60 98 25 19 112-128 53-126-43z"
          fill="#90b5c3"
          stroke="#182e50"
        />
        <path
          d="m62 150 75-107c26-2 67 15 95 31l25-59 101 22 11 117-123 54c-27-18-96-34-126-42z"
          fill="#f2eedb"
          stroke="#263a51"
        />
        <path
          d="M62 150c57-3 100 13 142 35l28-111c-30-20-61-37-95-36z"
          fill="#f7f1df"
          stroke="#283d52"
        />
        <path
          d="M204 185c34-32 88-57 151-59l3-89c-40-10-88 4-126 37z"
          fill="#fffaf0"
          stroke="#263a51"
        />
        <g fill="none" strokeLinecap="round">
          <path d="M144 52q29 1 56 18" stroke="#243955" strokeWidth="4" />
          <path
            d="M138 64q34 2 57 18m-64-8q37 3 63 20m-69-9q33 2 63 22m-72-9q31 3 66 22m-72-10q30 3 68 23m-75-11q35 4 71 23"
            stroke="#7f8e91"
            strokeWidth="2"
          />
          <path d="M128 83q34 2 63 21" stroke="#eda63c" strokeWidth="6" opacity=".78" />
          <path d="M112 107q30 3 65 22" stroke="#eda63c" strokeWidth="6" opacity=".78" />
          <path d="M229 87q38-29 76-32" stroke="#193b64" strokeWidth="5" />
          <path
            d="M235 100q27-19 60-24m-63 35q26-18 62-24m-65 34q26-18 56-22"
            stroke="#788da0"
            strokeWidth="2"
          />
          <path d="M232 130q19-13 43-19" stroke="#236be2" strokeWidth="4" />
          <path d="M232 143q15-11 32-15" stroke="#8fa0ab" strokeWidth="2" />
          <path
            d="M67 152q72 2 138 38 64-46 149-61m-283 27q71 6 135 37 63-43 147-61"
            stroke="#899ca6"
            strokeWidth="1.2"
          />
        </g>
        <path d="m203 185 11 7 22-8-10 17-15-2-9 5 5-16z" fill="#f2ad47" />
        {/* The margin note is tied to the highlighted clause by its ink trail. */}
        <path
          d="M177 102c10 10 24 12 35 6s19-8 23-7"
          fill="none"
          stroke="#bd7a21"
          strokeWidth="1.3"
          strokeDasharray="2 3"
        />
        <g transform="matrix(.96 -.27 -.1 1 311 87)" fill="none" stroke="#1e65a1">
          <circle r="20" strokeWidth="2.5" />
          <circle r="15.5" strokeDasharray="1 2" />
          <path
            d="m-8 1 5 5 11-13"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
      {/* The incoming request travels along the desk into the binding. */}
      <path d="M0 244h53l32-23 34-9 16-15 26-9" fill="none" stroke="#709dcc" strokeWidth="1.3" />
      <path
        className="press-signal"
        d="M0 244h53l32-23 34-9 16-15 26-9"
        fill="none"
        stroke="#c0eafd"
        strokeWidth="2.5"
        strokeDasharray="8 190"
      />
      <g fill="none" stroke="#7895b0">
        <circle cx="133" cy="197" r="3" />
        <circle cx="53" cy="244" r="2.5" />
      </g>
    </svg>
  );
}

export function AppGenerationDiagram() {
  const { ref, active } = useVisibleActivity<HTMLElement>();
  const c = S.cases;
  const { locale } = useSiteLocale();
  const labels = diagramLabels[locale];
  const dockIcons = ["bookOpen", "barChart", "clipboard"] as const;
  return (
    <figure ref={ref} data-active={active} className="app-press">
      <div className="app-press-body">
        <div className="app-request">
          <div className="app-press-brand">
            <img
              alt=""
              src={`${import.meta.env.BASE_URL}penguin-logo.svg`}
              width="25"
              height="25"
            />
            {S.siteName}
          </div>
          <blockquote>{labels.excerpt}</blockquote>
          <details>
            <summary>{labels.fullPrompt}</summary>
            <p>{c.prompt}</p>
          </details>
        </div>
        <div className="app-output">
          <ContractPress />
          <div className="app-report">
            <strong>{labels.desk}</strong>
            <div>
              <span>{labels.file}</span>
              <span>{labels.reviewed}</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="app-press-dock">
        <span>{S.hub.plugins.contents.workbenches}</span>
        <ul>
          {c.apps.map((name, i) => (
            <li key={name} className={i === 2 ? "app-selected" : ""}>
              <SiteGlyph name={dockIcons[i] ?? "clipboard"} />
              {name}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** Each trace branches for a candidate, then returns to the same benchmark gate. */
function RevisionTrace({ playbook }: { playbook: boolean }) {
  const candidate = playbook
    ? "M2 42h51c18 0 22-25 45-25h110c22 0 26 25 49 25h41"
    : "M2 42h63c22 0 28-25 49-25h72c23 0 31 25 54 25h58";
  return (
    <div className="revision-track" aria-hidden="true">
      <svg viewBox="0 0 300 54" preserveAspectRatio="none">
        <g fill="none" stroke="currentColor" strokeWidth="2">
          <path
            d="M2 42h296"
            strokeDasharray="2 5"
            opacity=".6"
            vectorEffect="non-scaling-stroke"
          />
          {playbook && (
            <path
              d="M62 33c18 0 19-6 35-6h30c10 0 14-10 23-10"
              opacity=".5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path d={candidate} vectorEffect="non-scaling-stroke" />
          <path
            className="revision-signal"
            d={candidate}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="6 350"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
      <i className="revision-node node-start" />
      <i className={playbook ? "revision-node node-edit node-merge" : "revision-node node-edit"} />
      <i className="revision-node node-end" />
    </div>
  );
}

export function AgentEvaluationDiagram() {
  const { ref, active } = useVisibleActivity<HTMLElement>();
  const c = S.selfImprove;
  const { locale } = useSiteLocale();
  const edits = diagramLabels[locale];
  const routes = [
    {
      name: S.cases.apps[0],
      suite: "rag-bench-essential",
      optimizer: "OPRO",
      edit: edits.instructions,
    },
    {
      name: S.hero.benchmarkKinds.softwareEngineering,
      suite: "deep-swe",
      optimizer: "ACE",
      edit: edits.playbook,
    },
  ];
  return (
    <figure ref={ref} data-active={active} className="agent-lineages">
      <figcaption className="sr-only">{c.toolkit}</figcaption>
      <ol className="lineage-list">
        {routes.map(({ name, suite, optimizer, edit }, index) => (
          <li key={suite} className="lineage-row">
            <div className="lineage-target">
              <SiteGlyph name={index === 0 ? "bookOpen" : "terminalPrompt"} />
              <div>
                <strong>{name}</strong>
                <code>{suite}</code>
              </div>
            </div>
            <div className="lineage-path">
              <div className="lineage-stages">
                <span>{c.evaluate}</span>
                <span>{c.optimize}</span>
                <span>{c.evaluate}</span>
              </div>
              <RevisionTrace playbook={index === 1} />
              <div className="lineage-stages lineage-versions">
                <span>vN</span>
                <b>
                  {optimizer} <span>{edit}</span>
                </b>
                <span>vN+1</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="lineage-key">
        <span>{edits.baseline}</span>
        <span>{edits.decision}</span>
      </div>
    </figure>
  );
}
