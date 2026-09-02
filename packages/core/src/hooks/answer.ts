/** An error's message as a hook record carries it. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A hook's answer when it threw: the error as the reason and no opinion otherwise — recorded like any other answer, so a broken hook never takes the run down. */
export function failedAnswer(err: unknown): { reason: string } {
  return { reason: `hook failed: ${errorMessage(err)}` };
}
