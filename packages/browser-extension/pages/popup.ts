/**
 * The toolbar popup: each server's status, how many tabs are handed over, what this tab is
 * (handed over, released, a page Chrome does not let extensions drive) with the matching
 * action, and Pause.
 */
import { isRestrictedUrl } from "../src/policy.js";
import { readPaused, readServers, readStatus, readTabSet, setPaused } from "../src/storage.js";
import { strings } from "../src/strings.js";
import { drivenCount, lookup } from "../src/tab-set.js";
import { element, setText, statusDot, statusText } from "./view.js";

function button(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = element("button", { text, ...(primary ? { className: "primary" } : {}) });
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

async function render(): Promise<void> {
  const [servers, status, tabSet, paused, [tab]] = await Promise.all([
    readServers(),
    readStatus(),
    readTabSet(),
    readPaused(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  const list = document.getElementById("servers") as HTMLUListElement;
  list.replaceChildren(
    ...servers.map((server) => {
      const state = status[server.origin];
      const reconnect =
        state?.status === "replaced" || state?.status === "protocol_mismatch"
          ? button(strings.reconnect, () => {
              void chrome.runtime.sendMessage({ type: "reconnect", origin: server.origin });
            })
          : null;
      return element(
        "li",
        { className: "row" },
        statusDot(state),
        element(
          "div",
          { className: "grow" },
          element("div", { className: "name", text: server.label }),
          element("div", { className: "small muted", text: statusText(state?.status) }),
        ),
        reconnect,
      );
    }),
  );
  setText(
    "count",
    servers.length === 0 ? strings.popupNotPaired : strings.popupTabs(drivenCount(tabSet)),
  );

  const note = document.getElementById("tab-note") as HTMLElement;
  const buttons = document.getElementById("tab-buttons") as HTMLElement;
  buttons.replaceChildren();
  note.textContent = "";
  const tabId = tab?.id;
  const driven = tabId === undefined ? undefined : lookup(tabSet, tabId);
  if (tabId === undefined || servers.length === 0) {
    (document.getElementById("tab") as HTMLElement).hidden = true;
  } else if (driven !== undefined && driven.released === undefined) {
    const label = servers.find((s) => s.origin === driven.server)?.label ?? driven.server;
    note.textContent = strings.popupDriven(label);
    buttons.append(
      button(strings.popupRelease, () => {
        void chrome.runtime.sendMessage({ type: "give-back", tabId }).then(render);
      }),
    );
  } else if (isRestrictedUrl(tab?.url || tab?.pendingUrl)) {
    note.textContent = strings.popupRestricted;
  } else {
    if (driven?.released !== undefined) note.textContent = strings.popupReleased;
    for (const server of servers) {
      const text = servers.length === 1 ? strings.popupAdd : strings.popupAddTo(server.label);
      buttons.append(
        button(
          text,
          () => {
            void chrome.runtime
              .sendMessage({ type: "adopt", tabId, origin: server.origin })
              .then(render);
          },
          true,
        ),
      );
    }
  }

  setText("pause", paused ? strings.popupResume : strings.popupPause);
  const pausedNote = document.getElementById("paused-note") as HTMLElement;
  pausedNote.textContent = strings.popupPaused;
  pausedNote.hidden = !paused;
}

document.documentElement.lang = navigator.language;
setText("settings", strings.popupSettings);
document.getElementById("settings")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
document.getElementById("pause")?.addEventListener("click", () => {
  void readPaused().then((paused) => setPaused(!paused));
});
void render();
chrome.storage.onChanged.addListener(() => void render());
