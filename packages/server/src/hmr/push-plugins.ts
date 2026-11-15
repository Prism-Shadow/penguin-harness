/**
 * How a push learns that the build it carries cannot run every installed plugin, and how the
 * person pushing gets to say "push anyway".
 *
 * Nothing in a push's request reaches the generation it boots: the mechanism reads a fixed
 * body (packages/hmr), and a booting platform is handed the resource registry and its parked
 * document, nothing else. The registry is therefore the channel. The generation SERVING the
 * push registers a slip for it — whether the pusher already accepted running without the
 * plugins this build cannot satisfy — and the generation BOOTING takes it: with no acceptance
 * on it and something unsatisfied, the boot writes the list back onto the slip and refuses, the
 * mechanism restores the serving generation as it does for any boot that fails, and the route
 * answers with the list instead of the mechanism's plain refusal. With the acceptance, the
 * boot goes through and the slip carries back what was left out.
 *
 * A boot that finds no slip is not a push someone is waiting on — a cold start, a
 * re-assembly, the restore after a failed push, a rollback — and never refuses for this:
 * there is no one to ask, and refusing would only keep the server down.
 *
 * All of it is platform code on both sides, so it ships by push; a serving generation older
 * than this registers no slip, and the push it serves boots as one nobody is waiting on.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { ErrorBody, UnsatisfiedPlugin } from "../api/types.js";

/** Registry key of the slip for the push in flight. */
export const PUSH_SLIP_RESOURCE_ID = "platform.pushSlip";

/** The request header by which a pusher accepts running without the plugins the build cannot satisfy. */
export const UNSATISFIED_PLUGINS_HEADER = "x-penguin-unsatisfied-plugins";
/** Its one value. */
export const LEAVE_OUT = "leave-out";

/** The error code of a push refused because the build cannot run every installed plugin. */
export const PLUGINS_UNSATISFIED = "plugins_unsatisfied";

/**
 * One push's slip. Plain data, filled in place: the two generations that touch it are two
 * bundles and share no classes. Fields only ever get added; a reader treats a missing one as
 * its zero.
 */
export interface PushSlip {
  /** The pusher accepted booting without what the build cannot satisfy. */
  leaveOut: boolean;
  /** A booting generation took it. One push boots one generation on it; the restore after a refusal must not be asked the same question. */
  taken: boolean;
  /** The booting generation refused for `unsatisfied`. */
  refused: boolean;
  /** What the booting generation runs without, or refused to run without. */
  unsatisfied: UnsatisfiedPlugin[];
}

/** Whether the request accepts leaving unsatisfied plugins out. */
export function acceptsLeavingOut(request: Request): boolean {
  return request.headers.get(UNSATISFIED_PLUGINS_HEADER)?.trim().toLowerCase() === LEAVE_OUT;
}

/** Registers the slip for a push about to be handed to the mechanism; `close` once it has answered. */
export function openPushSlip(
  resources: Resources,
  leaveOut: boolean,
): { slip: PushSlip; close: () => void } {
  const slip: PushSlip = { leaveOut, taken: false, refused: false, unsatisfied: [] };
  return { slip, close: resources.register(PUSH_SLIP_RESOURCE_ID, slip) };
}

/** The slip of the push this boot belongs to, taken; null when the boot is not a push someone is waiting on. */
export function takePushSlip(resources: Resources): PushSlip | null {
  const slip = resources.claim<Partial<PushSlip> | null>(PUSH_SLIP_RESOURCE_ID);
  if (slip === null || slip === undefined || typeof slip !== "object" || slip.taken === true) {
    return null;
  }
  slip.taken = true;
  slip.leaveOut = slip.leaveOut === true;
  slip.refused = false;
  slip.unsatisfied = [];
  return slip as PushSlip;
}

/** The body of a push refused for unsatisfied plugins: the usual error envelope, plus the list. */
export interface PluginsUnsatisfiedBody extends ErrorBody {
  error: ErrorBody["error"] & { plugins: UnsatisfiedPlugin[] };
}

function listOf(plugins: readonly UnsatisfiedPlugin[]): string {
  return plugins
    .map(
      (p) =>
        `${p.specifier} (${p.disabled ? "would be disabled" : "would run without part of itself"})`,
    )
    .join(", ");
}

/**
 * The route's answer to a push, given the mechanism's and what the booting generation wrote
 * on the slip: a refusal for unsatisfied plugins becomes 409 with the list, an accepted push
 * that left some out says which, and every other answer is the mechanism's own.
 */
export async function answerPush(slip: PushSlip, answered: Response): Promise<Response> {
  if (slip.refused) {
    const body: PluginsUnsatisfiedBody = {
      error: {
        code: PLUGINS_UNSATISFIED,
        message:
          `This build cannot fully run ${slip.unsatisfied.length === 1 ? "an installed plugin" : "some installed plugins"}: ` +
          `${listOf(slip.unsatisfied)}. The running version was kept. To push anyway and run without them, ` +
          `send the push again with the header '${UNSATISFIED_PLUGINS_HEADER}: ${LEAVE_OUT}'.`,
        plugins: slip.unsatisfied,
      },
    };
    return Response.json(body, { status: 409 });
  }
  if (!answered.ok || slip.unsatisfied.length === 0) return answered;
  let outcome: unknown;
  try {
    outcome = await answered.clone().json();
  } catch {
    return answered;
  }
  if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) return answered;
  return Response.json(
    { ...outcome, unsatisfiedPlugins: slip.unsatisfied },
    { status: answered.status },
  );
}
