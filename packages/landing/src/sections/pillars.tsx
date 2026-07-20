/**
 * Three pillars, introduced by a radiating diagram: PenguinHarness fans out into
 * Penguin Message / Penguin SDK / Penguin Skills, and each concept extends into one
 * pillar card below. Arrow paths carry slow-moving dots (SMIL animateMotion); the
 * diagram is hidden on small screens where the three columns stack.
 */
import { S } from "../lib/strings";
import { Section } from "../components/section";
import { BotIcon, FeatherIcon, RefreshIcon } from "../components/icons";

const ICONS = [FeatherIcon, BotIcon, RefreshIcon];

/** Fan paths from the root's bottom edge to each concept chip (also the dot tracks). */
const FAN_PATHS = [
  "M322,58 C260,92 190,102 132,120",
  "M360,58 L360,120",
  "M398,58 C460,92 530,102 588,120",
];
/** Short connectors from each concept chip into its pillar card below. */
const DROP_PATHS = ["M120,164 L120,198", "M360,164 L360,198", "M600,164 L600,198"];

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
  return (
    <svg
      viewBox="0 0 720 206"
      role="img"
      aria-label={S.pillars.diagramLabel}
      className="mx-auto mb-2 hidden w-full max-w-4xl md:block"
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
      {FAN_PATHS.map((d, i) => (
        <FlowDot key={d} path={d} dur="2.8s" begin={`${i * 0.5}s`} />
      ))}
      {DROP_PATHS.map((d, i) => (
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
      {S.pillars.concepts.map((concept, i) => {
        const cx = [120, 360, 600][i] ?? 360;
        return (
          <g key={concept}>
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
              {concept}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Pillars() {
  return (
    <Section
      id="highlights"
      eyebrow={S.pillars.eyebrow}
      title={S.pillars.title}
      subtitle={S.pillars.subtitle}
    >
      <RadialDiagram />
      <div className="grid gap-5 md:grid-cols-3">
        {S.pillars.items.map((item, i) => {
          const IconCmp = ICONS[i] ?? FeatherIcon;
          return (
            <article
              key={item.title}
              className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
            >
              {/* Oversized faint icon as the card backdrop (brand-tinted, decorative). */}
              <IconCmp
                strokeWidth={1.25}
                className="pointer-events-none absolute -right-6 -bottom-6 h-32 w-32 text-brand-100/80 dark:text-brand-900/50"
              />
              <h3 className="relative text-lg font-semibold tracking-tight">{item.title}</h3>
              <p className="relative mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                {item.desc}
              </p>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
