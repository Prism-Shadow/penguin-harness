/**
 * The checks the Build stage lists, as the App reads them. Type-only, so the App's type graph
 * does not pull in what computes them (`build-readiness.ts`).
 */
export type ReadinessLevel = "ok" | "warn" | "fail";

export type ReadinessCheck =
  | { id: "script"; level: ReadinessLevel }
  | { id: "spec"; level: ReadinessLevel }
  | { id: "plan"; level: ReadinessLevel; state: "missing" | "stale" | "current" }
  | { id: "speech"; level: ReadinessLevel; language: string; bound: number; total: number }
  | { id: "media"; level: ReadinessLevel; bound: number; total: number }
  | { id: "coverage"; level: ReadinessLevel; language: string; covered: number; total: number }
  | { id: "canonical"; level: ReadinessLevel }
  | { id: "checkout"; level: ReadinessLevel; found: boolean }
  /** Only for an assessed activity: `problems` is 0 when there is no assessment at all. */
  | {
      id: "assessment";
      level: ReadinessLevel;
      state: "missing" | "problems" | "valid";
      problems: number;
    }
  /**
   * Only for a decodable book, per language with word pronunciations: how many are recorded,
   * and how many of those are timed sound by sound (a Gemini recording is not).
   */
  | {
      id: "words";
      level: ReadinessLevel;
      language: string;
      recorded: number;
      total: number;
      timed: number;
    }
  /** Media keys the specification describes differently in different scenes, sorted. */
  | { id: "mediaKeys"; level: ReadinessLevel; keys: string[] };
