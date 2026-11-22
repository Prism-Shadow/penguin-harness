/**
 * The first-run guide to the Project's default models: which step a Project opens on, and the
 * per-browser memory of having closed it.
 *
 * - A Project with a default chat model needs nothing.
 * - Without one, its owner is shown the default-models dialog when some chat model already has a
 *   key behind it (its own, its group's, or one the server's environment holds — the same rule
 *   the model picker uses), and otherwise the guide to connecting a provider or adding a key, which
 *   gives way to the dialog once a key lands.
 * - A member cannot set defaults: nothing opens; the composer says who can.
 *
 * Closing either one is remembered per Project in this browser only — it is about this person's
 * prompts, not a setting of the Project — and from then on the composer's quiet reminder is the
 * only prompt. Storage that is unavailable or throws reads as "never closed" and drops the
 * write, so the guide asks again, which is the safe side.
 */
import { hasConfiguredKey, type ModelCredentialRowLike } from "./model-grouping";

export type OnboardingStep = "none" | "guide" | "dialog";

/** Which step a Project opens on (see the header). */
export function onboardingStep(args: {
  defaultModel: unknown;
  models: readonly ModelCredentialRowLike[];
  owner: boolean;
  dismissed: boolean;
}): OnboardingStep {
  if (args.defaultModel !== undefined || !args.owner || args.dismissed) return "none";
  return usableChatModel(args.models) ? "dialog" : "guide";
}

/** Whether some chat model has a key behind it, so there is a default to choose. */
export function usableChatModel(models: readonly ModelCredentialRowLike[]): boolean {
  return models.some((m) => m.chatEligible !== false && hasConfiguredKey(m));
}

/** localStorage key: a JSON array of the Projects whose guide was closed in this browser. */
export const ONBOARDING_DISMISSED_KEY = "penguin.modelOnboardingDismissed";

export type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): OnboardingStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function closedIn(storage: OnboardingStorage | null): string[] {
  try {
    const raw = storage?.getItem(ONBOARDING_DISMISSED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Whether the guide was closed for this Project in this browser. */
export function onboardingDismissed(
  projectId: string,
  storage: OnboardingStorage | null = defaultStorage(),
): boolean {
  return closedIn(storage).includes(projectId);
}

/** Remembers that the guide was closed for this Project; a storage that refuses is ignored. */
export function dismissOnboarding(
  projectId: string,
  storage: OnboardingStorage | null = defaultStorage(),
): void {
  const list = closedIn(storage);
  if (list.includes(projectId)) return;
  try {
    storage?.setItem(ONBOARDING_DISMISSED_KEY, JSON.stringify([...list, projectId]));
  } catch {
    // Not remembered: the guide asks again next time.
  }
}
