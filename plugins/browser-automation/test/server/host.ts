/**
 * What these suites borrow from the host's own tests and sources, in one place: the App's error
 * handler, which answers every route group's errors the way the App does (an HttpError a plugin's
 * own copy throws included), and the host's generic fake of the desktop shell's port. The
 * plugin's code never imports either.
 */
export { handleError } from "../../../../packages/server/src/http/errors.js";
export { FakePort } from "../../../../packages/server/test/helpers/fake-shell-port.js";
