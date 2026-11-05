/**
 * Lightweight spring animation utility: parameterized by Apple's
 * damping/response, with no animation library dependency. stepSpring is a
 * pure integration function (unit-testable); createSpringDriver is an rAF
 * driver — a gesture can call stop() at any time to take over from the
 * current rendered value (interruptible), and animateTo accepts an initial
 * velocity (handing off the release velocity from a drag, so drag and
 * animation blend seamlessly).
 */

export interface SpringConfig {
  /** Damping ratio: 1 = critically damped, no overshoot; <1 allows overshoot (only used for gesture-momentum scenarios). */
  damping: number;
  /** Response time (seconds): how quickly it approaches the target. A spring has no fixed duration; settle time emerges from the parameters. */
  response: number;
}

/** Default parameters for programmatic movement (no gesture momentum: critically damped, no overshoot). */
export const SPRING_DEFAULT: SpringConfig = { damping: 1, response: 0.35 };
/** Parameters for a gesture release (with momentum: allows slight bounce). */
export const SPRING_MOMENTUM: SpringConfig = { damping: 0.8, response: 0.3 };

/**
 * Semi-implicit Euler single-frame integration. Internally advances in
 * ≤8ms substeps and clamps the frame interval to 64ms — so a huge dt from
 * a background tab resuming won't blow up numerically. Returns
 * [new value, new velocity (px/s)].
 */
export function stepSpring(
  value: number,
  velocity: number,
  target: number,
  config: SpringConfig,
  dtMs: number,
): [number, number] {
  const omega = (2 * Math.PI) / config.response;
  const stiffness = omega * omega;
  const dampingCoeff = 2 * config.damping * omega;
  let x = value;
  let v = velocity;
  let remaining = Math.min(dtMs, 64);
  while (remaining > 0) {
    const dt = Math.min(remaining, 8) / 1000;
    const accel = -stiffness * (x - target) - dampingCoeff * v;
    v += accel * dt;
    x += v * dt;
    remaining -= 8;
  }
  return [x, v];
}

/** Whether the spring can be considered settled (both position and velocity below the perceptible threshold). */
export function isSettled(value: number, velocity: number, target: number): boolean {
  return Math.abs(value - target) < 0.5 && Math.abs(velocity) < 5;
}

export interface SpringDriver {
  /** Current rendered value (interrupt/takeover continues from here). */
  readonly value: number;
  /** Current velocity (px/s). */
  readonly velocity: number;
  /** Animates from the current value to a target; opts.velocity overrides the current velocity (handoff from a gesture release). */
  animateTo(
    target: number,
    config: SpringConfig,
    opts?: { velocity?: number; onSettle?: () => void },
  ): void;
  /** Gesture takeover: stops at the current value, cancels the callback, and returns [value, velocity]. */
  stop(): [number, number];
  /** Sets the value directly (drag tracking), cancels any in-progress animation, and resets velocity to zero. */
  set(value: number): void;
  /** Teardown cleanup. */
  dispose(): void;
}

export function createSpringDriver(
  initial: number,
  onFrame: (value: number) => void,
): SpringDriver {
  let value = initial;
  let velocity = 0;
  let target = initial;
  let config = SPRING_DEFAULT;
  let onSettle: (() => void) | undefined;
  let raf = 0;
  let lastT = 0;

  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastT = 0;
    onSettle = undefined;
  };

  const tick = (t: number) => {
    const dt = lastT ? t - lastT : 16;
    lastT = t;
    [value, velocity] = stepSpring(value, velocity, target, config, dt);
    if (isSettled(value, velocity, target)) {
      value = target;
      velocity = 0;
      raf = 0;
      lastT = 0;
      onFrame(value);
      const cb = onSettle;
      onSettle = undefined;
      cb?.();
      return;
    }
    onFrame(value);
    raf = requestAnimationFrame(tick);
  };

  return {
    get value() {
      return value;
    },
    get velocity() {
      return velocity;
    },
    animateTo(nextTarget, nextConfig, opts) {
      target = nextTarget;
      config = nextConfig;
      if (opts?.velocity !== undefined) velocity = opts.velocity;
      onSettle = opts?.onSettle;
      if (isSettled(value, velocity, target)) {
        value = target;
        velocity = 0;
        onFrame(value);
        const cb = onSettle;
        onSettle = undefined;
        cb?.();
        return;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      cancel();
      return [value, velocity];
    },
    set(next) {
      cancel();
      value = next;
      velocity = 0;
      onFrame(value);
    },
    dispose: cancel,
  };
}
