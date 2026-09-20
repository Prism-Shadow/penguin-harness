/**
 * The script every Browser page loads first (rewrite.ts injects the tag).
 *
 * Towards the panel that embeds the page, and nothing else, it does three things: it takes
 * the app's theme, it says where the page is, and it hands a link that leaves the site back
 * to the panel — so the panel opens it as a site of its own, rather than the frame wandering
 * off to a page that refuses to be framed.
 *
 * Towards the page it closes the two gaps a reverse proxy leaves, so a site behaves here as it
 * does in a tab of its own:
 *
 * - AN ADDRESS WRITTEN OUT IN FULL. The page believes it is on `http://localhost:3000`, and
 *   code that says so — `fetch("http://localhost:3000/api")`, `new WebSocket("ws://localhost:3000")`
 *   — would reach the VIEWER's port 3000. `fetch`, `XMLHttpRequest`, `WebSocket` and
 *   `EventSource` bring such an address back to the host the page is really on.
 * - A COOKIE WRITTEN FROM SCRIPT. The frame is cross-site to the app, where a browser refuses
 *   a cookie that does not say `SameSite=None; Secure` (rewrite.ts framedCookie does the same
 *   to the headers); `document.cookie` adds what is needed, `Partitioned` included.
 *
 * THE THEME IS AN OFFER. `color-scheme` and the `--penguin-*` variables go into a <style>
 * placed first in the head, so anything the page declares itself wins: a page that knows its
 * own colours keeps them, a page written in `var(--penguin-…)` follows the app, and a page
 * that declares nothing gets the browser's own dark or light defaults. The names are
 * prefixed because the page is anyone's — the app's unprefixed tokens (`--color-gray-*`)
 * are Tailwind's too, and would repaint a stranger's Tailwind site.
 *
 * Messages carry nothing the embedder does not already have — the page's address and title —
 * and only a message from the embedding window is ever listened to.
 *
 * Plain ES5-safe source in a string: it runs in a page this server did not build.
 */
import type { BrowserTarget } from "./address.js";

const BOOTSTRAP_SOURCE = String.raw`(function () {
  if (window.parent === window) return;
  var panel = window.parent;
  var UPSTREAM = __UPSTREAM__;

  // ---- an address written out in full ----
  function isUpstream(url) {
    if (!UPSTREAM) return false;
    var secure = url.protocol === "https:" || url.protocol === "wss:";
    if (secure !== UPSTREAM.secure) return false;
    var port = url.port === "" ? (secure ? "443" : "80") : url.port;
    if (port !== UPSTREAM.port) return false;
    var host = url.hostname.toLowerCase();
    if (!UPSTREAM.loopback) return host === UPSTREAM.host;
    return host === "localhost" || /\.localhost$/.test(host) || host === "[::1]" || /^127\./.test(host);
  }
  function here(input, socket) {
    var url;
    try {
      url = new URL(String(input), location.href);
    } catch (e) {
      return input;
    }
    if (url.origin === location.origin || !isUpstream(url)) return input;
    var scheme = socket ? (location.protocol === "https:" ? "wss:" : "ws:") : location.protocol;
    return scheme + "//" + location.host + url.pathname + url.search + url.hash;
  }
  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string" || input instanceof URL) input = here(input, false);
      return nativeFetch.call(this, input, init);
    };
  }
  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = here(url, false);
    return nativeOpen.apply(this, args);
  };
  ["WebSocket", "EventSource"].forEach(function (name) {
    var Native = window[name];
    if (!Native) return;
    var Wrapped = function (url, options) {
      var at = here(url, name === "WebSocket");
      return options === undefined ? new Native(at) : new Native(at, options);
    };
    Wrapped.prototype = Native.prototype;
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (state) {
      if (state in Native) Wrapped[state] = Native[state];
    });
    window[name] = Wrapped;
  });

  // ---- a cookie written from script ----
  var cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (cookie && cookie.set && cookie.get) {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: function () {
        return cookie.get.call(document);
      },
      set: function (value) {
        var parts = String(value).split(";");
        var kept = [parts[0]];
        for (var i = 1; i < parts.length; i++) {
          if (!/^\s*(domain|samesite|secure|partitioned)\s*(=|$)/i.test(parts[i])) kept.push(parts[i]);
        }
        cookie.set.call(document, kept.join(";") + "; SameSite=None; Secure; Partitioned");
      },
    });
  }

  var STYLE_ID = "penguin-theme";

  function applyTheme(theme) {
    var css = ":root{color-scheme:" + (theme.dark ? "dark" : "light") + ";";
    var vars = theme.vars || {};
    for (var name in vars) {
      if (/^--penguin-[a-z0-9-]+$/.test(name) && !/[;{}<]/.test(vars[name])) {
        css += name + ":" + vars[name] + ";";
      }
    }
    css += "}";
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      var head = document.head || document.documentElement;
      head.insertBefore(style, head.firstChild);
    }
    style.textContent = css;
    document.documentElement.setAttribute("data-penguin-theme", theme.dark ? "dark" : "light");
  }

  window.addEventListener("message", function (event) {
    if (event.source !== panel) return;
    var data = event.data;
    if (data && data.type === "penguin:browser:theme") applyTheme(data);
  });

  function report() {
    panel.postMessage(
      { type: "penguin:browser:location", href: location.href, title: document.title },
      "*"
    );
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      report();
      return result;
    };
  });
  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);
  window.addEventListener("load", report);

  document.addEventListener(
    "click",
    function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var node = event.target;
      while (node && !(node.tagName === "A" && node.href)) node = node.parentNode;
      if (!node || (node.target && node.target !== "_self")) return;
      var url;
      try {
        url = new URL(node.href);
      } catch (e) {
        return;
      }
      if (url.origin === location.origin) return;
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      event.preventDefault();
      panel.postMessage({ type: "penguin:browser:open", url: url.href }, "*");
    },
    false
  );

  panel.postMessage({ type: "penguin:browser:hello" }, "*");
  report();
})();
`;

/** The bootstrap for one site: `null` = a host no site stands behind, which gets the panel half only. */
export function bootstrapFor(target: BrowserTarget | null): string {
  let upstream: { host: string; port: string; secure: boolean; loopback: boolean } | null = null;
  if (target !== null) {
    const url = new URL(target.origin);
    const secure = url.protocol === "https:";
    upstream = {
      host: url.hostname.toLowerCase(),
      port: url.port === "" ? (secure ? "443" : "80") : url.port,
      secure,
      loopback: target.kind === "workspace",
    };
  }
  // JSON is a subset of the language it is pasted into, and "<" cannot occur in it here.
  return BOOTSTRAP_SOURCE.replace("__UPSTREAM__", JSON.stringify(upstream));
}
