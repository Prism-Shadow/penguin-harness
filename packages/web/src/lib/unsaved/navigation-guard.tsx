/**
 * The route half of the unsaved-changes guard: while any form holds unsaved edits, a navigation
 * that would leave the current page asks first, through the same prompt every other leave uses
 * (the shared UI package's `UnsavedChangesHost`).
 *
 * One `useBlocker` on the data router catches every navigation the app makes — a sidebar link,
 * `navigate()` from any feature, a `<Navigate>` redirect, a `?tab=` switch (a replace), and the
 * browser's back and forward buttons, which the router reverts until the answer is in. Mounted
 * once, above every route (router.tsx); a second blocker would see the same dirty forms and race
 * this one for the answer.
 *
 * A navigation that keeps the path and the query (a state-only replace, a hash) leaves no form
 * behind and is let through. On "discard" every dirty form is reset before the navigation
 * proceeds, so nothing asks twice; on "keep editing" the address stays where it was.
 */
import { useEffect } from "react";
import { useBlocker } from "react-router";
import type { BlockerFunction } from "react-router";
import { confirmDiscard, discardUnsaved, hasUnsaved } from "@prismshadow/penguin-ui";

/** Whether this navigation leaves the page while a form holds unsaved edits. */
export const leavesUnsavedForm: BlockerFunction = ({ currentLocation, nextLocation }) =>
  hasUnsaved() &&
  (currentLocation.pathname !== nextLocation.pathname ||
    currentLocation.search !== nextLocation.search);

export function NavigationGuard() {
  const blocker = useBlocker(leavesUnsavedForm);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let live = true;
    void confirmDiscard().then((discard) => {
      // A newer blocked navigation replaced this one while the prompt was up; its own effect
      // holds the same answer and settles it.
      if (!live) return;
      if (discard) {
        discardUnsaved();
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
    return () => {
      live = false;
    };
  }, [blocker]);
  return null;
}
