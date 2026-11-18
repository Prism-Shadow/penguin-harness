import { matchRoutes, parsePath, resolvePath, type DataRouter, type To } from "react-router";

/** Use the router's native snapshot transition for a change of page. The router still owns
 * blockers, history traversal and interrupting a transition with a later navigation. */
export function withPageTransitions(router: DataRouter): DataRouter {
  const navigate = router.navigate.bind(router);
  router.navigate = (to: To | number | null, options?: Parameters<DataRouter["navigate"]>[1]) => {
    if (typeof to === "number") return navigate(to);
    const destination = typeof to === "string" ? parsePath(to).pathname : to?.pathname;
    const current = router.state.location.pathname;
    const path = destination ? resolvePath(destination, current).pathname : current;
    const doc = router.window?.document;
    const enabled =
      path !== current &&
      matchRoutes(router.routes, path)?.at(-1)?.route.path === "*" &&
      typeof doc?.startViewTransition === "function" &&
      CSS.supports("selector(:active-view-transition)") &&
      !router.window?.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      doc.documentElement.dataset.motion !== "reduced" &&
      doc.querySelector("[data-page-viewport]") !== null;
    return navigate(to, {
      ...options,
      viewTransition: enabled && options?.viewTransition !== false,
    });
  };
  return router;
}
