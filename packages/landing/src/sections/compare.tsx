/**
 * LangChain comparison: the 1x/100x story as two cards with a looping
 * "construction" animation — on a shared cycle, the LangChain side lays one
 * block at a time (still unfinished when the cycle resets) while the
 * PenguinHarness side raises a whole skyline almost instantly and holds it.
 * Reduced-motion users see both skylines complete.
 */
import type { CSSProperties, ReactNode } from "react";
import { S } from "../lib/strings";
import { Section } from "../components/section";

/** Shared build cycle (s): both sides reset together so the pace gap is obvious. */
const CYCLE_S = 7.2;

function Block({
  delay,
  className,
}: {
  /** Seconds into the cycle when this block lands (applied as a negative delay). */
  delay: number;
  className: string;
}) {
  return (
    <span
      className={`anim-block rounded-[3px] ${className}`}
      style={{ "--cycle": `${CYCLE_S}s`, animationDelay: `${delay - CYCLE_S}s` } as CSSProperties}
    />
  );
}

/** One slow tower: a block every ~1.15s — the cycle ends before it tops out. */
function SlowBuild() {
  return (
    <div aria-hidden="true" className="flex h-28 items-end justify-center">
      <span className="flex flex-col-reverse gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <Block key={i} delay={0.4 + i * 1.15} className="h-3 w-10 bg-gray-300 dark:bg-gray-600" />
        ))}
      </span>
    </div>
  );
}

/** A skyline of towers raised in a burst: every block lands within ~1.6s. */
function FastBuild() {
  const towers = [7, 9, 6, 8];
  return (
    <div aria-hidden="true" className="flex h-28 items-end justify-center gap-1.5">
      {towers.map((height, k) => (
        <span key={k} className="flex flex-col-reverse gap-1">
          {Array.from({ length: height }, (_, j) => (
            <Block
              key={j}
              delay={0.4 + k * 0.1 + j * 0.14}
              className="h-2 w-7 bg-brand-500 dark:bg-brand-400"
            />
          ))}
        </span>
      ))}
    </div>
  );
}

function CompareCard({
  name,
  speed,
  mode,
  note,
  emphasized = false,
  children,
}: {
  name: string;
  speed: string;
  mode: string;
  note: string;
  emphasized?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className={`rounded-xl border p-6 text-center sm:p-8 ${
        emphasized
          ? "border-brand-300 bg-brand-25 dark:border-brand-800 dark:bg-brand-950/40"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      }`}
    >
      <p
        className={`text-sm font-semibold tracking-tight ${
          emphasized ? "text-brand-700 dark:text-brand-300" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {name}
      </p>
      <p
        className={`mt-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl ${
          emphasized ? "text-brand-600 dark:text-brand-300" : "text-gray-400 dark:text-gray-600"
        }`}
      >
        {speed}
      </p>
      <div className="mt-5">{children}</div>
      <p className="mt-5 text-[15px] font-medium text-gray-900 dark:text-gray-100">{mode}</p>
      <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{note}</p>
    </article>
  );
}

export function Compare() {
  return (
    <Section
      id="compare"
      eyebrow={S.compare.eyebrow}
      title={S.compare.title}
      subtitle={S.compare.subtitle}
    >
      <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-2">
        <CompareCard {...S.compare.langchain}>
          <SlowBuild />
        </CompareCard>
        <CompareCard {...S.compare.penguin} emphasized>
          <FastBuild />
        </CompareCard>
      </div>
    </Section>
  );
}
