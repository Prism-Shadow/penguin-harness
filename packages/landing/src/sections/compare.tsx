/**
 * Building on an agent library against PenguinHarness, as two panels with a looping
 * "construction" animation: on a shared cycle the library side lays one block at a time (still
 * short of the skyline when the cycle resets) while the PenguinHarness side raises a whole
 * skyline almost at once and holds it. The panels' text names what each side leaves to you or
 * already has. Reduced-motion users see both builds complete.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { S } from "../lib/strings";
import { useVisibleActivity } from "../lib/visible-activity";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { Section } from "../components/section";

/** Shared build cycle (s): both sides reset together so the pace gap is obvious. */
const CYCLE_S = 7.2;

function Block({
  delay,
  className,
}: {
  /** Seconds into the cycle when this block lands. */
  delay: number;
  className: string;
}) {
  return (
    <span
      className={`anim-block rounded-[3px] ${className}`}
      style={{ "--land-delay": `${delay}s` } as CSSProperties}
    />
  );
}

/** One slow tower, a block at a time: still one short tower when the cycle resets. */
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

/** A skyline of towers raised in a burst early in the cycle, then held until the reset. */
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

function ComparePanel({
  name,
  mode,
  note,
  emphasized = false,
  children,
}: {
  name: string;
  mode: string;
  note: string;
  /** PenguinHarness's panel: its name wears the brand hue, like its skyline. */
  emphasized?: boolean;
  children: ReactNode;
}) {
  return (
    <article className="rounded-2xl bg-gray-50 p-6 text-center sm:p-8 dark:bg-gray-900/60">
      <p
        className={`text-sm font-semibold tracking-tight ${
          emphasized ? "text-brand-700 dark:text-brand-300" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {name}
      </p>
      <div className="mt-5">{children}</div>
      <h3 className="mt-6 text-lg font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] text-gray-900 dark:text-gray-100">
        {mode}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-pretty break-keep [overflow-wrap:break-word] text-gray-600 dark:text-gray-400">
        {note}
      </p>
    </article>
  );
}

export function Compare() {
  const [cycle, setCycle] = useState(0);
  const { ref, active } = useVisibleActivity<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const c = S.compare;

  // Remount both builds together: every block begins hidden, then lands once at its delay.
  // One shared reset keeps the two paces side by side.
  useEffect(() => {
    if (!active || reduced) return;
    const timer = window.setInterval(() => setCycle((value) => value + 1), CYCLE_S * 1000);
    return () => window.clearInterval(timer);
  }, [active, reduced]);

  return (
    <Section id="compare" title={c.title} subtitle={c.subtitle}>
      <div
        ref={ref}
        className={`mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 ${active && !reduced ? "" : "content-motion-paused"}`}
      >
        <ComparePanel {...c.library}>
          <SlowBuild key={`slow-${cycle}`} />
        </ComparePanel>
        <ComparePanel {...c.penguin} emphasized>
          <FastBuild key={`fast-${cycle}`} />
        </ComparePanel>
      </div>
    </Section>
  );
}
