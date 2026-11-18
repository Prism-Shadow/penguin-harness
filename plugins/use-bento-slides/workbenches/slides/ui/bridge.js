// Installed in the head of the editor and presentation before Bento attaches its own file
// shortcuts. The standalone HTML download retains the original runtime's file controls.
export function captureSave(event) {
  if (event.type === "keydown") {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== "s"
    )
      return false;
  } else if (!event.target.closest?.("button")?.querySelector(".ed-dirty")) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

export function connectSave(token, capture, label) {
  function save(event) {
    if (!capture(event)) return;
    // Bento commits the active text box and table cell on blur, including the last input.
    const active = document.activeElement;
    if (active?.isContentEditable || active?.matches("input, textarea")) active.blur();
    parent.postMessage({ __slides: 1, token, type: "save" }, "*");
  }
  window.addEventListener("keydown", save, true);
  window.addEventListener("click", save, true);
  // The standalone editor's button describes overwriting a disk file. Here it saves to the desk.
  const decorate = () => {
    const dot = document.querySelector(".ed-dirty"),
      button = dot?.closest("button");
    if (!button) return;
    button.title = dot.title = label;
    button.setAttribute("aria-label", label);
  };
  window.addEventListener("DOMContentLoaded", () => {
    decorate();
    new MutationObserver(decorate).observe(document.body, { subtree: true, childList: true });
  });
}

// Runs INSIDE the editor frame, next to the Bento app: the only code that touches `window.bento`.
//
// The frame is sandboxed without `allow-same-origin`, so the workbench page cannot reach into
// it; the two talk by messages. This script reports the document whenever the person changed it,
// reports which slide and elements they are on, and loads a document the page hands it. It is
// written to be read as text and placed in the frame's HTML: one function, no imports. `token`
// names this mounting of the editor, so a message from a frame the page has since replaced is
// told apart.
export function bridge(token, locale) {
  var TAG = "__slides";
  var POLL_MS = 400;
  var EDIT_WAIT_MS = 20000;
  var post = function (message) {
    message[TAG] = 1;
    message.token = token;
    parent.postMessage(message, "*");
  };
  // Everything but the bytes of the pictures: enough to tell that the document changed.
  var signature = function (doc) {
    var assets = doc.assets || {};
    var sizes = Object.keys(assets)
      .sort()
      .map(function (key) {
        return key + ":" + String(assets[key]).length;
      });
    var rest = {};
    for (var key in doc) if (key !== "assets") rest[key] = doc[key];
    return JSON.stringify(rest) + "|" + sizes.join(",");
  };
  var ready = function () {
    return !!(window.bento && typeof window.bento.read === "function" && window.bento.doc);
  };
  var typing = function () {
    var el = document.activeElement;
    return !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName)));
  };
  var slideIndex = function () {
    var active = document.querySelector(".ed-thumb.active");
    var index = active ? Number(active.getAttribute("data-index")) : 0;
    return isFinite(index) ? index : 0;
  };

  var last = null;
  var cursor = "";
  var announced = false;

  function tick() {
    if (!ready()) return;
    var doc = window.bento.read();
    var now = signature(doc);
    if (!announced) {
      const language = window.bento.i18n;
      if (language && language.locale() !== locale) language.setLocale(locale);
      announced = true;
      last = now;
      post({ type: "ready", doc: doc, version: (window.bento.updates || {}).version || null });
    } else if (now !== last) {
      last = now;
      post({ type: "changed", doc: doc });
    }
    var index = slideIndex();
    var selection = (window.bento.selection || []).slice(0, 40);
    var at = index + "|" + selection.join(",");
    if (at !== cursor) {
      cursor = at;
      var slide = (doc.slides || [])[index];
      post({
        type: "cursor",
        index: index,
        slideId: slide ? slide.id : null,
        selection: selection,
      });
    }
  }

  // A document from the page replaces the editor's. Not while the person is typing in a text box:
  // replacing the document under a caret throws their sentence away, so it waits for them to
  // leave the box (or long enough that they have stopped).
  function load(id, json, started) {
    if (typing() && Date.now() - started < EDIT_WAIT_MS) {
      setTimeout(function () {
        load(id, json, started);
      }, 250);
      return;
    }
    var before = window.bento.read();
    var slide = (before.slides || [])[slideIndex()];
    var report = false;
    try {
      report = window.bento.loadDoc(json);
    } catch (err) {
      report = false;
    }
    var doc = window.bento.read();
    last = signature(doc);
    // Stay on the slide the person was on, when the new document still has it.
    if (slide) {
      var at = (doc.slides || []).findIndex(function (s) {
        return s.id === slide.id;
      });
      var thumb = at >= 0 ? document.querySelector('.ed-thumb[data-index="' + at + '"]') : null;
      if (thumb && at !== slideIndex()) thumb.click();
    }
    post({ type: "loaded", id: id, ok: report !== false, before: before, doc: doc });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data[TAG] !== 1 || data.token !== token) return;
    if (data.type === "load" && ready()) load(data.id, data.json, Date.now());
    if (data.type === "read" && ready()) {
      const active = document.activeElement;
      if (active?.isContentEditable || active?.matches("input, textarea")) active.blur();
      post({ type: "read", id: data.id, doc: window.bento.read() });
    }
  });
  tick();
  setInterval(tick, POLL_MS);
  ["pointerup", "keyup", "paste", "drop", "focusout"].forEach(function (name) {
    document.addEventListener(
      name,
      function () {
        setTimeout(tick, 80);
      },
      true,
    );
  });
}
