import { S } from "../lib/strings";

const PANEL = "rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900";
const PAPER = "border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950";

/** Three miniature workbenches, drawn with the visual elements used by their example tasks. */
function AppPreview({ kind }: { kind: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 112 50"
      fill="none"
      className="w-full text-brand-600 dark:text-brand-300"
    >
      {kind === 0 && (
        <>
          <path d="M13 8h47v20H31l-7 6v-6H13z" fill="currentColor" opacity=".19" />
          <path
            d="M24 16h25m-25 5h17"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path d="M44 30h55v10H53l-5 4v-4h-4z" fill="currentColor" opacity=".56" />
        </>
      )}
      {kind === 1 && (
        <>
          <path d="M12 38h88M12 26h88M12 14h88" stroke="currentColor" opacity=".14" />
          <path d="m14 35 18-8 14 4 19-14 11 3 20-13v31H14z" fill="currentColor" opacity=".15" />
          <path
            d="m14 35 18-8 14 4 19-14 11 3 20-13"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {kind === 2 && (
        <>
          <path d="M28 4h45l10 10v31H28z" fill="currentColor" opacity=".13" />
          <path
            d="M73 5v10h9M39 18h22m-22 7h28m-28 8h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="77" cy="33" r="10" fill="currentColor" />
          <path
            d="m72 33 3 3 6-7"
            fill="none"
            stroke="var(--color-white)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

export function AppGenerationDiagram() {
  return (
    <figure className={`mx-auto mb-5 max-w-4xl p-3 sm:p-5 ${PANEL}`}>
      <figcaption className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
        <img alt="" src={`${import.meta.env.BASE_URL}penguin-logo.svg`} width="24" height="24" />
        {S.cases.title}
      </figcaption>
      <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs text-gray-700 dark:border-brand-800 dark:bg-gray-950 dark:text-gray-200">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-4 shrink-0 text-brand-600 dark:text-brand-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5h14v9H9l-4 3v-3H3zM6 8h8" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {S.quickstart.desktop.steps[2]}
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 300 24"
        preserveAspectRatio="none"
        fill="none"
        className="h-6 w-full text-brand-400"
      >
        <path
          d="M150 0v24M150 7v1q0 4-5 4H54q-4 0-4 4v8M150 7v1q0 4 5 4h91q4 0 4 4v8"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ol className="grid grid-cols-3 gap-1.5 sm:gap-4">
        {S.cases.apps.map((name, i) => (
          <li key={name} className={`relative min-w-0 overflow-hidden rounded-lg ${PAPER}`}>
            <div
              aria-hidden="true"
              className="flex h-4 items-center gap-1 border-b border-gray-100 px-2 dark:border-gray-800"
            >
              <i className="size-1 rounded-full bg-brand-400" />
              <i className="h-1 w-6 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <AppPreview kind={i} />
            <p className="px-1 pb-2 text-center text-xs leading-tight font-medium sm:text-sm">
              {name}
            </p>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function AgentEvaluationDiagram() {
  const c = S.selfImprove;
  const routes = [
    { name: S.cases.apps[0], suite: "rag-bench-essential", optimizer: "OPRO" },
    { name: S.hero.benchmarkKinds.softwareEngineering, suite: "deep-swe", optimizer: "ACE" },
  ];
  return (
    <figure className={`mx-auto mb-5 max-w-5xl px-3 py-4 sm:px-6 ${PANEL}`}>
      <figcaption className="mb-4 text-sm font-medium leading-6 text-gray-700 dark:text-gray-200">
        {c.toolkit}
      </figcaption>
      <div className="grid gap-4 sm:grid-cols-2">
        {routes.map(({ name, suite, optimizer }) => (
          <div key={suite} className={`rounded-xl px-3 pt-3 pb-2 ${PAPER}`}>
            <dl className="flex flex-wrap items-baseline gap-x-2 text-xs sm:text-sm">
              <dt className="text-gray-600 dark:text-gray-400">{c.nodeTarget}</dt>
              <dd className="font-semibold">{name}</dd>
            </dl>
            <ol className="mt-3 flex items-start justify-between gap-1 text-center">
              {[
                [c.evaluate, suite],
                [c.optimize, optimizer],
                [c.evaluate, suite],
              ].map(([action, target], index) => (
                <li key={index} className="relative min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-brand-700 dark:text-brand-300">
                    {action}
                  </span>
                  <span className="mt-1 block font-mono text-xs leading-tight break-words text-gray-600 dark:text-gray-400">
                    {target}
                  </span>
                  {index < 2 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 right-0 text-xs text-gray-400"
                    >
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <svg
              aria-hidden="true"
              className="mx-auto mt-1 h-5 w-2/3 text-brand-400"
              preserveAspectRatio="none"
              viewBox="0 0 160 18"
              fill="none"
            >
              <path
                d="M157 2v4q0 7-8 7H11q-8 0-8-7V3m-2 4 2-4 3 4"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        ))}
      </div>
    </figure>
  );
}
