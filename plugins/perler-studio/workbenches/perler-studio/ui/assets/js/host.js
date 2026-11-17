/* Workbench adapter. Inside a PenguinHarness workbench tab it follows the app's light/dark mode
 * and hands export files to the handler, which answers them from a same-origin download link.
 * Opened any other way (a plain static server, a file:// page) both are off and the app behaves
 * as a standalone page.
 *
 * Detection reads only the URL shape `/workbenches/<id>/ui/`, never a particular id, so the
 * workbench can be renamed or copied without touching this file.
 */
(function () {
  const PS = (window.PS = window.PS || {});
  const inWorkbench = /\/workbenches\/[^/]+\/ui\//.test(location.pathname);

  /* The ui/ root: API paths resolve from it whatever folder the page sits in. */
  const uiRoot = (function () {
    const m = location.pathname.match(/^.*\/workbenches\/[^/]+\/ui\//);
    const dir = m ? m[0] : location.pathname.replace(/[^/]*$/, "");
    return location.origin + dir;
  })();
  const apiUrl = (rel) => new URL(rel, uiRoot).href;

  const listeners = [];
  let current = null;

  function parseColor(value) {
    if (!value) return null;
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value; // an invalid value keeps the previous colour
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }

  /* The app marks the frame's root `dark` or `light`; without either class, judge by the
     luminance of the injected --wb-bg, and failing that by the system preference. */
  function detectScheme() {
    try {
      const root = document.documentElement;
      if (root.classList.contains("dark")) return "dark";
      if (root.classList.contains("light")) return "light";
      const cs = getComputedStyle(root);
      const wbBg = cs.getPropertyValue("--wb-bg").trim();
      const rgb = parseColor(wbBg || cs.backgroundColor);
      if (rgb && rgb.a !== 0) {
        const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
        return lum < 0.5 ? "dark" : "light";
      }
    } catch (e) {
      /* ignore */
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function apply(scheme) {
    if (!scheme || scheme === current) return;
    current = scheme;
    document.documentElement.dataset.scheme = scheme;
    listeners.forEach((fn) => {
      try {
        fn(scheme);
      } catch (e) {
        /* ignore */
      }
    });
  }

  function sync() {
    if (!inWorkbench) return;
    apply(detectScheme());
  }

  async function save(blob, name, type) {
    if (!inWorkbench) throw new Error("not inside a workbench");
    const declared = type || blob.type || "application/octet-stream";
    /* The server parses an application/json body as a structured request and keeps no bytes
       for the handler, so JSON goes over the wire as a generic binary type; the download still
       saves as .json from the attachment header and the file name. */
    const wire = /^application\/json\b/i.test(declared) ? "application/octet-stream" : declared;
    const res = await fetch(apiUrl("../api/stash?name=" + encodeURIComponent(name)), {
      method: "POST",
      headers: { "content-type": wire },
      body: blob,
    });
    if (!res.ok) throw new Error("stash " + res.status);
    const data = await res.json(); // { id, name, href, page }
    // The handler answers paths relative to ui/; make them absolute same-origin URLs.
    return Object.assign({}, data, {
      href: apiUrl(data.href),
      page: apiUrl(data.page),
    });
  }

  PS.host = {
    inWorkbench,
    save,
    onScheme(fn) {
      listeners.push(fn);
    },
    get scheme() {
      return current;
    },
    sync,
  };

  if (inWorkbench) {
    document.documentElement.dataset.wb = "1";
    const start = () => {
      sync();
      try {
        new MutationObserver(sync).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style", "data-theme", "data-appearance", "data-color-scheme"],
        });
      } catch (e) {
        /* ignore */
      }
      // The app may apply its theme after the page has loaded; check again for a few seconds.
      let n = 0;
      const timer = setInterval(() => {
        sync();
        if (++n > 20 || document.documentElement.dataset.scheme) clearInterval(timer);
      }, 250);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
  }
})();
