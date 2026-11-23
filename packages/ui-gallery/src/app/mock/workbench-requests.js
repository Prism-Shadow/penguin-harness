// Only the bundled workbench's requests for demo API data cross to the gallery's in-memory API.
// Its page, SDK modules, images and Bento runtime remain ordinary lazily loaded static assets.
(() => {
  if (window.parent === window || window.parent.location.origin !== location.origin) return;
  const prefix = location.pathname.slice(
    0,
    location.pathname.indexOf("/demo-workbenches/") + "/demo-workbenches".length,
  );
  const apiPath = (url) =>
    url.origin === location.origin && url.pathname.startsWith(prefix + "/")
      ? url.pathname.slice(prefix.length)
      : "";
  const fetchAsset = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const path = apiPath(url);
    if (
      /^\/(?:server\/[^/]+\/)?api\//.test(path) &&
      !/\/workbenches\/[^/]+\/(?:sdk|ui)\//.test(path)
    ) {
      return window.parent.fetch(path + url.search, options);
    }
    return fetchAsset(input, options);
  };
  const NativeEvents = window.EventSource;
  window.EventSource = class extends EventTarget {
    constructor(url, options) {
      super();
      if (!apiPath(new URL(url, location.href)).endsWith("/workbenches/slides/api/events"))
        return new NativeEvents(url, options);
      // The demo has no background Agent rewriting slide files. Local edits call the file API.
    }
    close() {}
  };
})();
