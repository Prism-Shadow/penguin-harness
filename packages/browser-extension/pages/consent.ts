/**
 * The consent page a server's `read-cookies` opens: which server asks for this Chrome profile's
 * cookies, what handing them over means, and Allow or Deny. The worker holds the question
 * (cookie-export.ts); the page shows it and sends the answer, and the worker then closes the tab.
 * A page whose question is gone — answered, timed out, or the worker restarted — says so and
 * offers nothing to press.
 */
import type { ConsentRequest } from "../src/cookie-export.js";
import { stringsFor, type Strings } from "../src/strings.js";
import { followPreferences, setText } from "./view.js";

const id = new URLSearchParams(location.search).get("id") ?? "";
let strings: Strings = stringsFor("en");
/** Undefined until the worker answers; null when there is no open question. */
let request: ConsentRequest | null | undefined;
let answered: boolean | null = null;

const allow = document.getElementById("allow") as HTMLButtonElement;
const deny = document.getElementById("deny") as HTMLButtonElement;

function render(): void {
  document.title = strings.consentTitle;
  setText("heading", strings.appName);
  setText("title", strings.consentTitle);
  const open = request !== undefined && request !== null && answered === null;
  setText("body", request ? strings.consentBody(request.origin) : "");
  setText("caution", open ? strings.consentCaution : "");
  setText("allow", strings.consentAllow);
  setText("deny", strings.consentDeny);
  allow.hidden = !open;
  deny.hidden = !open;
  setText(
    "outcome",
    answered === true
      ? strings.consentAllowed
      : answered === false
        ? strings.consentDenied
        : request === null
          ? strings.consentGone
          : "",
  );
}

async function answer(allowed: boolean): Promise<void> {
  allow.disabled = true;
  deny.disabled = true;
  await chrome.runtime.sendMessage({ type: "consent-answer", id, allow: allowed });
  answered = allowed;
  render();
}

allow.addEventListener("click", () => void answer(true));
deny.addEventListener("click", () => void answer(false));

void chrome.runtime
  .sendMessage({ type: "consent", id })
  .then((reply: { ok?: boolean; request?: ConsentRequest | null } | undefined) => {
    request = reply?.request ?? null;
    render();
  })
  .catch(() => {
    request = null;
    render();
  });

followPreferences((next) => {
  strings = next;
  render();
});
