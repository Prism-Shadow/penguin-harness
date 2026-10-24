/**
 * What PenguinHarness is made of, as a radiating diagram: PenguinHarness fans out into
 * AMSP / Penguin SDK / Agent State, and each concept drops into the card under it that
 * says what it is and links to its docs page. Arrow paths carry slow-moving dots (SMIL
 * animateMotion). The diagram is hidden on small screens, where the three cards stack.
 */
import { S } from "../lib/strings";
import { DOCS_URL } from "../lib/links";
import { Section } from "../components/section";
import { ArrowRightIcon } from "../components/icons";
import { usePrefersReducedMotion } from "../lib/reduced-motion";

/** Docs page per card, in the order of `S.pillars.items`. */
const DOCS_PAGES = ["amsp-records", "quickstart-sdk", "configuration"];

/**
 * Concept chip centers in viewBox units. The cards below sit in a grid of the same width with a
 * 20px gap, which puts the outer column centers just inside the sixths, so the drops land on the
 * middle of each card.
 */
const CHIP_X = [114, 360, 606];

/** Fan paths from the root's bottom edge to each concept chip (also the dot tracks). */
const FAN_PATHS = [
  "M322,58 C258,92 184,102 126,120",
  "M360,58 L360,120",
  "M398,58 C462,92 536,102 594,120",
];
/** Short connectors from each concept chip into its card below. */
const DROP_PATHS = CHIP_X.map((x) => `M${x},164 L${x},198`);

function FlowDot({ path, dur, begin }: { path: string; dur: string; begin: string }) {
  // Same color as the arrow strokes so the dot reads as flow on the line, not an accent.
  return (
    <circle r="1.5" className="fill-gray-300 dark:fill-gray-600">
      {/* Stop at 90% of the path so the dot never rides over the arrowhead. */}
      <animateMotion
        dur={dur}
        begin={begin}
        repeatCount="indefinite"
        path={path}
        calcMode="linear"
        keyPoints="0;0.9"
        keyTimes="0;1"
      />
    </circle>
  );
}

function RadialDiagram() {
  // The stylesheet's reduced-motion rule stops CSS animations only; SMIL keeps running, so under
  // reduced motion the dots are left out and the arrows alone carry the structure.
  const still = usePrefersReducedMotion();
  return (
    <svg
      viewBox="0 0 720 206"
      role="img"
      aria-label={S.pillars.diagramLabel}
      className="mb-2 hidden w-full md:block"
    >
      <defs>
        <marker
          id="pl-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" className="fill-gray-400 dark:fill-gray-500" />
        </marker>
      </defs>

      <g
        fill="none"
        strokeWidth={1.5}
        className="stroke-gray-300 dark:stroke-gray-600"
        markerEnd="url(#pl-arrow)"
      >
        {FAN_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
        {DROP_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {!still &&
        FAN_PATHS.map((d, i) => <FlowDot key={d} path={d} dur="2.8s" begin={`${i * 0.5}s`} />)}
      {!still &&
        DROP_PATHS.map((d, i) => (
          <FlowDot key={d} path={d} dur="1.6s" begin={`${0.6 + i * 0.5}s`} />
        ))}

      {/* Root node */}
      <rect
        x={270}
        y={8}
        width={180}
        height={50}
        rx={12}
        strokeWidth={1.5}
        className="fill-brand-50 stroke-brand-200 dark:fill-brand-950 dark:stroke-brand-800"
      />
      <image
        href={`${import.meta.env.BASE_URL}penguin-logo.svg`}
        x={288}
        y={22}
        width={22}
        height={22}
        preserveAspectRatio="xMidYMid meet"
      />
      <text
        x={374}
        y={38}
        textAnchor="middle"
        className="fill-brand-800 text-[14px] font-semibold dark:fill-brand-200"
      >
        {S.pillars.root}
      </text>

      {/* Concept chips */}
      {S.pillars.items.map((item, i) => {
        const cx = CHIP_X[i] ?? 360;
        return (
          <g key={item.concept}>
            <rect
              x={cx - 75}
              y={122}
              width={150}
              height={42}
              rx={10}
              strokeWidth={1.5}
              className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700"
            />
            <text
              x={cx}
              y={148}
              textAnchor="middle"
              className="fill-gray-900 text-[12.5px] font-semibold dark:fill-gray-100"
            >
              {item.concept}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Pillars() {
  const p = S.pillars;
  return (
    <Section title={p.title} subtitle={p.subtitle}>
      <div className="mx-auto max-w-4xl">
        <RadialDiagram />
        <div className="grid gap-5 md:grid-cols-3">
          {p.items.map((item, i) => (
            <article
              key={item.concept}
              className="flex flex-col rounded-xl bg-gray-50 p-6 dark:bg-gray-900/60"
            >
              <h3 className="text-lg leading-snug font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word]">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-6 break-words text-gray-600 dark:text-gray-400">
                {item.desc}
              </p>
              <a
                href={`${DOCS_URL}${DOCS_PAGES[i] ?? ""}`}
                className="group mt-auto inline-flex w-fit items-center gap-1.5 pt-4 text-sm font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
              >
                {item.link}
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
