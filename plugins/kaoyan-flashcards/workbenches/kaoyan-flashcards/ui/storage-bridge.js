/* Storage bridge for a PenguinHarness workbench page.
 *
 * A workbench page is a same-origin frame of the app, so `localStorage` is shared with every
 * other workbench and every other Agent's copy of this one. This script, loaded first in the
 * page, does two things for code that only knows `localStorage`:
 *
 *   1. Namespaces it. Keys this page reads and writes are stored under
 *      `wb:<project>/<agent>/<workbench>:<key>`, so two Agents with the same workbench never read
 *      each other's saves.
 *   2. Keeps it with the workbench. Every write is sent to the workbench's handler
 *      (`POST ../api/saves`, stored with `host.setState`), and on load a save the server holds
 *      that is newer than the local one (or missing here) is written back, followed by one
 *      reload. A save therefore follows the Agent across browsers and devices.
 *
 * What a page writes while it starts, before the server's saves have been read, is not yet
 * news: a fresh browser seeding its defaults must not replace real progress saved elsewhere. So
 * until that first read such a write keeps the key's old time (none, for a new key); after it,
 * the server's newer value wins, and only the keys it did not answer for are sent up.
 *
 * Opened outside a workbench (a file:// page, a plain static server) it does nothing.
 * Limits: a value over 512 KB is kept locally and not sent.
 */
(function () {
  "use strict";
  var match = /^(.*)\/projects\/([^/]+)\/agents\/([^/]+)\/workbenches\/([^/]+)\/ui\//.exec(
    location.pathname,
  );
  if (!match) return;
  var NS = "wb:" + match[2] + "/" + match[3] + "/" + match[4] + ":";
  var STAMP = NS + "\u0000at:"; // per-key write time, kept beside the value
  var API = location.origin + match[0].replace(/ui\/$/, "api");
  var MAX_VALUE = 512 * 1024;
  var RELOADED = NS + "\u0000reloaded";

  var store = window.localStorage;
  var proto = Storage.prototype;
  var raw = {
    getItem: proto.getItem,
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    key: proto.key,
    clear: proto.clear,
    length: Object.getOwnPropertyDescriptor(proto, "length"),
  };
  var mine = function (self) {
    return self === store;
  };
  var ownKeys = function () {
    var out = [];
    var n = raw.length.get.call(store);
    for (var i = 0; i < n; i++) {
      var k = raw.key.call(store, i);
      if (k !== null && k.indexOf(NS) === 0 && k.charAt(NS.length) !== "\u0000") {
        out.push(k.slice(NS.length));
      }
    }
    return out.sort();
  };

  var pending = {};
  var timer = null;
  /** False until the server's saves have been read once (or could not be). */
  var synced = false;
  /** Keys written before that: sent up afterwards, unless the server held something newer. */
  var early = {};
  function flush() {
    timer = null;
    var body = pending;
    pending = {};
    if (!Object.keys(body).length) return;
    try {
      fetch(API + "/saves", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saves: body }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      /* offline: the next write sends it again */
    }
  }
  function queue(key, value, at) {
    if (value !== null && value.length > MAX_VALUE) return;
    pending[key] = { value: value, at: at };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 500);
  }

  proto.getItem = function (key) {
    return raw.getItem.call(this, mine(this) ? NS + key : key);
  };
  proto.setItem = function (key, value) {
    if (!mine(this)) return raw.setItem.call(this, key, value);
    var at = synced ? Date.now() : Number(raw.getItem.call(this, STAMP + key) || 0);
    raw.setItem.call(this, NS + key, String(value));
    raw.setItem.call(this, STAMP + key, String(at));
    if (synced) queue(String(key), String(value), at);
    else early[String(key)] = true;
  };
  proto.removeItem = function (key) {
    if (!mine(this)) return raw.removeItem.call(this, key);
    raw.removeItem.call(this, NS + key);
    if (!synced) {
      early[String(key)] = true;
      return;
    }
    raw.setItem.call(this, STAMP + key, String(Date.now()));
    queue(String(key), null, Date.now());
  };
  proto.key = function (index) {
    if (!mine(this)) return raw.key.call(this, index);
    var keys = ownKeys();
    return index < keys.length ? keys[index] : null;
  };
  proto.clear = function () {
    if (!mine(this)) return raw.clear.call(this);
    ownKeys().forEach(function (k) {
      proto.removeItem.call(store, k);
    });
  };
  Object.defineProperty(proto, "length", {
    configurable: true,
    get: function () {
      return mine(this) ? ownKeys().length : raw.length.get.call(this);
    },
  });

  /* What was written before the first read goes up now, under the current time. */
  function settle(taken) {
    synced = true;
    Object.keys(early).forEach(function (key) {
      if (taken[key]) return;
      var value = raw.getItem.call(store, NS + key);
      var at = Date.now();
      raw.setItem.call(store, STAMP + key, String(at));
      queue(key, value, at);
    });
    early = {};
  }

  /* On load: take what the server holds that is newer than (or missing from) this browser. */
  fetch(API + "/saves", { cache: "no-store" })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (doc) {
      if (!doc || !doc.saves) return settle({});
      var changed = 0;
      var taken = {};
      Object.keys(doc.saves).forEach(function (key) {
        var remote = doc.saves[key];
        if (!remote || typeof remote.at !== "number") return;
        var localAt = Number(raw.getItem.call(store, STAMP + key) || 0);
        if (remote.at <= localAt) return;
        taken[key] = true;
        var current = raw.getItem.call(store, NS + key);
        if (remote.value === null) {
          if (current !== null) changed += 1;
          raw.removeItem.call(store, NS + key);
        } else if (typeof remote.value === "string") {
          if (current !== remote.value) changed += 1;
          raw.setItem.call(store, NS + key, remote.value);
        } else {
          return;
        }
        raw.setItem.call(store, STAMP + key, String(remote.at));
      });
      settle(taken);
      /* What this browser has and the server lacks (written offline) goes up once. */
      ownKeys().forEach(function (key) {
        if (doc.saves[key] || pending[key]) return;
        var at = Number(raw.getItem.call(store, STAMP + key) || 0) || Date.now();
        queue(key, raw.getItem.call(store, NS + key), at);
      });
      if (changed > 0 && !sessionStorage.getItem(RELOADED)) {
        sessionStorage.setItem(RELOADED, "1");
        location.reload();
      } else {
        sessionStorage.removeItem(RELOADED);
      }
    })
    .catch(function () {
      settle({});
    });

  window.addEventListener("pagehide", function () {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && timer) {
      clearTimeout(timer);
      flush();
    }
  });
})();
