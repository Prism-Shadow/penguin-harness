/**
 * A route group built with another copy of Hono — a plugin bundles its own, build-plugins.mjs
 * inlines every non-native dependency — must still hand its errors to the App's handler.
 *
 * Mounting it (`app.route(prefix, group)`) wraps each of its handlers in the group's own error
 * handler unless that handler is the mounting copy's default — and another copy's default is
 * never this one's. That default answers every error `500 text/plain`, so an HttpError a plugin
 * route throws would never reach handleError and its status, code and details: the plugin would
 * have to know to rethrow. So the host decides it: a foreign group that set no error handler of
 * its own is given one that hands the error on, which is what a group of this copy gets by not
 * setting one. A handler the group did set is its own choice, and is left alone.
 */
import { Hono } from "hono";

/** Makes `group`, if it is a foreign copy's with that copy's default error handler, rethrow instead. */
export function adoptGroup(group: unknown): void {
  if (group instanceof Hono) return;
  const foreign = group as { constructor: new () => object; errorHandler?: unknown } & {
    onError?: (handler: (err: Error) => never) => unknown;
  };
  if (typeof foreign.onError !== "function") return;
  let pristine: unknown;
  try {
    pristine = (new foreign.constructor() as { errorHandler?: unknown }).errorHandler;
  } catch {
    return;
  }
  if (pristine !== undefined && foreign.errorHandler === pristine) {
    foreign.onError((err) => {
      throw err;
    });
  }
}
