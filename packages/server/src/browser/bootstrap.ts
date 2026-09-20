/**
 * The script every Browser page loads first (rewrite.ts injects the tag).
 *
 * It does three things, all of them talking to the panel that embeds the page and to nothing
 * else: it takes the app's theme, it says where the page is, and it hands a link that leaves
 * the site back to the panel — so the panel opens it as a site of its own, rather than the
 * frame wandering off to a page that refuses to be framed.
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
export const BOOTSTRAP_SOURCE = String.raw`(function () {
  if (window.parent === window) return;
  var panel = window.parent;
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
