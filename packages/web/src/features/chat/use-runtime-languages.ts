/**
 * Adopts the languages this deployment's plugins contribute, once per signed-in session.
 *
 * Behind the auth guard rather than at app start: the endpoint needs a session, and an
 * unauthenticated tab has no code blocks to highlight anyway. One fetch per mount of the
 * authenticated tree — the set changes only when the platform is swapped, which is a new page.
 *
 * A failure is silent on purpose. Nothing here is a feature the user asked for; the cost of not
 * having it is a fence rendered unhighlighted, which is exactly what happens for any language
 * this build does not carry. A toast would report an outage the user cannot act on.
 */
import { useEffect } from "react";
import * as api from "../../api/endpoints";
import { registerRuntimeLanguages } from "@prismshadow/penguin-ui";

export function useRuntimeLanguages(signedIn: boolean): void {
  useEffect(() => {
    // Signed out, the endpoint answers 401, which would run the global sign-out handler.
    if (!signedIn) return;
    let cancelled = false;
    void api
      .getLanguages()
      .then((res) => {
        if (!cancelled) registerRuntimeLanguages(res.languages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
}
