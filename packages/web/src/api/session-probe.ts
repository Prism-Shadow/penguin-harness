/**
 * "Am I still signed in?" — one request, shared by everything that has reason to doubt it.
 *
 * A revoked session is invisible to a page that is only listening. An SSE stream the server
 * ends looks exactly like a network blip from the browser's side (EventSource cannot read
 * the status code), and a window nobody touches makes no requests at all — so without a
 * deliberate ask, the window keeps showing a signed-in app until its reader tries to do
 * something. GET /api/me is the cheapest way to ask: a 401 goes through the api client's
 * global unauthorized handler, which clears the current user and lets the route guard take
 * the window to the sign-in page.
 *
 * Every other failure is left alone. An offline laptop and a server being restarted are not
 * revoked sessions, and signing someone out over one would be the worse mistake.
 */
import { getMe } from "./endpoints";

/** The probe in flight, so a burst of focus and stream-error events costs one request rather than one each. */
let inFlight: Promise<void> | null = null;

/** Asks once whether this browser's session is still good. Never rejects. */
export function probeSession(): Promise<void> {
  inFlight ??= getMe().then(
    () => {
      inFlight = null;
    },
    () => {
      // The 401 case has already been handled by the api client, on its way out.
      inFlight = null;
    },
  );
  return inFlight;
}
