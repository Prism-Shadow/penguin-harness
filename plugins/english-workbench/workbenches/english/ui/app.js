/* English Learning Workbench: the page logic.
 *
 * No framework and no outside dependency. The learning record (settings, word and sentence
 * library, progress, notes, pasted articles) is one document kept by the workbench's handler
 * (GET / PUT ../api/data); the page holds it in memory, and localStorage holds only the
 * interface language (i18n.js).
 * The only other calls go to the same handler: ../api/settings (the daily-press switch),
 * ../api/press (the press list, fetched by the server only while that switch is on) and
 * ../api/press/import-text (splits pasted text). Speech uses the browser's speechSynthesis,
 * recording uses the microphone only after a click and stays in memory.
 *
 * Interface text comes from i18n.js (`tx`, named so it is never shadowed by the many local `t`
 * variables below), read at render time so a language switch redraws the current view in the
 * new language; study material from content.js stays as written, and `loc` picks the English
 * form of the content fields the page uses as interface text.
 */
(function () {
  "use strict";

  var C = window.EW_CONTENT;
  var I18N = window.EnglishI18n;
  var tx = I18N.t;
  /** The language tag used for dates and numbers. */
  function locale() {
    return I18N.lang() === "zh" ? "zh-CN" : "en-US";
  }
  /** A content field that has an English form (`<field>En`), in the interface language. */
  function loc(obj, field) {
    if (!obj) return "";
    var en = obj[field + "En"];
    return I18N.lang() === "en" && en ? en : obj[field];
  }
  /** A word from a closed set (scene, paid, accent …) through its i18n key; unknown values as is. */
  function tag(prefix, value) {
    var key = prefix + "." + value;
    var text = tx(key);
    return text === key ? String(value == null ? "" : value) : text;
  }
  function examName(id) {
    return tag("exam", id);
  }
  function joinList(items) {
    return items.join(tx("list.sep"));
  }
  var $ = function (s, r) {
    return (r || document).querySelector(s);
  };
  var $$ = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function longDate(d) {
    d = d || new Date();
    return d.toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }
  function wordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }

  /* ---------------------------------------------------------------- illustrations */
  var ART = {
    space: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#edf3fa"/>' +
        '<circle cx="318" cy="56" r="40" fill="#dbe8f7"/><circle cx="304" cy="48" r="9" fill="#c9dbef"/><circle cx="332" cy="70" r="6" fill="#c9dbef"/>' +
        '<path d="M0 172h400" stroke="#cddcee" stroke-width="2"/>' +
        '<path d="M30 160c46-44 104-56 168-46" stroke="#a9c2dd" stroke-width="2" fill="none" stroke-dasharray="5 7"/>' +
        '<g transform="rotate(-18 168 104)"><path d="M168 58c17 16 26 38 26 58s-9 34-26 44c-17-10-26-24-26-44s9-42 26-58z" fill="#2f5d94"/>' +
        '<circle cx="168" cy="106" r="12" fill="#edf3fa"/><path d="M142 138l-20 30 30-10zM194 138l20 30-30-10z" fill="#8fa9cc"/>' +
        '<path d="M168 166c-9 11-9 20 0 27 9-7 9-16 0-27z" fill="#b8c9e6"/></g>' +
        '<circle cx="72" cy="46" r="3" fill="#8fa6c4"/><circle cx="112" cy="30" r="2" fill="#8fa6c4"/><circle cx="258" cy="132" r="2.5" fill="#8fa6c4"/><circle cx="352" cy="150" r="3" fill="#8fa9cc"/></svg>'
      );
    },
    desert: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#f2f6fc"/>' +
        '<circle cx="300" cy="54" r="30" fill="#dbe6f4"/>' +
        '<path d="M0 128c70-26 130-6 200 8s130 10 200-14v78H0z" fill="#dce7f4"/>' +
        '<path d="M0 152c80-18 150 2 210 12s120 8 190-12v48H0z" fill="#c5d6e9"/>' +
        '<g fill="#8fa9cc"><circle cx="70" cy="150" r="5"/><circle cx="96" cy="160" r="4"/><circle cx="132" cy="146" r="5"/></g>' +
        '<g fill="#b9c7ea"><circle cx="160" cy="158" r="4"/><circle cx="196" cy="148" r="5"/><circle cx="228" cy="160" r="4"/></g>' +
        '<g fill="#9c9ad0"><circle cx="262" cy="150" r="5"/><circle cx="292" cy="162" r="4"/><circle cx="330" cy="152" r="5"/></g>' +
        '<path d="M70 150v-16M132 146v-18M196 148v-20M262 150v-18M330 152v-20" stroke="#6f8fb8" stroke-width="1.6"/></svg>'
      );
    },
    city: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#edf2f9"/>' +
        '<g fill="#c8d8ea"><rect x="26" y="86" width="46" height="114"/><rect x="86" y="60" width="38" height="140"/><rect x="136" y="100" width="54" height="100"/><rect x="232" y="76" width="42" height="124"/><rect x="288" y="104" width="56" height="96"/></g>' +
        '<g fill="#fbfdff"><rect x="34" y="96" width="10" height="12"/><rect x="54" y="96" width="10" height="12"/><rect x="34" y="120" width="10" height="12"/><rect x="54" y="120" width="10" height="12"/><rect x="94" y="72" width="9" height="11"/><rect x="110" y="72" width="9" height="11"/><rect x="94" y="94" width="9" height="11"/><rect x="110" y="94" width="9" height="11"/><rect x="146" y="112" width="10" height="12"/><rect x="164" y="112" width="10" height="12"/><rect x="146" y="136" width="10" height="12"/><rect x="164" y="136" width="10" height="12"/></g>' +
        '<rect x="196" y="120" width="30" height="80" rx="3" fill="#2f5d94"/>' +
        '<rect x="199" y="96" width="24" height="20" rx="2" fill="#dbe8f7"/><path d="M203 106l5 6 9-10" stroke="#2f5d94" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>'
      );
    },
    book: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#f1f5fb"/>' +
        '<path d="M120 60c30-10 50-10 80 4 30-14 50-14 80-4v96c-30-10-50-10-80 4-30-14-50-14-80-4z" fill="#ffffff" stroke="#c6d5e7" stroke-width="2"/>' +
        '<path d="M200 64v96" stroke="#c6d5e7" stroke-width="2"/>' +
        '<g stroke="#b8cae0" stroke-width="3" stroke-linecap="round"><path d="M136 84h44M136 100h44M136 116h34M220 84h44M220 100h44M220 116h34"/></g>' +
        '<circle cx="312" cy="58" r="16" fill="#dbe6f4"/><path d="M312 74v-6M296 58h-6M328 58h-6" stroke="#dbe6f4" stroke-width="3" stroke-linecap="round"/>' +
        '<rect x="50" y="140" width="300" height="6" rx="3" fill="#cfdded"/></svg>'
      );
    },
    talk: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#ebf2fa"/>' +
        '<rect x="160" y="56" width="34" height="56" rx="17" fill="#2f5d94"/>' +
        '<path d="M152 96a25 25 0 0 0 50 0" stroke="#2f5d94" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<path d="M177 121v22M162 146h30" stroke="#2f5d94" stroke-width="4" stroke-linecap="round"/>' +
        '<g stroke="#9db9da" stroke-width="3.4" fill="none" stroke-linecap="round"><path d="M214 74c8 12 8 32 0 44"/><path d="M228 62c12 18 12 50 0 68"/><path d="M242 50c16 24 16 68 0 92"/></g>' +
        '<g stroke="#8fa9cc" stroke-width="3.4" fill="none" stroke-linecap="round"><path d="M140 74c-8 12-8 32 0 44"/><path d="M126 62c-12 18-12 50 0 68"/></g>' +
        '<rect x="318" y="150" width="52" height="6" rx="3" fill="#c3d4e8"/><rect x="330" y="164" width="28" height="6" rx="3" fill="#c3d4e8"/></svg>'
      );
    },
    study: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#f3f7fc"/>' +
        '<path d="M0 150h400v50H0z" fill="#dbe6f3"/>' +
        '<rect x="96" y="96" width="120" height="8" rx="4" fill="#b9cbe1"/>' +
        '<path d="M120 96l10-52h84l10 52z" fill="#dce8f5" stroke="#b7c9df" stroke-width="2"/>' +
        '<rect x="142" y="60" width="52" height="28" rx="3" fill="#2f5d94" opacity=".85"/>' +
        '<rect x="238" y="118" width="34" height="32" rx="4" fill="#8fa9cc"/><path d="M272 126c10 0 10 18 0 18" stroke="#8fa9cc" stroke-width="4" fill="none"/>' +
        '<path d="M252 118c-4-8 4-10 0-18M262 118c-4-8 4-10 0-18" stroke="#b7c9df" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
        '<g><rect x="292" y="118" width="44" height="8" rx="3" fill="#9db9da"/><rect x="292" y="130" width="52" height="8" rx="3" fill="#c3d4e8"/><rect x="292" y="142" width="38" height="8" rx="3" fill="#c9dbef"/></g>' +
        '<circle cx="322" cy="86" r="18" fill="#a9c2dd"/><path d="M322 104v14" stroke="#7f9cc2" stroke-width="3"/></svg>'
      );
    },
    wave: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#eef3fa"/>' +
        '<g stroke="#2f5d94" stroke-width="3" stroke-linecap="round" opacity=".7">' +
        '<path d="M40 118v-22M58 126v-44M76 112v-12M94 132v-54M112 120v-26M130 128v-46M148 110v-8M166 130v-50M184 116v-18"/>' +
        '<path d="M216 122v-30M234 130v-48M252 112v-10M270 134v-58M288 120v-24M306 128v-44M324 110v-6M342 130v-50M360 116v-18"/></g>' +
        '<path d="M24 100h352" stroke="#c4d3e6" stroke-width="2" stroke-dasharray="4 6"/>' +
        '<circle cx="200" cy="86" r="26" fill="#dbe6f4" opacity=".9"/><path d="M192 86l14 8-14 8z" fill="#2f5d94"/></svg>'
      );
    },
    pen: function () {
      return (
        '<svg viewBox="0 0 400 200" class="art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<rect width="400" height="200" fill="#eff4fb"/>' +
        '<path d="M60 150h280" stroke="#c6d5e7" stroke-width="2"/>' +
        '<g transform="rotate(-16 210 100)"><rect x="120" y="92" width="150" height="18" rx="9" fill="#2f5d94"/><path d="M120 92l-26 9 26 9z" fill="#8fa9cc"/><rect x="252" y="92" width="26" height="18" rx="8" fill="#9db9da"/></g>' +
        '<path d="M96 62c26-16 54-16 80 0M232 62c26-16 54-16 80 0" stroke="#b8cae0" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
        '<circle cx="330" cy="132" r="7" fill="#b8c9e6"/></svg>'
      );
    },
  };
  function scene(kind) {
    return (ART[kind] || ART.study)();
  }

  /* ---------------------------------------------------------------- reading tip
   * The zip looked words up in a 4 MB dictionary it did not ship (and that the handler read
   * from outside the workbench). Without it, a word's notes come from the annotations of the
   * passage (`vocab` in content.js) or from the learner, who can type a meaning when saving. */
  function readTip() {
    var box = el("div", "legend");
    box.appendChild(el("span", "tip", tx("read.tip")));
    return box;
  }

  /* ---------------------------------------------------------------- state
   * One document, kept by the handler (GET / PUT ../api/data). `adopt` builds the record from
   * what the server holds, field by field, falling back to the defaults; `save` marks it
   * changed and sends it a moment later (see "sync" below). */
  var DEFAULT = {
    updatedAt: 0,
    settings: {
      level: 2,
      minutes: 30,
      exam: "IELTS",
      accent: "en-US",
      rate: 1,
      theme: "auto",
      showCN: true,
      spread: true,
    },
    saved: { words: [], sentences: [] },
    progress: {}, // date -> {news: ts, ted: ts, read: [ids] ...}
    notes: {}, // ted id / "press:<id>" -> text
    answers: {}, // news id -> text
    quiz: {}, // reading questions: article id -> {question index: option index}
    pasted: { text: "", title: "", from: "" }, // from: the news item it was pasted for; no title shows "My article"
    pressRead: [], // pasted press articles, newest first, at most 24
  };
  /** Target exams, as stored in the record; their names come from i18n.js ("exam.<id>"). */
  var EXAMS = ["IELTS", "TOEFL", "CET-4", "CET-6", "KAOYAN", "NONE"];
  var S = adopt(null);

  function isObj(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function adopt(d) {
    var base = JSON.parse(JSON.stringify(DEFAULT));
    if (!isObj(d)) return base;
    if (typeof d.updatedAt === "number") base.updatedAt = d.updatedAt;
    if (isObj(d.settings)) {
      Object.keys(base.settings).forEach(function (sk) {
        if (typeof d.settings[sk] === typeof base.settings[sk]) base.settings[sk] = d.settings[sk];
      });
    }
    if ([1, 2, 3, 4].indexOf(base.settings.level) < 0) base.settings.level = 2;
    if (EXAMS.indexOf(base.settings.exam) < 0) base.settings.exam = "IELTS";
    if (isObj(d.saved)) {
      if (Array.isArray(d.saved.words)) base.saved.words = d.saved.words.filter(isObj);
      if (Array.isArray(d.saved.sentences)) base.saved.sentences = d.saved.sentences.filter(isObj);
    }
    ["progress", "notes", "answers", "quiz"].forEach(function (k) {
      if (isObj(d[k])) base[k] = d[k];
    });
    if (isObj(d.pasted) && typeof d.pasted.text === "string") {
      base.pasted.text = d.pasted.text;
      if (typeof d.pasted.title === "string") base.pasted.title = d.pasted.title;
      if (typeof d.pasted.from === "string") base.pasted.from = d.pasted.from;
    }
    if (Array.isArray(d.pressRead)) base.pressRead = d.pressRead.filter(isObj).slice(0, 24);
    return base;
  }
  function save() {
    S.updatedAt = Date.now();
    queuePush();
  }

  /* ---------------------------------------------------------------- theme
   * Inside the app's frame the app stamps html.dark itself and sets the root's inline
   * color-scheme; "auto" follows that. A choice made here (light / dark) wins, and is put back
   * when the app re-stamps the frame. Opened outside the app, "auto" follows the system. */
  function applyTheme() {
    var t = S.settings.theme,
      root = document.documentElement,
      dark;
    if (t === "dark" || t === "light") dark = t === "dark";
    else if (root.hasAttribute("data-workbench-frame")) dark = root.style.colorScheme === "dark";
    else dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
  }
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (S.settings.theme !== "auto") applyTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  $("#themeBtn").addEventListener("click", function () {
    var dark = document.documentElement.classList.toggle("dark");
    S.settings.theme = dark ? "dark" : "light";
    save();
    toast(dark ? tx("theme.toDark") : tx("theme.toLight"));
  });

  /* ---------------------------------------------------------------- level
   * A level's name and tip are i18n.js's "level.<n>" and "level.<n>.tip". */
  var LEVELS = {
    1: { words: 180, vocab: 8, breaks: 1, notes: 2, cn: true },
    2: { words: 250, vocab: 6, breaks: 2, notes: 2, cn: true },
    3: { words: 350, vocab: 5, breaks: 2, notes: 2, cn: false },
    4: { words: 9999, vocab: 3, breaks: 3, notes: 3, cn: false },
  };
  function L() {
    return LEVELS[S.settings.level] || LEVELS[2];
  }
  function levelName(n) {
    return tx("level." + (LEVELS[n] ? n : 2));
  }
  function levelTip(n) {
    return tx("level." + (LEVELS[n] ? n : 2) + ".tip");
  }

  /* ---------------------------------------------------------------- tts */
  var TTS = {
    voice: null,
    utter: null,
    words: [],
    fallback: null,
    speaking: false,
    paused: false,
    pick: function (lang) {
      var vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      if (!vs.length) return null;
      var want = lang.toLowerCase();
      var exact = vs.filter(function (v) {
        return v.lang && v.lang.toLowerCase() === want;
      });
      var same = vs.filter(function (v) {
        return v.lang && v.lang.toLowerCase().indexOf(want.slice(0, 2)) === 0;
      });
      var pool = exact.length ? exact : same;
      // Voices the browser runs itself come first: a cloud voice (Chrome's "Google …", Edge's
      // "… Online (Natural)") sends the text being read to its provider. Only when the browser
      // has no local voice for the language is a cloud one used. Then the more natural names.
      var local = pool.filter(function (v) {
        return v.localService;
      });
      if (local.length) pool = local;
      var pref = pool.filter(function (v) {
        return /zira|aria|jenny|samantha|libby|google|natural|online/i.test(v.name);
      });
      return pref[0] || pool[0] || null;
    },
    speak: function (text, opts) {
      opts = opts || {};
      if (!window.speechSynthesis) {
        toast(tx("tts.unsupported"));
        return;
      }
      speechSynthesis.cancel();
      clearHighlights();
      clearInterval(TTS.fallback);
      var u = new SpeechSynthesisUtterance(text);
      var lang = opts.lang || S.settings.accent;
      u.lang = lang;
      u.rate = opts.rate || S.settings.rate;
      u.pitch = 1;
      var v = TTS.pick(lang);
      if (v) u.voice = v;
      TTS.utter = u;
      TTS.speaking = true;
      TTS.paused = false;
      $("#ttsPause").setAttribute("aria-pressed", "false");
      setStatus(text.length > 46 ? text.slice(0, 46) + "…" : text);
      var started = 0,
        lastIdx = -1;
      if (opts.onWord) {
        u.onboundary = function (e) {
          if (typeof e.charIndex !== "number") return;
          started = Date.now();
          var idx = idxForChar(opts.map, e.charIndex);
          if (idx >= 0 && idx !== lastIdx) {
            lastIdx = idx;
            opts.onWord(idx);
          }
        };
        // Some voices fire no boundary events: step through the words on a timer instead.
        var n = TTS.words.length;
        var step = 0;
        TTS.fallback = setInterval(function () {
          if (Date.now() - started > 420 && n) {
            step = Math.min(n - 1, step + 1);
            if (step !== lastIdx) {
              lastIdx = step;
              opts.onWord(step);
            }
          }
        }, 400);
      }
      u.onend = function () {
        TTS.speaking = false;
        clearInterval(TTS.fallback);
        clearHighlights();
        setStatus(tx("tts.done"));
        if (opts.onEnd) opts.onEnd();
      };
      u.onerror = function (e) {
        if (TTS.utter !== u) return;
        if (e && (e.error === "interrupted" || e.error === "canceled")) return;
        TTS.speaking = false;
        clearInterval(TTS.fallback);
        clearHighlights();
        if (e && e.error === "not-allowed") setStatus(tx("tts.blocked"));
        else setStatus(tx("tts.failed"));
      };
      try {
        speechSynthesis.speak(u);
      } catch (err) {
        setStatus(tx("tts.startFailed"));
      }
    },
    pause: function () {
      if (!TTS.speaking) return;
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
        TTS.paused = false;
        setStatus(tx("tts.resumed"));
      } else {
        speechSynthesis.pause();
        TTS.paused = true;
        setStatus(tx("tts.paused"));
      }
    },
    stop: function () {
      if (window.speechSynthesis) speechSynthesis.cancel();
      clearInterval(TTS.fallback);
      clearHighlights();
      TTS.speaking = false;
      setStatus(tx("tts.idle"));
    },
  };
  if (window.speechSynthesis) {
    speechSynthesis.addEventListener("voiceschanged", function () {
      TTS.voice = null;
    });
  }

  function setStatus(t) {
    var n = $("#ttsStatus");
    if (n) n.textContent = t;
  }
  function clearHighlights() {
    $$(".w.on").forEach(function (n) {
      n.classList.remove("on");
    });
    $$(".sent.speaking").forEach(function (n) {
      n.classList.remove("speaking");
    });
    $$(".line.speaking").forEach(function (n) {
      n.classList.remove("speaking");
    });
  }
  function idxForChar(map, ci) {
    for (var i = 0; i < map.length; i++) if (ci >= map[i].s && ci < map[i].e) return map[i].i;
    return -1;
  }
  /** Reads a container aloud word by word, highlighting each word as it is spoken. */
  function speakContainer(container, opts) {
    opts = opts || {};
    var words = $$(".w", container);
    if (!words.length) {
      TTS.words = [];
      TTS.speak(container.textContent.trim(), opts);
      return;
    }
    var map = [],
      text = "",
      start = 0;
    words.forEach(function (w, i) {
      var t = w.textContent;
      if (i) {
        text += " ";
        start += 1;
      }
      map.push({ s: start, e: start + t.length, i: i });
      text += t;
      start += t.length;
    });
    TTS.words = words;
    var sent = container.classList.contains("sent") ? container : container.closest(".sent");
    if (sent) {
      clearHighlights();
      sent.classList.add("speaking");
      opts.onEnd = function () {
        sent.classList.remove("speaking");
      };
    }
    TTS.speak(text, {
      rate: opts.rate,
      map: map,
      onWord: function (i) {
        words.forEach(function (n) {
          n.classList.remove("on");
        });
        if (words[i]) words[i].classList.add("on");
      },
      onEnd: opts.onEnd,
    });
  }

  /* ---------------------------------------------------------------- word utils */
  function normWord(raw) {
    return String(raw)
      .toLowerCase()
      .replace(/[^a-z'’-]/g, "")
      .replace(/^['’-]+|['’-]+$/g, "");
  }
  var VOCAB = new Map();
  function indexVocab() {
    C.news.forEach(function (a) {
      a.vocab.forEach(function (v) {
        VOCAB.set(normWord(v.w), { v: v, src: a.title, kind: "news", id: a.id });
      });
    });
    C.ted.forEach(function (t) {
      t.vocab.forEach(function (v) {
        VOCAB.set(normWord(v.w), { v: v, src: t.title, kind: "ted", id: t.id });
      });
    });
    C.books.forEach(function (b) {
      b.segs.forEach(function (s) {
        s.vocab.forEach(function (v) {
          VOCAB.set(normWord(v.w), { v: v, src: b.title, kind: "book", id: b.id });
        });
      });
    });
  }
  indexVocab();
  var inflections = [
    function (w) {
      return w.replace(/ies$/, "y");
    },
    function (w) {
      return w.replace(/es$/, "");
    },
    function (w) {
      return w.replace(/s$/, "");
    },
    function (w) {
      return w.replace(/ed$/, "");
    },
    function (w) {
      return w.replace(/d$/, "");
    },
    function (w) {
      return w.replace(/ing$/, "");
    },
    function (w) {
      return w.replace(/ing$/, "e");
    },
    function (w) {
      return w.replace(/ly$/, "");
    },
    function (w) {
      return w.replace(/’s$|'s$/, "");
    },
  ];
  function lookupVocab(raw) {
    var w = normWord(raw);
    if (!w) return null;
    if (VOCAB.has(w)) return VOCAB.get(w);
    for (var i = 0; i < inflections.length; i++) {
      var c = inflections[i](w);
      if (c && c !== w && VOCAB.has(c)) return VOCAB.get(c);
    }
    return null;
  }

  /* ---------------------------------------------------------------- passage */
  function splitSentences(text) {
    var parts = text
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^.!?]+[.!?]+["”’']?|[^.!?]+$/g);
    return (parts || [text])
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }
  function buildSentence(sentText, vocabSet) {
    var wrap = el("span", "sent");
    wrap.dataset.text = sentText;
    var tokens = sentText.split(/\s+/);
    tokens.forEach(function (tok, i) {
      if (i) wrap.appendChild(document.createTextNode(" "));
      var w = el("span", "w", tok);
      var norm = normWord(tok);
      w.dataset.w = norm;
      if (norm && vocabSet && vocabSet[norm]) w.classList.add("hot");
      wrap.appendChild(w);
    });
    return wrap;
  }
  /** Draws a passage; opts: {vocab, showCN, limit}. */
  function renderPassage(host, paragraphs, opts) {
    opts = opts || {};
    var vocabSet = {};
    (opts.vocab || []).forEach(function (v) {
      vocabSet[normWord(v.w)] = true;
    });
    var used = 0;
    var shown = 0;
    paragraphs.forEach(function (p, pi) {
      if (opts.limit && used >= opts.limit) return;
      shown++;
      var para = el("div", p.h ? "para para-h" : "para");
      var tools = el("div", "para-tools");
      var bPlay = el("button", "btn small ghost", tx("passage.play"));
      bPlay.type = "button";
      bPlay.addEventListener("click", function () {
        speakContainer(para);
      });
      var bSlow = el("button", "btn small ghost", tx("common.slow"));
      bSlow.type = "button";
      bSlow.addEventListener("click", function () {
        speakContainer(para, { rate: 0.75 });
      });
      var bRec = el("button", "btn small ghost", tx("passage.shadow"));
      bRec.type = "button";
      bRec.addEventListener("click", function () {
        REC.start(para, tools);
      });
      tools.appendChild(bPlay);
      tools.appendChild(bSlow);
      tools.appendChild(bRec);
      para.appendChild(tools);

      var body = el("div");
      splitSentences(p.en).forEach(function (s, si) {
        if (si) body.appendChild(document.createTextNode(" "));
        body.appendChild(buildSentence(s, vocabSet));
      });
      para.appendChild(body);

      if (opts.showCN && p.cn) para.appendChild(el("div", "para-cn", p.cn));
      host.appendChild(para);
      used += wordCount(p.en);
    });
    return { used: used, shown: shown, total: paragraphs.length };
  }

  /* ---------------------------------------------------------------- popover */
  var POP = $("#pop");
  function closePop() {
    POP.classList.remove("show");
    POP.innerHTML = "";
  }
  document.addEventListener("click", function (e) {
    if (!POP.contains(e.target) && !e.target.closest(".w")) closePop();
  });
  function showWordPop(wordEl, ev) {
    var raw = wordEl.textContent;
    var clean = raw.replace(/[.,;:!?"“”()\[\]]/g, "").replace(/^['’]+|['’]+$/g, "");
    var cur = lookupVocab(raw);
    var baseWord = cur ? cur.v.w : normWord(raw);
    var saved = S.saved.words.some(function (w) {
      return normWord(w.en) === normWord(baseWord);
    });
    POP.innerHTML = "";
    POP._meaning = null;

    var head = el("div", "head");
    head.appendChild(el("span", "en", clean || raw));
    var ipa = (cur && cur.v.ipa) || "";
    if (ipa) head.appendChild(el("span", "ipa", ipa.charAt(0) === "/" ? ipa : "/" + ipa + "/"));
    POP.appendChild(head);

    if (cur) {
      var tl = el("div", "tagline");
      tl.appendChild(el("span", "tag hot", tx("pop.marked")));
      POP.appendChild(tl);
      POP.appendChild(el("div", "meta", (cur.v.pos ? cur.v.pos + " " : "") + cur.v.cn));
    } else {
      POP.appendChild(el("div", "meta", tx("pop.noNote")));
    }

    if (cur) {
      if (cur.v.coll) {
        var s1 = el("div", "sect");
        s1.innerHTML =
          "<b>" + esc(tx("pop.coll")) + '</b><div class="meta">' + esc(cur.v.coll) + "</div>";
        POP.appendChild(s1);
      }
      if (cur.v.ex) {
        var s2 = el("div", "sect");
        s2.innerHTML = "<b>" + esc(tx("pop.ex")) + "</b>";
        s2.appendChild(el("div", "ex", cur.v.ex));
        POP.appendChild(s2);
      }
      var s3 = el("div", "sect");
      s3.innerHTML =
        "<b>" + esc(tx("pop.src")) + '</b><div class="meta">' + esc(cur.src) + "</div>";
      POP.appendChild(s3);
    }

    if (!cur) {
      var inp = el("input");
      inp.type = "text";
      inp.placeholder = tx("pop.placeholder");
      inp.style.marginTop = "10px";
      POP.appendChild(inp);
      POP._meaning = inp;
    }

    var tools = el("div", "tools");
    var bSay = el("button", "btn small", tx("common.read"));
    bSay.type = "button";
    bSay.addEventListener("click", function () {
      speakWord(clean);
    });
    var bSlow = el("button", "btn small", tx("common.slow"));
    bSlow.type = "button";
    bSlow.addEventListener("click", function () {
      TTS.words = [];
      TTS.speak(clean, { rate: 0.75 });
    });
    var bSave = el("button", "btn small primary", saved ? tx("pop.inLib") : tx("pop.add"));
    bSave.type = "button";
    bSave.disabled = saved;
    bSave.addEventListener("click", function () {
      var meaning = cur
        ? (cur.v.pos ? cur.v.pos + " " : "") + cur.v.cn
        : POP._meaning
          ? POP._meaning.value.trim()
          : "";
      addWord({
        en: cur ? cur.v.w : clean,
        ipa: cur ? cur.v.ipa : ipa,
        pos: cur ? cur.v.pos : "",
        cn: meaning || tx("word.noMeaning"),
        coll: cur ? cur.v.coll : "",
        ex: cur ? cur.v.ex : "",
        src: cur ? cur.src : currentTitle(),
      });
      bSave.textContent = tx("pop.added");
      bSave.disabled = true;
      toast(tx("toast.addedWord"));
    });
    tools.appendChild(bSay);
    tools.appendChild(bSlow);
    tools.appendChild(bSave);
    POP.appendChild(tools);

    POP.classList.add("show");
    var rect = wordEl.getBoundingClientRect();
    var ph = POP.offsetHeight,
      pw = POP.offsetWidth || 342;
    var top = rect.bottom + window.scrollY + 8;
    // No room below the word: open above it.
    if (rect.bottom + 8 + ph > window.innerHeight && rect.top - ph - 8 > 0)
      top = rect.top + window.scrollY - ph - 8;
    var left = rect.left + window.scrollX;
    left = Math.min(left, window.scrollX + window.innerWidth - pw - 12);
    left = Math.max(left, window.scrollX + 10);
    POP.style.top = top + "px";
    POP.style.left = left + "px";
    speakWord(clean);
  }
  function speakWord(raw) {
    var clean = raw.replace(/[.,;:!?"“”()]/g, "");
    if (!clean) return;
    TTS.words = [];
    TTS.speak(clean, {});
  }

  /* ---------------------------------------------------------------- selection bar */
  var SEL = $("#selbar");
  var selText = "";
  document.addEventListener("pointerup", function (e) {
    if (SEL.contains(e.target)) return;
    setTimeout(function () {
      var sel = window.getSelection();
      var t = sel ? sel.toString().trim() : "";
      var inPassage =
        sel &&
        sel.anchorNode &&
        sel.anchorNode.parentElement &&
        sel.anchorNode.parentElement.closest(".passage, .script, .md-passage");
      if (!t || t.length < 2 || !inPassage) {
        SEL.classList.remove("show");
        return;
      }
      selText = t;
      var r = sel.getRangeAt(0).getBoundingClientRect();
      SEL.classList.add("show");
      SEL.style.top = r.top + window.scrollY - 40 + "px";
      SEL.style.left =
        Math.min(Math.max(r.left + window.scrollX, 10), window.scrollX + window.innerWidth - 220) +
        "px";
    }, 10);
  });
  SEL.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var act = b.dataset.act;
    if (act === "speak") {
      TTS.words = [];
      TTS.speak(selText, {});
    }
    if (act === "slow") {
      TTS.words = [];
      TTS.speak(selText, { rate: 0.75 });
    }
    if (act === "copy") {
      copy(selText);
    }
    if (act === "save") {
      addSentence(selText);
    }
    SEL.classList.remove("show");
  });
  function copy(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(
        function () {
          toast(tx("toast.copied"));
        },
        function () {
          fallbackCopy(t);
        },
      );
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = el("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(tx("toast.copied"));
    } catch (e) {
      toast(tx("toast.copyFailed"));
    }
    document.body.removeChild(ta);
  }

  /* ---------------------------------------------------------------- recorder */
  var REC = {
    active: false,
    rec: null,
    chunks: [],
    target: null,
    host: null,
    timer: null,
    startedAt: 0,
    start: function (target, host) {
      if (REC.active) {
        REC.stop();
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast(tx("rec.unsupported"));
        return;
      }
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(function (stream) {
          REC.active = true;
          REC.chunks = [];
          REC.target = target;
          REC.host = host;
          REC.rec = new MediaRecorder(stream);
          REC.startedAt = Date.now();
          REC.rec.ondataavailable = function (e) {
            if (e.data.size) REC.chunks.push(e.data);
          };
          REC.rec.onstop = function () {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            var blob = new Blob(REC.chunks, { type: "audio/webm" });
            var url = URL.createObjectURL(blob);
            showTake(url, REC.host, REC.target);
          };
          REC.rec.start();
          var btn = $("#recBtn");
          btn.textContent = tx("rec.stop");
          btn.classList.add("primary");
          clearInterval(REC.timer);
          REC.timer = setInterval(function () {
            var s = Math.floor((Date.now() - REC.startedAt) / 1000);
            setStatus(tx("rec.recording", pad(Math.floor(s / 60)) + ":" + pad(s % 60)));
          }, 500);
        })
        .catch(function () {
          toast(tx("rec.noMic"));
        });
    },
    stop: function () {
      if (REC.rec && REC.rec.state !== "inactive") REC.rec.stop();
      REC.active = false;
      clearInterval(REC.timer);
      var btn = $("#recBtn");
      btn.textContent = tx("rd.rec");
      btn.classList.remove("primary");
      setStatus(tx("rec.done"));
    },
  };
  function showTake(url, host, target) {
    if (!host) return;
    var old = host.querySelector(".take");
    if (old) old.remove();
    var box = el("div", "take row");
    box.style.marginTop = "6px";
    var a = el("audio");
    a.controls = true;
    a.src = url;
    a.style.height = "30px";
    var bReplay = el("button", "btn small ghost", tx("rec.replay"));
    bReplay.type = "button";
    bReplay.addEventListener("click", function () {
      speakContainer(target);
    });
    var bDel = el("button", "btn small ghost", tx("rec.delete"));
    bDel.type = "button";
    bDel.addEventListener("click", function () {
      box.remove();
    });
    var tip = el("span", "faint", tx("rec.memoryOnly"));
    box.appendChild(a);
    box.appendChild(bReplay);
    box.appendChild(bDel);
    box.appendChild(tip);
    host.appendChild(box);
  }
  $("#recBtn").addEventListener("click", function () {
    if (REC.active) {
      REC.stop();
      return;
    }
    var host = $("#view .card") || document.body;
    REC.start(document.querySelector(".sent.speaking") || host, host);
  });
  $("#ttsPause").addEventListener("click", function () {
    TTS.pause();
  });
  $("#ttsStop").addEventListener("click", function () {
    TTS.stop();
  });
  $("#rateRange").addEventListener("input", function (e) {
    S.settings.rate = parseFloat(e.target.value);
    save();
    renderNavMeta();
  });
  $("#accentBtn").addEventListener("click", function () {
    S.settings.accent = S.settings.accent === "en-US" ? "en-GB" : "en-US";
    save();
    syncAccentBtn();
    toast(S.settings.accent === "en-US" ? tx("accent.toUS") : tx("accent.toUK"));
  });
  function syncAccentBtn() {
    $("#accentBtn").textContent = S.settings.accent === "en-GB" ? tx("accent.uk") : tx("accent.us");
    $("#accentBtn").setAttribute("aria-pressed", S.settings.accent === "en-GB" ? "true" : "false");
    $("#rateRange").value = S.settings.rate;
  }

  /* ---------------------------------------------------------------- saved items */
  function addWord(w) {
    if (
      S.saved.words.some(function (x) {
        return normWord(x.en) === normWord(w.en);
      })
    ) {
      toast(tx("toast.wordExists"));
      return;
    }
    w.id = uid();
    w.added = Date.now();
    w.box = 0;
    w.next = Date.now();
    w.hits = 0;
    S.saved.words.unshift(w);
    save();
    renderNavMeta();
  }
  function addSentence(text) {
    if (
      S.saved.sentences.some(function (x) {
        return x.text === text;
      })
    ) {
      toast(tx("toast.sentenceExists"));
      return;
    }
    S.saved.sentences.unshift({ id: uid(), text: text, src: currentTitle(), added: Date.now() });
    save();
    toast(tx("toast.sentenceSaved"));
  }
  function currentTitle() {
    var n = $("#view h2");
    return n ? n.textContent.slice(0, 40) : tx("app.name");
  }

  /* ---------------------------------------------------------------- progress */
  function todayProgress() {
    var k = dayKey();
    if (!S.progress[k]) S.progress[k] = {};
    return S.progress[k];
  }
  function toggleTask(key) {
    var p = todayProgress();
    if (p[key]) delete p[key];
    else p[key] = Date.now();
    save();
    render();
  }
  function markRead(kind, id) {
    var p = todayProgress();
    if (!p.read) p.read = [];
    if (id && p.read.indexOf(id) < 0) p.read.push(id);
    save();
  }
  function streak() {
    var n = 0,
      d = new Date();
    for (;;) {
      var k = dayKey(d);
      var p = S.progress[k];
      if (p && Object.keys(p).length) {
        n++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    return n;
  }

  /* ---------------------------------------------------------------- helpers */
  function todayArticle() {
    var idx =
      Math.abs(Math.floor((Date.now() - new Date("2026-11-01").getTime()) / 86400000)) %
      C.news.length;
    return C.news[idx];
  }
  function dueWords() {
    var now = Date.now();
    return S.saved.words.filter(function (w) {
      return w.next <= now;
    });
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove("show");
    }, 3000);
  }
  function renderNavMeta() {
    var lv = S.settings.level;
    $("#sideLevel").textContent = "L" + lv;
    $("#sideLevelName").textContent = levelName(lv);
    $("#sideUpdated").textContent = C.updated;
    $("#sideStreak").textContent = tx("side.streak", streak());
    $("#topMinutes").textContent = tx("top.minutes", S.settings.minutes);
    syncAccentBtn();
    paintSync();
  }

  /* ---------------------------------------------------------------- language
   * The static chrome in index.html names its text by data-i18n attributes; a switch redraws
   * it and the current view, keeping the scroll position and everything in the record. */
  function applyStatic() {
    document.title = tx("doc.title");
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", tx("doc.description"));
    $$("[data-i18n]").forEach(function (n) {
      n.textContent = tx(n.getAttribute("data-i18n"));
    });
    $$("[data-i18n-aria-label]").forEach(function (n) {
      n.setAttribute("aria-label", tx(n.getAttribute("data-i18n-aria-label")));
    });
    $$("[data-i18n-title]").forEach(function (n) {
      n.setAttribute("title", tx(n.getAttribute("data-i18n-title")));
    });
    if (REC.active) $("#recBtn").textContent = tx("rec.stop");
  }
  function switchLang(code) {
    if (code === I18N.lang()) return;
    I18N.setLang(code);
  }
  I18N.onChange(function () {
    var y = window.scrollY;
    applyStatic();
    render();
    window.scrollTo(0, y);
  });
  $("#langBtn").addEventListener("click", function () {
    switchLang(I18N.lang() === "zh" ? "en" : "zh");
  });

  /* ================================================================ sync
   * The record lives in the handler's state; the page keeps it in memory only. Until the first
   * GET /data succeeds nothing is sent, so a failed load never overwrites the stored record
   * with defaults. A change is sent 0.8 s after the last edit, and leaving the page sends what
   * is pending. Coming back to the page takes a newer copy saved meanwhile (another tab or
   * device), unless a change made here is still pending. */
  var API = { base: "../api" };
  var SYNC = { ready: false, savedAt: 0, timer: null, busy: false, again: false, failing: false };
  var NET = { online: false, hosts: [] }; // the daily-press switch (GET / PUT ../api/settings)
  var REL = "noopener noreferrer";

  /** An address the page may link to or load: http(s) only, never a javascript: URL. */
  function safeUrl(u) {
    u = String(u == null ? "" : u).trim();
    return /^https?:\/\//i.test(u) ? u : "";
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    var init = { method: opts.method || "GET", headers: headers, cache: "no-store" };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
      // keepalive lets a save finish while the page closes; browsers cap such a body at 64 KB.
      if (opts.keepalive && init.body.length < 60000) init.keepalive = true;
    }
    return fetch(API.base + path, init).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!r.ok) {
            var err = new Error(errorText(data, r.status));
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  }
  /** A handler refusal in the interface language: its `error` code, else its English message. */
  function errorText(data, status) {
    var code = data && typeof data.error === "string" ? data.error : "";
    if (code) {
      var key = "err." + code;
      var text = tx(key);
      if (text !== key) return text;
    }
    if (data && typeof data.message === "string" && data.message) return data.message;
    return status ? tx("err.http", status) : tx("err.network");
  }
  /** A cover the browser may load: only while the learner has the daily-press switch on. */
  function coverSrc(url) {
    return NET.online ? safeUrl(url) : "";
  }

  function queuePush() {
    if (!SYNC.ready) return;
    clearTimeout(SYNC.timer);
    SYNC.timer = setTimeout(pushNow, 800);
  }
  function pushNow(leaving) {
    clearTimeout(SYNC.timer);
    SYNC.timer = null;
    if (!SYNC.ready) return Promise.resolve();
    if (SYNC.busy) {
      SYNC.again = true;
      return Promise.resolve();
    }
    SYNC.busy = true;
    return api("/data", { method: "PUT", body: { data: S }, keepalive: leaving === true })
      .then(
        function (r) {
          SYNC.savedAt = r.savedAt || SYNC.savedAt;
          SYNC.failing = false;
        },
        function (e) {
          var tooBig = e && e.status === 413;
          if (!SYNC.failing)
            toast(
              tx("sync.saveFailed", (e && e.status && e.message) || tx("err.network"), !tooBig),
            );
          SYNC.failing = true;
          if (!tooBig && !SYNC.timer) SYNC.timer = setTimeout(pushNow, 15000);
        },
      )
      .then(function () {
        SYNC.busy = false;
        if (SYNC.again) {
          SYNC.again = false;
          queuePush();
        }
        paintSync();
      });
  }
  function paintSync() {
    var n = $("#sideSync");
    if (!n) return;
    n.textContent = !SYNC.ready
      ? tx("sync.notLoaded")
      : SYNC.failing
        ? tx("sync.failing")
        : tx("sync.ok");
  }
  function flushIfPending() {
    if (SYNC.timer) pushNow(true);
  }
  window.addEventListener("pagehide", flushIfPending);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      flushIfPending();
      return;
    }
    if (!SYNC.ready || SYNC.timer || SYNC.busy) return;
    api("/data").then(
      function (r) {
        if (SYNC.timer || SYNC.busy || !((r.savedAt || 0) > SYNC.savedAt)) return;
        S = adopt(r.data);
        SYNC.savedAt = r.savedAt;
        applyTheme();
        render();
      },
      function () {},
    );
  });

  /* ================================================================ two-page spread */
  function isWide() {
    return window.innerWidth >= 1080;
  }
  /** Splits the content into two pages, the text on the left and the notes on the right, each
   * scrolling on its own on a wide screen. */
  function renderSpread(host, left, right, opts) {
    opts = opts || {};
    var canSplit = isWide() && S.settings.spread !== false && right && right.length;
    if (!canSplit) {
      left.concat(right || []).forEach(function (n) {
        if (n) host.appendChild(n);
      });
      return null;
    }
    var sp = el("div", "spread" + (opts.narrow ? " narrow" : ""));
    var p1 = el("section", "page page-main");
    var p2 = el("section", "page page-side");
    left.forEach(function (n) {
      if (n) p1.appendChild(n);
    });
    right.forEach(function (n) {
      if (n) p2.appendChild(n);
    });
    sp.appendChild(p1);
    sp.appendChild(p2);
    host.appendChild(sp);
    return sp;
  }
  /** The reader's banner and title. o.image (a feed cover) is loaded only while the press switch
   * is on; without it, or when it fails, the banner shows the page's own illustration. */
  function readerHero(o) {
    var head = el("section", "reader-hero");
    var banner = el("div", "banner");
    var cover = coverSrc(o.image);
    if (cover) {
      banner.classList.add("with-photo");
      var img = el("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = cover;
      function giveUp() {
        if (!banner.classList.contains("with-photo")) return;
        banner.classList.remove("with-photo");
        banner.innerHTML = scene(o.art || "book");
      }
      img.addEventListener("error", giveUp);
      img.addEventListener("load", function () {
        if (img.naturalWidth < 40 || img.naturalHeight < 40) giveUp();
      });
      banner.appendChild(img);
    } else {
      banner.innerHTML = scene(o.art || "book");
    }
    head.appendChild(banner);
    var inner = el("div", "inner");
    inner.innerHTML =
      '<div class="row" style="justify-content:space-between">' +
      '<span class="pill accent">' +
      esc(o.pill || "") +
      "</span>" +
      '<span class="faint">' +
      (o.metaHtml || esc(o.meta || "")) +
      "</span></div>" +
      "<h2>" +
      esc(o.title) +
      "</h2>" +
      (o.cn ? '<p class="cn">' + esc(o.cn) + "</p>" : "") +
      (o.note ? '<p class="faint" style="margin-top:10px">' + o.note + "</p>" : "") +
      (o.source ? '<p class="src-line">' + o.source + "</p>" : "");
    head.appendChild(inner);
    return head;
  }

  /* ================================================================ activity heatmap */
  function heatmap() {
    var box = el("div", "heat");
    var cells = [];
    var today = new Date();
    for (var i = 29; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var key = dayKey(d);
      var p = S.progress[key] || {};
      var n =
        Object.keys(p).filter(function (k) {
          return k !== "read";
        }).length + (p.read ? p.read.length : 0);
      var lvl = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3;
      var c = el("span", "heat-cell l" + lvl);
      c.title =
        d.getMonth() + 1 + "/" + d.getDate() + " · " + (n ? tx("heat.done", n) : tx("heat.none"));
      cells.push(c);
    }
    cells.forEach(function (c) {
      box.appendChild(c);
    });
    return box;
  }

  /* ---------------------------------------------------------------- router */
  var ROUTES = [
    "today",
    "press",
    "pressitem",
    "news",
    "article",
    "ted",
    "teditem",
    "books",
    "bookitem",
    "media",
    "wechat",
    "exams",
    "words",
    "resources",
    "settings",
    "more",
    "pasted",
  ];
  var DETAIL = { news: "article", ted: "teditem", books: "bookitem", press: "pressitem" };
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("/").filter(Boolean);
    var name = parts[0] || "today";
    if (parts[1] && DETAIL[name]) return { name: DETAIL[name], id: parts[1], sub: parts[2] || "" };
    return { name: name, id: parts[1] || "", sub: parts[2] || "" };
  }
  window.addEventListener("hashchange", render);
  function go(hash) {
    location.hash = hash;
  }

  function setActiveNav(name) {
    $$("[data-nav]").forEach(function (a) {
      var t = a.dataset.nav;
      a.classList.toggle(
        "on",
        t === name ||
          (name === "article" && t === "news") ||
          (name === "teditem" && t === "ted") ||
          (name === "bookitem" && t === "books") ||
          (name === "pressitem" && t === "press") ||
          (name === "pasted" && t === "news"),
      );
    });
  }
  /** Each route's page title, as an i18n key. */
  var TITLES = {
    today: "nav.today",
    press: "nav.press",
    pressitem: "title.pressitem",
    news: "nav.news",
    ted: "nav.ted",
    books: "nav.books",
    media: "nav.media",
    wechat: "nav.wechat",
    exams: "nav.exams",
    words: "nav.words",
    resources: "nav.resources",
    settings: "nav.settings",
    more: "tab.more",
    article: "nav.news",
    teditem: "nav.ted",
    bookitem: "nav.books",
    pasted: "pasted.defaultTitle",
  };

  function render() {
    var r = parseHash();
    if (ROUTES.indexOf(r.name) < 0) r.name = "today";
    renderNavMeta();
    $("#pageTitle").textContent = tx(TITLES[r.name] || "app.name");
    setActiveNav(r.name);
    var view = $("#view");
    view.innerHTML = "";
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    closePop();
    var isReader = ["article", "teditem", "bookitem", "pasted", "pressitem"].indexOf(r.name) > -1;
    $("#rdbar").hidden = !isReader;
    view.classList.toggle("wide", isReader);
    TTS.stop();
    var fn = VIEWS[r.name];
    if (fn) fn(view, r.id);
  }

  /* ---------------------------------------------------------------- views */
  var VIEWS = {};

  VIEWS.today = function (host) {
    var d = new Date();
    var hour = d.getHours();
    var greet =
      hour < 6
        ? tx("greet.night")
        : hour < 11
          ? tx("greet.morning")
          : hour < 18
            ? tx("greet.afternoon")
            : tx("greet.evening");
    var plan = C.plans[S.settings.minutes] || C.plans[30];
    var tp = todayProgress();
    var doneCount = plan.filter(function (t) {
      return tp[t.key];
    }).length;
    var pct = Math.round((doneCount / plan.length) * 100);

    var hero = el("section", "hero");
    hero.innerHTML =
      '<div class="hero-copy"><p class="eyebrow">' +
      esc(
        tx(
          "today.eyebrow",
          longDate(d),
          S.settings.level,
          levelName(S.settings.level),
          examName(S.settings.exam),
        ),
      ) +
      "</p>" +
      "<h2>" +
      esc(greet) +
      "</h2>" +
      '<p class="lead">' +
      esc(tx("today.lead", levelTip(S.settings.level))) +
      "</p></div>" +
      '<div class="scene">' +
      scene("study") +
      "</div>";
    host.appendChild(hero);

    // Progress and today's tasks
    var planCard = el("section", "card");
    var head = el("div", "card-head");
    head.innerHTML = "<h3>" + esc(tx("today.planTitle", S.settings.minutes)) + "</h3>";
    var ring = el("div", "ring");
    ring.style.setProperty("--p", pct);
    ring.innerHTML = "<span>" + doneCount + "/" + plan.length + "</span>";
    head.appendChild(ring);
    planCard.appendChild(head);
    plan.forEach(function (t) {
      var row = el("button", "task" + (tp[t.key] ? " done" : ""));
      row.type = "button";
      row.style.width = "100%";
      row.style.textAlign = "left";
      row.innerHTML =
        '<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></span>' +
        '<span class="grow"><span class="t-label">' +
        esc(loc(t, "label")) +
        '</span><div class="t-detail">' +
        esc(loc(t, "detail")) +
        "</div></span>";
      row.addEventListener("click", function () {
        toggleTask(t.key);
      });
      planCard.appendChild(row);
    });
    var sw = el("div", "chips");
    sw.style.marginTop = "12px";
    [15, 30, 45].forEach(function (m) {
      var b = el("button", "chip", tx("top.minutes", m));
      b.type = "button";
      b.setAttribute("aria-pressed", S.settings.minutes === m ? "true" : "false");
      b.addEventListener("click", function () {
        S.settings.minutes = m;
        save();
        render();
      });
      sw.appendChild(b);
    });
    planCard.appendChild(sw);
    host.appendChild(planCard);

    // Today's three picks
    var grid = el("div", "grid3");
    grid.style.marginTop = "14px";
    var art = todayArticle();
    grid.appendChild(
      pickCard(
        tx("today.pickNews", loc(art, "topic")),
        art.title,
        art.source +
          " · " +
          art.date +
          " · " +
          (art.approxWords
            ? tx("meta.aboutWords", art.approxWords)
            : tx("meta.annotated", art.vocab.length)),
        "#/news/" + art.id,
        itemArt(art),
      ),
    );
    var ted = C.ted[0];
    grid.appendChild(
      pickCard(
        tx("today.pickTed"),
        ted.title,
        ted.speaker + " · " + ted.duration + " · " + ted.level,
        "#/ted/" + ted.id,
        "talk",
      ),
    );
    var book = C.books[0],
      seg = book.segs[Math.abs(d.getDate()) % book.segs.length];
    grid.appendChild(
      pickCard(
        tx("today.pickBook"),
        book.title,
        book.author + " · " + loc(seg, "label"),
        "#/books/" + book.id,
        "book",
      ),
    );
    host.appendChild(grid);

    // Speaking and exam practice
    var two = el("div", "grid2");
    two.style.marginTop = "14px";
    var speakCard = el("section", "card");
    speakCard.innerHTML =
      "<h3>" +
      esc(tx("today.speakTitle")) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(tx("today.speakSub")) +
      esc(art.question.en) +
      "</p>";
    var hint = el("div", "answer", art.question.hint);
    speakCard.appendChild(hint);
    var goSpeak = el("a", "btn small", tx("today.speakGo"));
    goSpeak.href = "#/news/" + art.id;
    goSpeak.style.marginTop = "10px";
    speakCard.appendChild(goSpeak);
    two.appendChild(speakCard);

    var examItem =
      C.exams.filter(function (x) {
        return x.exam === S.settings.exam;
      })[0] || C.exams[0];
    var examCard = el("section", "card");
    examCard.innerHTML =
      "<h3>" +
      esc(tx("today.examTitle", examName(examItem.exam))) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(loc(examItem, "type")) +
      '</p><p style="font-size:13px;line-height:1.75">' +
      esc(examItem.q) +
      "</p>";
    var goExam = el("a", "btn small", tx("today.examGo"));
    goExam.href = "#/exams";
    goExam.style.marginTop = "10px";
    examCard.appendChild(goExam);
    two.appendChild(examCard);
    host.appendChild(two);

    // Words due for review
    var due = dueWords().slice(0, 5);
    var rev = el("section", "card");
    rev.innerHTML = "<h3>" + esc(tx("today.dueTitle", due.length)) + "</h3>";
    if (!due.length) {
      rev.appendChild(el("p", "sub", tx("today.dueNone")));
    } else {
      var list = el("div", "vocab-list");
      list.style.marginTop = "10px";
      due.forEach(function (w) {
        var it = el("div", "vocab-item");
        it.innerHTML =
          '<div class="w-line"><span class="w-en">' +
          esc(w.en) +
          '</span><span class="ipa">' +
          esc(w.ipa || "") +
          '</span><span class="cn">' +
          esc(w.cn) +
          "</span></div>" +
          (w.ex ? '<div class="ex">' + esc(w.ex) + "</div>" : "");
        list.appendChild(it);
      });
      rev.appendChild(list);
      var goRev = el("a", "btn small primary", tx("today.dueGo"));
      goRev.href = "#/words/review";
      goRev.style.marginTop = "10px";
      rev.appendChild(goRev);
    }
    host.appendChild(rev);

    // This week's numbers
    var stat = el("section", "card");
    var days = 0;
    for (var i = 0; i < 7; i++) {
      var dd = new Date();
      dd.setDate(dd.getDate() - i);
      var p = S.progress[dayKey(dd)];
      if (p && Object.keys(p).length) days++;
    }
    var figure = function (value, label) {
      return (
        '<div><div style="font-size:22px;font-weight:600">' +
        value +
        '</div><div class="faint">' +
        esc(label) +
        "</div></div>"
      );
    };
    stat.innerHTML =
      "<h3>" +
      esc(tx("today.week")) +
      '</h3><div class="row" style="margin-top:10px;gap:18px">' +
      figure(days + "/7", tx("today.statDays")) +
      figure(S.saved.words.length, tx("today.statWords")) +
      figure(S.saved.sentences.length, tx("today.statSentences")) +
      figure(streak(), tx("today.statStreak")) +
      "</div>";
    host.appendChild(stat);

    // The last 30 days, and the way to the daily press
    var heatCard = el("section", "card");
    heatCard.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("today.last30")) +
      '</h3><span class="faint">' +
      esc(tx("side.streak", streak())) +
      "</span></div>";
    heatCard.appendChild(heatmap());
    var heatRow = el("div", "row");
    heatRow.style.marginTop = "12px";
    var goPress = el("a", "btn small primary", tx("today.goPress"));
    goPress.href = "#/press";
    var goWx = el("a", "btn small ghost", tx("today.goWechat"));
    goWx.href = "#/wechat";
    heatRow.appendChild(goPress);
    heatRow.appendChild(goWx);
    heatCard.appendChild(heatRow);
    host.appendChild(heatCard);

    // Weekly review
    var week = el("section", "card");
    week.innerHTML =
      "<h3>" +
      esc(tx("today.review")) +
      '</h3><p class="sub" style="margin:6px 0 12px">' +
      esc(tx("today.reviewSub")) +
      "</p>";
    var topics = {};
    var rows = [];
    var activeDays = 0,
      newWords = 0,
      newSent = 0;
    var weekAgo = Date.now() - 7 * 86400000;
    S.saved.words.forEach(function (w) {
      if ((w.added || 0) >= weekAgo) newWords++;
    });
    S.saved.sentences.forEach(function (s) {
      if ((s.added || 0) >= weekAgo) newSent++;
    });
    for (var k = 6; k >= 0; k--) {
      var dd2 = new Date();
      dd2.setDate(dd2.getDate() - k);
      var key = dayKey(dd2);
      var p2 = S.progress[key] || {};
      var keys = Object.keys(p2).filter(function (x) {
        return x !== "read";
      });
      if (keys.length) activeDays++;
      var readNames = (p2.read || []).map(function (id) {
        var art2 = C.news.filter(function (x) {
          return x.id === id;
        })[0];
        var topic = art2 ? loc(art2, "topic") : "";
        if (art2) topics[topic] = (topics[topic] || 0) + 1;
        return art2 ? topic : tx("today.reviewNews");
      });
      rows.push({
        d: dd2.getMonth() + 1 + "/" + dd2.getDate(),
        read: joinList(readNames),
        tasks: keys.length,
      });
    }
    rows.forEach(function (r2) {
      var row = el("div", "res-item");
      row.innerHTML =
        '<div class="top"><b>' +
        r2.d +
        '</b><span class="faint">' +
        esc(tx("today.reviewTasks", r2.tasks)) +
        '</span><span class="faint">' +
        esc(r2.read ? tx("today.reviewRead", r2.read) : tx("today.reviewNoNews")) +
        "</span></div>";
      week.appendChild(row);
    });
    var dist = Object.keys(topics)
      .map(function (t) {
        return tx("today.topicCount", t, topics[t]);
      })
      .join(" · ");
    var sumLine = el("div", "answer");
    sumLine.style.marginTop = "12px";
    sumLine.textContent = tx("today.summary", dist, newWords, newSent, activeDays);
    week.appendChild(sumLine);
    var advice =
      activeDays >= 5
        ? tx("today.adviceSteady", Math.min(4, S.settings.level + 1))
        : activeDays >= 3
          ? tx("today.adviceOk")
          : tx("today.adviceLow", activeDays);
    if (newWords < 10) advice += tx("today.adviceFewWords");
    var adviceBox = el("p", "sub");
    adviceBox.style.marginTop = "10px";
    adviceBox.textContent = tx("today.advice", advice);
    week.appendChild(adviceBox);
    host.appendChild(week);

    var foot = el("p", "faint");
    foot.style.marginTop = "18px";
    foot.textContent = tx("today.footer", C.updated, loc(C, "updatedNote"));
    host.appendChild(foot);
  };

  function pickCard(kicker, title, meta, href, art) {
    var a = el("a", "pick");
    a.href = href;
    a.innerHTML =
      '<span class="pick-art">' +
      scene(art || "study") +
      "</span>" +
      '<span class="pick-body"><span class="kicker">' +
      esc(kicker) +
      '</span><span class="title">' +
      esc(title) +
      '</span><span class="meta">' +
      esc(meta) +
      "</span></span>";
    return a;
  }
  /** An item's illustration: a content item names its own (`art`); a press item's comes from
   * its topic key. */
  var TOPIC_ART = {
    world: "city",
    business: "city",
    culture: "book",
    tech: "space",
    science: "space",
  };
  function itemArt(item) {
    if (item && typeof item.art === "string" && ART[item.art]) return item.art;
    var topic = item ? String(item.topic || "") : "";
    return Object.prototype.hasOwnProperty.call(TOPIC_ART, topic) ? TOPIC_ART[topic] : "pen";
  }
  /** A press item's topic key in the interface language. */
  function pressTopic(item) {
    return item && item.topic ? tag("press.cat", item.topic) : tx("press.fallbackSource");
  }

  /** The paste box: `a` is the news item the text belongs to (its annotations then apply), or null. */
  function pasteCard(a) {
    var paste = el("section", "card");
    paste.style.marginTop = "14px";
    paste.innerHTML =
      "<h3>" +
      esc(tx(a ? "paste.forItemTitle" : "paste.ownTitle")) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(tx(a ? "paste.forItemSub" : "paste.ownSub")) +
      "</p>";
    var ta = el("textarea");
    ta.rows = 4;
    ta.placeholder = tx("paste.placeholder");
    var ok = el("button", "btn small primary", tx("paste.open"));
    ok.type = "button";
    ok.style.marginTop = "10px";
    ok.addEventListener("click", function () {
      if (wordCount(ta.value) < 20) {
        toast(tx("paste.tooShort"));
        return;
      }
      S.pasted = { text: ta.value, title: a ? a.title : "", from: a ? a.id : "" };
      save();
      go("#/pasted");
    });
    paste.appendChild(ta);
    paste.appendChild(ok);
    return paste;
  }

  VIEWS.news = function (host) {
    var p = el("p", "sub");
    p.textContent = tx("news.intro");
    host.appendChild(p);
    host.appendChild(pasteCard(null));

    C.news.forEach(function (a) {
      var card = el("a", "pick");
      card.href = "#/news/" + a.id;
      card.style.marginTop = "16px";
      var full = a.paragraphs && a.paragraphs.length;
      var url = safeUrl(a.url);
      card.innerHTML =
        '<span class="pick-art" style="height:132px">' +
        scene(itemArt(a)) +
        "</span>" +
        '<span class="pick-body">' +
        '<span class="row" style="justify-content:space-between"><span class="pill accent">' +
        esc(loc(a, "topic")) +
        '</span><span class="faint">' +
        esc(a.source) +
        " · " +
        esc(a.date) +
        (url
          ? ' · <span class="src-jump" data-src="' +
            esc(url) +
            '">' +
            esc(tx("news.original")) +
            "</span>"
          : "") +
        "</span></span>" +
        '<span class="title" style="font-size:21px;margin-top:4px">' +
        esc(a.title) +
        "</span>" +
        '<span class="meta" style="font-size:15px;color:var(--muted);line-height:1.7">' +
        esc(a.titleCN) +
        "</span>" +
        (a.blurb ? '<span class="meta">' + esc(a.blurb) + "</span>" : "") +
        '<span class="meta">' +
        esc(tx("news.cardMeta", !!full, a.vocab.length)) +
        "</span>" +
        "</span>";
      card.addEventListener("click", function (e) {
        var jump = e.target.closest(".src-jump");
        if (!jump) return;
        e.preventDefault();
        e.stopPropagation();
        var u = safeUrl(jump.getAttribute("data-src"));
        if (u) window.open(u, "_blank", "noopener,noreferrer");
      });
      host.appendChild(card);
    });
  };

  /* A news item: with `paragraphs` (text you may redistribute) it opens as the full reader; the
   * shipped items carry only a link, the annotated words and a question, and open as a guide
   * with a paste box. Every right-page card shows only when the item has its data. */
  VIEWS.article = function (host, id) {
    var a = C.news.filter(function (x) {
      return x.id === id;
    })[0];
    if (!a) return VIEWS.news(host);
    var paras = a.paragraphs || [];
    var full = paras.length > 0;
    var url = safeUrl(a.url);
    var link = url
      ? '<a href="' +
        esc(url) +
        '" target="_blank" rel="' +
        REL +
        '">' +
        esc(tx("article.link")) +
        "</a>"
      : "";
    var lim = L().words;
    var cut = cutParagraphs(paras, lim);
    var expanded = false;
    var shownVocab = (a.vocab || []).slice(0, L().vocab);

    host.appendChild(
      readerHero({
        art: itemArt(a),
        pill: loc(a, "topic"),
        meta: a.source + " · " + a.date,
        title: a.title,
        cn: a.titleCN,
        note: full
          ? esc(
              tx(
                "article.note",
                S.settings.level,
                cut.shown,
                paras.length,
                wordCount(
                  paras
                    .map(function (p) {
                      return p.en;
                    })
                    .join(" "),
                ),
              ),
            ) + (link ? " · " + link : "")
          : esc(a.blurb || "") + (link ? " · " + link : ""),
      }),
    );

    var left = [],
      passage = null;
    if (full) {
      var tools = el("div", "card");
      var row = el("div", "row");
      var needsCut = cut.shown < paras.length;
      var bAll = el("button", "btn small", tx("article.showAll"));
      bAll.type = "button";
      bAll.disabled = !needsCut;
      var bCN = el("button", "chip", S.settings.showCN ? tx("cn.on") : tx("cn.off"));
      bCN.type = "button";
      bCN.addEventListener("click", function () {
        S.settings.showCN = !S.settings.showCN;
        save();
        render();
      });
      var bRead = el("button", "btn small primary", tx("article.readAll"));
      bRead.type = "button";
      row.appendChild(bAll);
      row.appendChild(bRead);
      row.appendChild(bCN);
      tools.appendChild(row);

      passage = el("section", "card passage");
      var paint = function () {
        passage.innerHTML = "";
        renderPassage(passage, paras, {
          vocab: shownVocab,
          showCN: S.settings.showCN,
          limit: expanded ? 0 : lim,
        });
        bAll.textContent = !needsCut
          ? tx("article.coveredAll")
          : expanded
            ? tx("article.onlyLevel")
            : tx("article.showAll");
      };
      paint();
      bAll.addEventListener("click", function () {
        expanded = !expanded;
        paint();
      });
      bRead.addEventListener("click", function () {
        speakContainer(passage);
      });
      passage.addEventListener("click", function (e) {
        var w = e.target.closest(".w");
        if (w) {
          showWordPop(w, e);
          return;
        }
        var s = e.target.closest(".sent");
        if (s) speakContainer(s);
      });
      left = [tools, readTip(), passage];
    } else {
      var srcCard = el("section", "card");
      srcCard.innerHTML =
        '<div class="card-head"><h3>' +
        esc(tx("article.atSourceTitle")) +
        '</h3><span class="faint">' +
        esc(a.source) +
        "</span></div>" +
        '<p class="sub" style="margin:6px 0 10px">' +
        esc(tx("article.atSourceSub")) +
        "</p>";
      if (url) {
        var openSrc = el("a", "btn small primary", tx("article.openSource"));
        openSrc.href = url;
        openSrc.target = "_blank";
        openSrc.rel = REL;
        srcCard.appendChild(openSrc);
      }
      left = [srcCard, pasteCard(a)];
    }

    /* ---- right page ---- */
    var right = [];
    if (a.quiz && a.quiz.length) right.push(quizCard(a));

    if (shownVocab.length) {
      var vocabCard = el("section", "card");
      vocabCard.innerHTML =
        '<div class="card-head"><h3>' +
        esc(tx("article.vocabTitle", shownVocab.length)) +
        '</h3><span class="faint">' +
        esc(tx(full ? "article.vocabBoxed" : "article.vocabBefore")) +
        "</span></div>";
      var vlist = el("div", "vocab-list");
      shownVocab.forEach(function (v) {
        var it = el("div", "vocab-item");
        it.innerHTML =
          '<div class="w-line"><span class="w-en">' +
          esc(v.w) +
          '</span><span class="ipa">' +
          esc(v.ipa) +
          "</span></div>" +
          '<div class="cn">' +
          esc(v.pos + " " + v.cn) +
          "</div>" +
          '<div class="meta">' +
          esc(tx("vocab.coll")) +
          esc(v.coll) +
          '</div><div class="ex">' +
          esc(v.ex) +
          "</div>";
        var t = el("div", "tools");
        var b1 = el("button", "btn small ghost", tx("common.read"));
        b1.type = "button";
        b1.addEventListener("click", function () {
          TTS.words = [];
          TTS.speak(v.w, {});
        });
        var b2 = el("button", "btn small ghost", tx("pop.add"));
        b2.type = "button";
        b2.addEventListener("click", function () {
          addWord({
            en: v.w,
            ipa: v.ipa,
            pos: v.pos,
            cn: v.cn,
            coll: v.coll,
            ex: v.ex,
            src: a.title,
          });
          b2.textContent = tx("pop.added");
          b2.disabled = true;
          toast(tx("toast.addedWord"));
        });
        t.appendChild(b1);
        t.appendChild(b2);
        it.appendChild(t);
        vlist.appendChild(it);
      });
      vocabCard.appendChild(vlist);
      right.push(vocabCard);
    }

    if (a.breaks && a.breaks.length) {
      var brCard = el("section", "card");
      brCard.innerHTML =
        "<h3>" + esc(tx("article.breaksTitle", Math.min(L().breaks, a.breaks.length))) + "</h3>";
      a.breaks.slice(0, L().breaks).forEach(function (b) {
        var box = el("div", "break");
        box.style.marginTop = "10px";
        box.innerHTML =
          '<div class="src">' +
          esc(b.en) +
          "</div><dl>" +
          "<dt>" +
          esc(tx("break.main")) +
          "</dt><dd>" +
          esc(b.main) +
          "</dd>" +
          "<dt>" +
          esc(tx("break.mods")) +
          "</dt><dd>" +
          esc(b.mods) +
          "</dd>" +
          "<dt>" +
          esc(tx("break.cn")) +
          "</dt><dd>" +
          esc(b.cn) +
          "</dd></dl>" +
          '<div class="model"><span class="faint">' +
          esc(tx("break.model")) +
          "</span><br>" +
          esc(b.model) +
          "</div>";
        var tb = el("div", "tools");
        tb.style.marginTop = "8px";
        var bb = el("button", "btn small ghost", tx("break.readSrc"));
        bb.type = "button";
        bb.addEventListener("click", function () {
          TTS.words = [];
          TTS.speak(b.en, {});
        });
        var bs = el("button", "btn small ghost", tx("break.save"));
        bs.type = "button";
        bs.addEventListener("click", function () {
          addSentence(b.model);
        });
        tb.appendChild(bb);
        tb.appendChild(bs);
        box.appendChild(tb);
        brCard.appendChild(box);
      });
      right.push(brCard);
    }

    if (a.notes && a.notes.length) {
      var noteCard = el("section", "card");
      noteCard.innerHTML = "<h3>" + esc(tx("article.notesTitle")) + "</h3>";
      a.notes.slice(0, L().notes).forEach(function (n) {
        var nb = el("div", "note-box");
        nb.style.marginTop = "12px";
        nb.innerHTML = "<b>" + esc(n.t) + "</b><br>" + esc(n.body);
        noteCard.appendChild(nb);
      });
      right.push(noteCard);
    }

    var exam = a.exam && (a.exam[S.settings.exam] || a.exam.IELTS);
    if (exam) {
      var examCard = el("section", "card");
      examCard.innerHTML =
        '<div class="card-head"><h3>' +
        esc(tx("article.examTitle", examName(S.settings.exam))) +
        '</h3><a class="faint" href="#/settings">' +
        esc(tx("article.examChange")) +
        "</a></div>";
      var map = el("div", "exam-map");
      if (exam.speaking) {
        exam.speaking.forEach(function (s) {
          var it = el("div", "item");
          it.innerHTML = "<b>" + esc(s.tag) + "</b>" + esc(s.en);
          map.appendChild(it);
        });
      }
      if (exam.reading)
        map.appendChild(
          mapItem(
            tx("map.reading"),
            exam.reading.from + " → " + exam.reading.to + tx("map.sep") + exam.reading.note,
          ),
        );
      if (exam.academic)
        map.appendChild(
          mapItem(tx("map.academic"), exam.academic.w + tx("map.colon") + exam.academic.note),
        );
      if (exam.sentence) map.appendChild(mapItem(tx("map.sentence"), exam.sentence));
      if (exam.word)
        map.appendChild(mapItem(tx("map.word"), exam.word.w + tx("map.colon") + exam.word.note));
      if (exam.structure) map.appendChild(mapItem(tx("map.structure"), exam.structure));
      if (exam.writing) map.appendChild(mapItem(tx("map.writing"), exam.writing));
      examCard.appendChild(map);
      right.push(examCard);
    }

    if (a.question) {
      var qCard = el("section", "card");
      qCard.innerHTML =
        "<h3>" +
        esc(tx("question.title")) +
        "</h3>" +
        '<p style="font-family:var(--serif);font-size:16.5px;line-height:1.8;margin:8px 0 6px">' +
        esc(a.question.en) +
        "</p>" +
        '<p class="sub">' +
        esc(a.question.cn) +
        "</p>" +
        '<p class="faint" style="margin-top:8px">' +
        esc(tx("question.hint", a.question.hint)) +
        "</p>";
      var ans = el("textarea");
      ans.rows = 4;
      ans.placeholder = tx("question.placeholder");
      ans.value = S.answers[a.id] || "";
      ans.style.marginTop = "10px";
      ans.addEventListener("input", function () {
        S.answers[a.id] = ans.value;
        save();
      });
      qCard.appendChild(ans);
      var qrow = el("div", "row");
      qrow.style.marginTop = "10px";
      var bRec = el("button", "btn small", tx("question.record"));
      bRec.type = "button";
      bRec.addEventListener("click", function () {
        REC.start(passage || qCard, qCard);
      });
      var bDone = el(
        "button",
        "btn small primary",
        todayProgress().news ? tx("common.done") : tx("common.markRead"),
      );
      bDone.type = "button";
      bDone.addEventListener("click", function () {
        toggleTask("news");
        if (todayProgress().news) markRead("news", a.id);
      });
      qrow.appendChild(bRec);
      qrow.appendChild(bDone);
      qCard.appendChild(qrow);
      right.push(qCard);
    }

    renderSpread(host, left, right);
  };

  function mapItem(label, text) {
    var it = el("div", "item");
    it.innerHTML = "<b>" + esc(label) + "</b>" + esc(text);
    return it;
  }
  /** Comprehension questions: a click marks the choice and shows the explanation; choices are
   * kept in S.quiz. */
  function quizCard(a) {
    var card = el("section", "card");
    card.style.marginTop = "16px";
    card.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("quiz.title", a.quiz.length)) +
      '</h3><span class="faint">' +
      esc(tx("quiz.sub")) +
      "</span></div>";
    if (!S.quiz[a.id]) S.quiz[a.id] = {};
    var st = S.quiz[a.id];

    a.quiz.forEach(function (q, qi) {
      var box = el("div", "quiz");
      var qt = el("div", "qtext", qi + 1 + ". " + q.q);
      if (q.tag) qt.appendChild(el("span", "qtag", q.tag));
      box.appendChild(qt);

      var opts = el("div", "opts");
      var exp = el("div", "explain");
      exp.hidden = true;

      function show(choice) {
        $$(".opt", opts).forEach(function (n, ni) {
          n.classList.remove("right", "wrong");
          if (ni === q.a) n.classList.add("right");
          else if (ni === choice) n.classList.add("wrong");
        });
        exp.hidden = false;
        exp.textContent =
          (choice === q.a ? tx("quiz.right") : tx("quiz.answer", "ABCD".charAt(q.a))) + q.why;
      }

      q.opts.forEach(function (o, oi) {
        var b = el("button", "opt");
        b.type = "button";
        b.innerHTML =
          '<span class="letter">' + "ABCD".charAt(oi) + "</span><span>" + esc(o) + "</span>";
        b.addEventListener("click", function () {
          st[qi] = oi;
          save();
          show(oi);
        });
        opts.appendChild(b);
      });
      box.appendChild(opts);
      box.appendChild(exp);
      if (st[qi] !== undefined) show(st[qi]);
      card.appendChild(box);
    });

    var foot = el("div", "row");
    foot.style.marginTop = "14px";
    var score = el("span", "pill");
    function paintScore() {
      var n = 0,
        done = 0;
      a.quiz.forEach(function (q, i2) {
        if (st[i2] !== undefined) {
          done++;
          if (st[i2] === q.a) n++;
        }
      });
      score.textContent = tx("quiz.score", done, a.quiz.length, n);
    }
    paintScore();
    card.addEventListener("click", paintScore);
    var bReset = el("button", "btn small ghost", tx("quiz.reset"));
    bReset.type = "button";
    bReset.addEventListener("click", function () {
      S.quiz[a.id] = {};
      save();
      render();
    });
    foot.appendChild(score);
    foot.appendChild(bReset);
    card.appendChild(foot);
    return card;
  }
  function cutParagraphs(paras, limit) {
    if (!limit || limit > 9000) return { shown: paras.length };
    var used = 0,
      shown = 0;
    for (var i = 0; i < paras.length; i++) {
      if (used >= limit) break;
      used += wordCount(paras[i].en);
      shown++;
    }
    return { shown: Math.max(1, shown) };
  }

  // The TED topic filter: a talk's `topic` as written in content.js, "" for all of them.
  var tedTopic = "";
  VIEWS.ted = function (host) {
    host.appendChild(el("p", "sub", tx("ted.intro")));

    var topics = [""],
      labels = { "": tx("common.all") };
    C.ted.concat(C.tedLinks).forEach(function (t) {
      if (topics.indexOf(t.topic) < 0) {
        topics.push(t.topic);
        labels[t.topic] = loc(t, "topic");
      }
    });
    var bar = el("div", "chips");
    bar.style.margin = "12px 0";
    topics.forEach(function (tp) {
      var b = el("button", "chip", labels[tp]);
      b.type = "button";
      b.setAttribute("aria-pressed", tp === tedTopic ? "true" : "false");
      b.addEventListener("click", function () {
        tedTopic = tp;
        render();
      });
      bar.appendChild(b);
    });
    host.appendChild(bar);

    var list = el("div", "stack");
    // Talks with study material written for this app
    C.ted
      .filter(function (t) {
        return !tedTopic || t.topic === tedTopic;
      })
      .forEach(function (t) {
        var card = el("a", "pick");
        card.href = "#/ted/" + t.id;
        var lines = (t.lines || []).length;
        card.innerHTML =
          '<span class="pick-art" style="height:118px">' +
          scene("talk") +
          "</span>" +
          '<span class="pick-body"><span class="row" style="justify-content:space-between"><span class="pill accent">' +
          esc(loc(t, "topic")) +
          '</span><span class="faint">' +
          esc(t.year) +
          " · " +
          esc(t.duration) +
          "</span></span>" +
          '<span class="title" style="font-size:20px;margin-top:4px">' +
          esc(t.title) +
          "</span>" +
          '<span class="meta" style="font-size:15px;color:var(--muted)">' +
          esc(t.titleCN) +
          " · " +
          esc(t.speaker) +
          "</span>" +
          '<span class="meta">' +
          esc(tx("ted.cardMeta", t.level, lines, t.vocab.length)) +
          "</span></span>";
        list.appendChild(card);
      });
    // Link-only talks
    C.tedLinks
      .filter(function (t) {
        return !tedTopic || t.topic === tedTopic;
      })
      .forEach(function (t) {
        var card = el("a", "pick");
        card.href = safeUrl(t.url);
        card.target = "_blank";
        card.rel = REL;
        card.innerHTML =
          '<span class="pick-art" style="height:104px">' +
          scene("talk") +
          "</span>" +
          '<span class="pick-body"><span class="row" style="justify-content:space-between"><span class="pill">' +
          esc(loc(t, "topic")) +
          '</span><span class="faint">' +
          esc(t.year) +
          " · " +
          esc(tx("ted.aboutMin", t.minutes)) +
          "</span></span>" +
          '<span class="title" style="font-size:20px;margin-top:4px">' +
          esc(t.title) +
          "</span>" +
          '<span class="meta" style="font-size:15px;color:var(--muted)">' +
          esc(t.titleCN) +
          " · " +
          esc(t.speaker) +
          "</span>" +
          '<span class="meta">' +
          esc(tx("ted.linkMeta", t.level)) +
          "</span>" +
          '<span class="meta" style="font-family:var(--serif);font-size:15px;line-height:1.75">' +
          esc(t.blurb) +
          "</span></span>";
        list.appendChild(card);
      });
    host.appendChild(list);
    var note = el("p", "faint");
    note.style.marginTop = "16px";
    note.textContent = tx("ted.note");
    host.appendChild(note);
  };

  VIEWS.teditem = function (host, id) {
    var t = C.ted.filter(function (x) {
      return x.id === id;
    })[0];
    if (!t) return VIEWS.ted(host);
    var head = el("section", "reader-hero");
    head.innerHTML =
      '<div class="banner">' +
      scene("talk") +
      "</div>" +
      '<div class="inner"><div class="row" style="justify-content:space-between"><span class="pill accent">' +
      esc(loc(t, "topic")) +
      '</span><span class="faint">' +
      esc(t.year) +
      " · " +
      esc(t.duration) +
      "</span></div>" +
      "<h2>" +
      esc(t.title) +
      '</h2><p class="cn">' +
      esc(t.titleCN) +
      " · " +
      esc(t.speaker) +
      "</p></div>";
    host.appendChild(head);
    var lines = t.lines || [];
    if (lines.length) host.appendChild(readTip());

    /* ---- left page: the video link, and the transcript when the item carries one ---- */
    var left = [];
    var video = el("div", "video-card");
    video.innerHTML =
      '<div class="video-poster"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg></div>' +
      '<div class="video-body"><p class="faint">' +
      esc(tx(lines.length ? "ted.videoEmbedded" : "ted.videoAtTed")) +
      "</p>" +
      '<a class="btn small primary" style="margin-top:10px" href="' +
      esc(safeUrl(t.url)) +
      '" target="_blank" rel="' +
      REL +
      '">' +
      esc(tx("ted.openVideo")) +
      "</a>" +
      '<p class="faint" style="margin-top:10px">' +
      esc(t.level) +
      " · " +
      esc(loc(t, "topic")) +
      " · " +
      esc(t.duration) +
      "</p></div>";
    left.push(video);

    var tset = {};
    t.vocab.forEach(function (v) {
      tset[normWord(v.w)] = true;
    });
    var mid = el("div", "script passage");
    lines.forEach(function (line, i) {
      var row = el("div", "line");
      var b = el("button", "play");
      b.type = "button";
      b.setAttribute("aria-label", tx("ted.playLine", i + 1));
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
      b.addEventListener("click", function () {
        speakContainer(row);
      });
      var body = el("div");
      var en = el("div", "en");
      en.appendChild(buildSentence(line.en, tset));
      body.appendChild(en);
      body.appendChild(el("div", "zh", line.cn));
      row.appendChild(b);
      row.appendChild(body);
      mid.appendChild(row);
    });
    mid.addEventListener("click", function (e) {
      var w = e.target.closest(".w");
      if (w) {
        showWordPop(w, e);
        return;
      }
      if (e.target.closest(".play")) return;
      var s = e.target.closest(".line");
      if (s) speakContainer(s);
    });
    if (lines.length) left.push(mid);

    /* ---- right page: summary / words / long sentences / question / notes ---- */
    var right = [];
    var sum = el("section", "card");
    sum.innerHTML =
      '<div class="card-head"><h3>' +
      tx("ted.summaryTitleHtml") +
      '</h3><span class="faint">' +
      esc(tx("ted.summarySub")) +
      "</span></div>";
    t.summary.forEach(function (s) {
      sum.appendChild(el("p", "sub", s));
    });
    right.push(sum);

    var voc = el("section", "card");
    voc.innerHTML =
      '<div class="card-head"><h3>Vocabulary · ' +
      t.vocab.length +
      '</h3><span class="faint">' +
      esc(tx("ted.vocabSub")) +
      "</span></div>";
    var vlist = el("div", "vocab-list");
    t.vocab.forEach(function (v) {
      var it = el("div", "vocab-item");
      it.style.marginTop = "8px";
      it.innerHTML =
        '<div class="w-line"><span class="w-en">' +
        esc(v.w) +
        '</span><span class="ipa">' +
        esc(v.ipa) +
        '</span></div><div class="cn">' +
        esc(v.pos + " " + v.cn) +
        '</div><div class="meta">' +
        esc(v.coll) +
        '</div><div class="ex">' +
        esc(v.ex) +
        "</div>";
      var b = el("button", "btn small ghost", tx("pop.add"));
      b.type = "button";
      b.style.marginTop = "8px";
      b.addEventListener("click", function () {
        addWord({
          en: v.w,
          ipa: v.ipa,
          pos: v.pos,
          cn: v.cn,
          coll: v.coll,
          ex: v.ex || "",
          src: t.title,
        });
        b.textContent = tx("pop.added");
        toast(tx("toast.addedWord"));
      });
      it.appendChild(b);
      vlist.appendChild(it);
    });
    voc.appendChild(vlist);
    right.push(voc);

    var br = el("section", "card");
    br.innerHTML = "<h3>" + esc(tx("ted.breaksTitle")) + "</h3>";
    (t.breaks || []).forEach(function (b) {
      var box = el("div", "break");
      box.style.marginTop = "10px";
      box.innerHTML =
        '<div class="src">' +
        esc(b.en) +
        "</div><dl><dt>" +
        esc(tx("break.main")) +
        "</dt><dd>" +
        esc(b.main) +
        "</dd><dt>" +
        esc(tx("break.modsShort")) +
        "</dt><dd>" +
        esc(b.mods) +
        "</dd><dt>" +
        esc(tx("break.cnShort")) +
        "</dt><dd>" +
        esc(b.cn) +
        '</dd></dl><div class="model">' +
        esc(b.model) +
        "</div>";
      var rb = el("button", "btn small ghost", tx("break.readSrc"));
      rb.type = "button";
      rb.style.marginTop = "8px";
      rb.addEventListener("click", function () {
        TTS.words = [];
        TTS.speak(b.en, {});
      });
      box.appendChild(rb);
      br.appendChild(box);
    });
    if (t.breaks && t.breaks.length) right.push(br);

    var q = el("section", "card");
    q.innerHTML =
      "<h3>" +
      esc(tx("ted.question")) +
      '</h3><p style="font-family:var(--serif);font-size:15px;line-height:1.8;margin:8px 0 4px">' +
      esc(t.question.en) +
      '</p><p class="sub">' +
      esc(t.question.cn) +
      '</p><p class="faint" style="margin-top:6px">' +
      esc(t.question.hint) +
      "</p>";
    var done = el(
      "button",
      "btn small primary",
      todayProgress().ted ? tx("common.done") : tx("ted.markDone"),
    );
    done.type = "button";
    done.style.marginTop = "10px";
    done.addEventListener("click", function () {
      toggleTask("ted");
      done.textContent = todayProgress().ted ? tx("common.done") : tx("ted.markDone");
    });
    q.appendChild(done);
    right.push(q);

    var mine = el("section", "card");
    mine.innerHTML = "<h3>" + esc(tx("notes.title")) + "</h3>";
    var ta = el("textarea");
    ta.rows = 6;
    ta.style.marginTop = "8px";
    ta.value = S.notes[t.id] || "";
    ta.placeholder = tx("ted.notesPlaceholder");
    ta.addEventListener("input", function () {
      S.notes[t.id] = ta.value;
      save();
    });
    mine.appendChild(ta);
    var bExp = el("button", "btn small ghost", tx("notes.export"));
    bExp.type = "button";
    bExp.style.marginTop = "8px";
    bExp.addEventListener("click", function () {
      var md =
        "# " +
        t.title +
        "\n\n" +
        t.speaker +
        " · " +
        t.year +
        " · " +
        t.duration +
        "\n\n## Summary\n\n" +
        t.summary
          .map(function (s) {
            return "- " + s;
          })
          .join("\n") +
        "\n\n## Vocabulary\n\n" +
        t.vocab
          .map(function (v) {
            return "- **" + v.w + "** " + v.ipa + " " + v.cn + " — " + v.coll + " — " + v.ex;
          })
          .join("\n") +
        "\n\n## " +
        tx("notes.title") +
        "\n\n" +
        (S.notes[t.id] || tx("notes.empty")) +
        "\n";
      download(t.title.replace(/[^\w]+/g, "-") + ".md", md, "text/markdown");
    });
    mine.appendChild(bExp);
    right.push(mine);

    renderSpread(host, left, right);
  };

  VIEWS.books = function (host) {
    host.appendChild(el("p", "sub", tx("books.intro")));
    C.books.forEach(function (b) {
      var card = el("section", "card");
      card.style.marginTop = "16px";
      card.style.padding = "0";
      card.style.overflow = "hidden";
      card.innerHTML =
        '<div class="banner" style="height:132px">' +
        scene("book") +
        "</div>" +
        '<div style="padding:22px 24px 24px"><h3 style="font-size:21px">' +
        esc(b.title) +
        "</h3>" +
        '<p class="sub" style="margin-top:6px">' +
        esc(b.titleCN) +
        " · " +
        esc(b.author) +
        " · " +
        b.year +
        "</p>" +
        '<p class="faint" style="margin-top:8px">' +
        esc(b.level) +
        " · " +
        esc(tx("books.passages", b.segs.length)) +
        ' · <a href="' +
        esc(safeUrl(b.gutenberg)) +
        '" target="_blank" rel="' +
        REL +
        '">' +
        esc(tx("books.gutenberg")) +
        "</a></p>" +
        '<div class="chips" style="margin-top:12px" data-segs></div></div>';
      var segs = card.querySelector("[data-segs]");
      b.segs.forEach(function (seg, i) {
        var a = el("a", "chip", loc(seg, "label"));
        a.href = "#/books/" + b.id + "/" + i;
        segs.appendChild(a);
      });
      host.appendChild(card);
    });
  };

  VIEWS.bookitem = function (host, id) {
    var b = C.books.filter(function (x) {
      return x.id === id;
    })[0];
    if (!b) return VIEWS.books(host);
    var qindex = parseInt(location.hash.split("/")[3] || "0", 10) || 0;
    var seg = b.segs[Math.min(qindex, b.segs.length - 1)];

    var head = el("section", "reader-hero");
    head.innerHTML =
      '<div class="banner">' +
      scene("book") +
      "</div>" +
      '<div class="inner"><h2>' +
      esc(b.title) +
      '</h2><p class="cn">' +
      esc(loc(seg, "label")) +
      " · " +
      esc(b.author) +
      " · " +
      b.year +
      ' · <a href="' +
      esc(safeUrl(b.gutenberg)) +
      '" target="_blank" rel="' +
      REL +
      '">' +
      esc(tx("books.gutenberg")) +
      "</a></p></div>";
    host.appendChild(head);

    var nav = el("div", "chips");
    nav.style.margin = "10px 0";
    b.segs.forEach(function (s, i) {
      var a = el("a", "chip", loc(s, "label"));
      a.href = "#/books/" + b.id + "/" + i;
      a.setAttribute("aria-pressed", i === qindex ? "true" : "false");
      nav.appendChild(a);
    });
    host.appendChild(nav);

    var passage = el("section", "card passage");
    function paintBook() {
      passage.innerHTML = "";
      renderPassage(passage, seg.paragraphs, { vocab: seg.vocab, showCN: S.settings.showCN });
    }
    paintBook();
    passage.addEventListener("click", function (e) {
      var w = e.target.closest(".w");
      if (w) {
        showWordPop(w, e);
        return;
      }
      var s = e.target.closest(".sent");
      if (s) speakContainer(s);
    });
    var legend = readTip();

    /* ---- right page ---- */
    var right = [];
    var v = el("section", "card");
    v.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("book.vocabTitle", seg.vocab.length)) +
      '</h3><span class="faint">' +
      esc(tx("book.vocabSub")) +
      "</span></div>";
    var vl = el("div", "vocab-list");
    seg.vocab.forEach(function (x) {
      var it = el("div", "vocab-item");
      it.innerHTML =
        '<div class="w-line"><span class="w-en">' +
        esc(x.w) +
        '</span><span class="ipa">' +
        esc(x.ipa) +
        '</span></div><div class="cn">' +
        esc(x.pos + " " + x.cn) +
        '</div><div class="meta">' +
        esc(x.coll) +
        '</div><div class="ex">' +
        esc(x.ex) +
        "</div>";
      var t = el("div", "tools");
      var bb = el("button", "btn small ghost", tx("common.read"));
      bb.type = "button";
      bb.addEventListener("click", function () {
        TTS.words = [];
        TTS.speak(x.w, {});
      });
      var bs = el("button", "btn small ghost", tx("pop.add"));
      bs.type = "button";
      bs.addEventListener("click", function () {
        addWord({
          en: x.w,
          ipa: x.ipa,
          pos: x.pos,
          cn: x.cn,
          coll: x.coll,
          ex: x.ex || "",
          src: b.title,
        });
        bs.textContent = tx("pop.added");
        bs.disabled = true;
      });
      t.appendChild(bb);
      t.appendChild(bs);
      it.appendChild(t);
      vl.appendChild(it);
    });
    v.appendChild(vl);
    right.push(v);

    var good = el("section", "card");
    good.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("book.goodTitle")) +
      '</h3><span class="faint">' +
      esc(loc(seg, "label")) +
      "</span></div>" +
      '<div class="src" style="font-family:var(--serif);font-size:15.5px;line-height:1.85">' +
      esc(seg.good.en) +
      "</div>" +
      '<p class="sub" style="line-height:1.8;margin-top:10px">' +
      esc(seg.good.note) +
      "</p>";
    var rb = el("button", "btn small ghost", tx("book.readThis"));
    rb.type = "button";
    rb.style.marginTop = "10px";
    rb.addEventListener("click", function () {
      TTS.words = [];
      TTS.speak(seg.good.en, { rate: 0.9 });
    });
    var sb = el("button", "btn small ghost", tx("break.save"));
    sb.type = "button";
    sb.style.marginTop = "10px";
    sb.style.marginLeft = "8px";
    sb.addEventListener("click", function () {
      addSentence(seg.good.en);
    });
    good.appendChild(rb);
    good.appendChild(sb);
    right.push(good);

    var prog = el("section", "card");
    prog.innerHTML = "<h3>" + esc(tx("book.todayTitle")) + "</h3>";
    var done = el(
      "button",
      "btn small primary",
      todayProgress().book ? tx("common.done") : tx("common.markRead"),
    );
    done.type = "button";
    done.style.marginTop = "10px";
    done.addEventListener("click", function () {
      toggleTask("book");
      done.textContent = todayProgress().book ? tx("common.done") : tx("common.markRead");
    });
    prog.appendChild(done);
    var other = el("a", "btn small ghost", tx("book.another"));
    other.href = "#/books/" + b.id + "/" + ((qindex + 1) % b.segs.length);
    other.style.marginTop = "10px";
    other.style.marginLeft = "8px";
    prog.appendChild(other);
    right.push(prog);

    renderSpread(host, [legend, passage], right);
  };

  VIEWS.pasted = function (host) {
    if (!S.pasted.text) return VIEWS.news(host);
    // Text pasted for a news item takes that item's annotated words.
    var from = S.pasted.from
      ? C.news.filter(function (x) {
          return x.id === S.pasted.from;
        })[0]
      : null;
    var head = el("section", "reader-hero");
    head.innerHTML =
      '<div class="banner">' +
      scene("pen") +
      "</div>" +
      '<div class="inner"><h2>' +
      esc(S.pasted.title || tx("pasted.defaultTitle")) +
      '</h2><p class="cn">' +
      esc(tx(from ? "pasted.forItem" : "pasted.plain")) +
      "</p></div>";
    host.appendChild(head);
    var paras = S.pasted.text
      .split(/\r?\n\s*\r?\n/)
      .map(function (t) {
        return { en: t.replace(/\s+/g, " ").trim(), cn: "" };
      })
      .filter(function (p) {
        return p.en;
      });
    var passage = el("section", "card passage");
    renderPassage(passage, paras, { vocab: from ? from.vocab : [], showCN: false });
    passage.addEventListener("click", function (e) {
      var w = e.target.closest(".w");
      if (w) {
        showWordPop(w, e);
        return;
      }
      var s = e.target.closest(".sent");
      if (s) speakContainer(s);
    });
    var legend = readTip();

    var right = [];
    var tips = el("section", "card");
    tips.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("pasted.howTitle")) +
      '</h3><span class="faint">' +
      esc(tx("pasted.howSub")) +
      "</span></div>" +
      '<p class="sub" style="line-height:1.85">' +
      esc(tx("pasted.howBody")) +
      "</p>";
    if (from) {
      var back = el("a", "btn small primary", tx("pasted.back"));
      back.href = "#/news/" + from.id;
      back.style.marginTop = "12px";
      back.style.marginRight = "8px";
      tips.appendChild(back);
    }
    var again = el("a", "btn small", tx("pasted.another"));
    again.href = "#/news";
    again.style.marginTop = "12px";
    tips.appendChild(again);
    right.push(tips);

    renderSpread(host, [legend, passage], right);
  };

  var mediaFilter = "all";
  /** The card's cover: the page's own illustration. The zip hot-linked each video's thumbnail
   * from the video site's image CDN; nothing is loaded from there any more. */
  function coverNode(m) {
    var cover = el("span", "cover");
    var kind = m.type === "ted" ? "talk" : m.type === "podcast" ? "wave" : "city";
    var f = el("span", "art-fallback");
    f.innerHTML = scene(kind);
    cover.appendChild(f);
    cover.appendChild(el("span", "dur", mediaLength(m)));
    return cover;
  }
  /** A video's length ("18:38"), or a series' total hours. */
  function mediaLength(m) {
    return m.dur ? String(m.dur) : typeof m.hours === "number" ? tx("media.series", m.hours) : "";
  }
  /** A view count, short, in the interface language's own way ("675K" in English). */
  function compactNumber(n) {
    try {
      return new Intl.NumberFormat(locale(), {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
    } catch (e) {
      return String(n);
    }
  }
  VIEWS.media = function (host) {
    var p = el("p", "sub");
    p.textContent = tx("media.intro");
    host.appendChild(p);

    var tabs = el("div", "chips");
    tabs.style.margin = "12px 0 18px";
    [
      ["all", tx("common.all")],
      ["vlog", tx("media.type.vlog")],
      ["podcast", tx("media.type.podcast")],
      ["ted", tx("media.type.ted")],
    ].forEach(function (k) {
      var b = el("button", "chip", k[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", mediaFilter === k[0] ? "true" : "false");
      b.addEventListener("click", function () {
        mediaFilter = k[0];
        render();
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    var items = C.media.filter(function (m) {
      return mediaFilter === "all" || m.type === mediaFilter;
    });
    var grid = el("div", "grid2");
    items.forEach(function (m) {
      var c = el("a", "media-card");
      c.href = safeUrl(m.url);
      c.target = "_blank";
      c.rel = REL;
      var body = el("span", "body");
      body.innerHTML =
        '<span class="row" style="justify-content:space-between"><span class="pill accent">' +
        esc(tag("media.type", m.type)) +
        '</span><span class="faint">' +
        esc(tx("media.views", compactNumber(m.views || 0))) +
        "</span></span>" +
        '<span class="name">' +
        esc(m.name) +
        "</span>" +
        '<span class="meta">' +
        esc(tx("media.by", m.author, mediaLength(m))) +
        "</span>" +
        '<span class="use">' +
        esc(m.use) +
        "</span>" +
        '<span class="meta">' +
        esc(tx("media.meta", m.sub, m.levels, tag("scene", m.scene))) +
        "</span>";
      c.appendChild(coverNode(m));
      c.appendChild(body);
      grid.appendChild(c);
    });
    host.appendChild(grid);

    var note = el("p", "faint");
    note.style.marginTop = "18px";
    note.textContent = tx("media.note");
    host.appendChild(note);
  };

  VIEWS.exams = function (host) {
    var p = el("p", "sub", tx("exams.intro"));
    host.appendChild(p);
    var tabs = el("div", "chips");
    tabs.style.margin = "12px 0";
    EXAMS.filter(function (k) {
      return k !== "NONE";
    }).forEach(function (k) {
      var b = el("button", "chip", examName(k));
      b.type = "button";
      b.setAttribute("aria-pressed", S.settings.exam === k ? "true" : "false");
      b.addEventListener("click", function () {
        S.settings.exam = k;
        save();
        render();
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);
    var list = C.exams.filter(function (x) {
      return x.exam === S.settings.exam;
    });
    if (!list.length) list = C.exams;
    list.forEach(function (x) {
      var card = el("section", "card");
      card.style.marginTop = "14px";
      card.innerHTML =
        '<div class="row" style="justify-content:space-between"><span class="pill accent">' +
        esc(loc(x, "type")) +
        '</span><span class="faint">' +
        esc(tx("ted.aboutMin", x.minutes)) +
        "</span></div>" +
        '<p style="font-size:14px;line-height:1.8;margin:10px 0 4px">' +
        esc(x.q) +
        "</p>" +
        '<p class="faint">' +
        esc(x.cn) +
        "</p>";
      var b = el("button", "btn small", tx("exams.show"));
      b.type = "button";
      b.style.marginTop = "10px";
      var ansBox = el("div");
      b.addEventListener("click", function () {
        if (ansBox.firstChild) {
          ansBox.innerHTML = "";
          b.textContent = tx("exams.show");
          return;
        }
        var s = el("div", "answer");
        s.style.marginTop = "10px";
        s.textContent = x.sample;
        ansBox.appendChild(s);
        var up = el("div", "chips");
        up.style.marginTop = "10px";
        x.upgrades.forEach(function (u) {
          var pill = el("span", "pill ok", u);
          up.appendChild(pill);
        });
        ansBox.appendChild(up);
        b.textContent = tx("exams.hide");
      });
      card.appendChild(b);
      card.appendChild(ansBox);
      host.appendChild(card);
    });
  };

  VIEWS.words = function (host, sub) {
    var mode = sub === "review" ? "review" : sub === "sentences" ? "sentences" : "all";
    if (mode === "review") return renderReview(host);
    if (mode === "sentences") return renderSentences(host);

    var tabs = el("div", "tabs");
    [
      ["all", tx("words.tab.all")],
      ["review", tx("words.tab.review")],
      ["sentences", tx("words.tab.sentences")],
    ].forEach(function (t) {
      var b = el("button", mode === t[0] ? "on" : "", t[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        location.hash =
          t[0] === "all" ? "#/words" : "#/words/" + (t[0] === "review" ? "review" : "sentences");
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);
    host.appendChild(el("p", "sub", tx("words.intro")));

    var bar = el("div", "row");
    bar.style.margin = "12px 0";
    var stat = el("span", "pill", tx("words.stat", S.saved.words.length, dueWords().length));
    bar.appendChild(stat);
    var bRev = el("button", "btn small primary", tx("words.startReview"));
    bRev.type = "button";
    bRev.addEventListener("click", function () {
      location.hash = "#/words/review";
    });
    bar.appendChild(bRev);
    var bExp = el("button", "btn small ghost", tx("words.exportJson"));
    bExp.type = "button";
    bExp.addEventListener("click", function () {
      download("my-words.json", JSON.stringify(S.saved, null, 2), "application/json");
    });
    bar.appendChild(bExp);
    host.appendChild(bar);

    if (!S.saved.words.length) {
      host.appendChild(el("div", "empty", tx("words.empty")));
      return;
    }
    var list = el("div", "vocab-list");
    S.saved.words.forEach(function (w) {
      var it = el("div", "vocab-item");
      it.innerHTML =
        '<div class="w-line"><span class="w-en">' +
        esc(w.en) +
        '</span><span class="ipa">' +
        esc(w.ipa || "") +
        '</span><span class="cn">' +
        esc(w.cn) +
        "</span></div>" +
        (w.coll ? '<div class="meta">' + esc(w.coll) + "</div>" : "") +
        (w.ex ? '<div class="ex">' + esc(w.ex) + "</div>" : "") +
        '<div class="meta">' +
        esc(tx("words.meta", w.src || "—", w.box || 0)) +
        "</div>";
      var t = el("div", "tools");
      var b1 = el("button", "btn small ghost", tx("common.read"));
      b1.type = "button";
      b1.addEventListener("click", function () {
        TTS.words = [];
        TTS.speak(w.en, {});
      });
      var b2 = el("button", "btn small ghost", tx("common.delete"));
      b2.type = "button";
      b2.addEventListener("click", function () {
        S.saved.words = S.saved.words.filter(function (x) {
          return x.id !== w.id;
        });
        save();
        render();
      });
      t.appendChild(b1);
      t.appendChild(b2);
      it.appendChild(t);
      list.appendChild(it);
    });
    host.appendChild(list);
  };

  function renderSentences(host) {
    var tabs = el("div", "tabs");
    [
      ["all", tx("words.tab.all")],
      ["review", tx("words.tab.review")],
      ["sentences", tx("words.tab.sentences")],
    ].forEach(function (t) {
      var b = el("button", t[0] === "sentences" ? "on" : "", t[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        location.hash =
          t[0] === "review" ? "#/words/review" : t[0] === "all" ? "#/words" : "#/words/sentences";
        render();
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);
    if (!S.saved.sentences.length) {
      host.appendChild(el("div", "empty", tx("sentences.empty")));
      return;
    }
    S.saved.sentences.forEach(function (s) {
      var it = el("div", "vocab-item");
      it.style.marginTop = "10px";
      it.innerHTML =
        '<div class="ex" style="font-size:14.5px;color:var(--ink)">' +
        esc(s.text) +
        '</div><div class="meta">' +
        esc(tx("sentences.from", s.src)) +
        "</div>";
      var t = el("div", "tools");
      var b1 = el("button", "btn small ghost", tx("common.read"));
      b1.type = "button";
      b1.addEventListener("click", function () {
        TTS.words = [];
        TTS.speak(s.text, {});
      });
      var b2 = el("button", "btn small ghost", tx("common.delete"));
      b2.type = "button";
      b2.addEventListener("click", function () {
        S.saved.sentences = S.saved.sentences.filter(function (x) {
          return x.id !== s.id;
        });
        save();
        render();
      });
      t.appendChild(b1);
      t.appendChild(b2);
      it.appendChild(t);
      host.appendChild(it);
    });
  }

  function renderReview(host) {
    var tabs = el("div", "tabs");
    [
      ["all", tx("words.tab.all")],
      ["review", tx("words.tab.review")],
      ["sentences", tx("words.tab.sentences")],
    ].forEach(function (t) {
      var b = el("button", t[0] === "review" ? "on" : "", t[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        location.hash =
          t[0] === "review" ? "#/words/review" : t[0] === "all" ? "#/words" : "#/words/sentences";
        render();
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    var due = dueWords();
    if (!due.length) {
      host.appendChild(el("div", "empty", tx("review.none")));
      return;
    }
    var cur = due[0];
    var pool = S.saved.words.concat([]);
    if (pool.length < 4) {
      C.news.forEach(function (a) {
        a.vocab.forEach(function (v) {
          pool.push({ en: v.w, cn: v.cn });
        });
      });
    }
    var others = pool.filter(function (w) {
      return w.en !== cur.en;
    });
    var opts = [cur].concat(shuffle(others).slice(0, 3));
    opts = shuffle(opts);

    var card = el("section", "card");
    card.innerHTML =
      "<h3>" +
      esc(tx("review.title", due.length)) +
      "</h3>" +
      '<p class="faint" style="margin:6px 0 14px">' +
      esc(tx("review.sub")) +
      "</p>" +
      '<div style="font-family:var(--serif);font-size:26px;margin:10px 0">' +
      esc(cur.en) +
      "</div>" +
      '<div class="faint">' +
      esc(cur.ipa || "") +
      "</div>";
    var bSay = el("button", "btn small ghost", tx("review.listen"));
    bSay.type = "button";
    bSay.addEventListener("click", function () {
      TTS.words = [];
      TTS.speak(cur.en, {});
    });
    card.appendChild(bSay);
    var list = el("div", "stack");
    list.style.marginTop = "14px";
    opts.forEach(function (o) {
      var b = el("button", "btn", o.cn);
      b.type = "button";
      b.style.justifyContent = "flex-start";
      b.addEventListener("click", function () {
        if (o.en === cur.en) {
          cur.box = (cur.box || 0) + 1;
          var days = [1, 2, 4, 7, 15][Math.min(cur.box, 4)];
          cur.next = Date.now() + days * 86400000;
          cur.hits = (cur.hits || 0) + 1;
          save();
          toast(tx("review.right", days));
          setTimeout(render, 450);
        } else {
          cur.box = 0;
          cur.next = Date.now() + 86400000;
          save();
          b.style.borderColor = "var(--bad)";
          b.style.color = "var(--bad)";
          toast(tx("review.wrong", cur.cn));
          setTimeout(render, 1200);
        }
      });
      list.appendChild(b);
    });
    card.appendChild(list);
    host.appendChild(card);
  }

  VIEWS.resources = function (host) {
    host.appendChild(el("p", "sub", tx("res.intro")));
    C.resources.forEach(function (g) {
      var head = el("div", "group-head");
      head.innerHTML = "<h3>" + esc(loc(g, "group")) + "</h3>";
      host.appendChild(head);
      var card = el("section", "card");
      g.items.forEach(function (it) {
        var row = el("div", "res-item");
        var title = safeUrl(it.url)
          ? '<a href="' +
            esc(safeUrl(it.url)) +
            '" target="_blank" rel="' +
            REL +
            '">' +
            esc(it.name) +
            "</a>"
          : "<b>" + esc(it.name) + "</b>";
        row.innerHTML =
          '<div class="top">' +
          title +
          '<span class="pill">' +
          esc(tag("paid", it.paid)) +
          '</span><span class="pill">' +
          esc(tag("accentTag", it.accent)) +
          '</span><span class="pill">' +
          esc(it.levels) +
          "</span></div>" +
          '<div class="faint">' +
          esc(it.sub) +
          " · " +
          esc(tag("scene", it.scene)) +
          "</div>" +
          '<div style="color:var(--muted)">' +
          esc(it.use) +
          "</div>" +
          (it.search
            ? '<div class="faint">' + esc(tx("res.search")) + esc(it.search) + "</div>"
            : "");
        card.appendChild(row);
      });
      host.appendChild(card);
    });
    var aux = el("section", "card");
    aux.innerHTML =
      "<h3>" +
      esc(tx("res.auxTitle")) +
      '</h3><p class="sub" style="margin-top:8px;line-height:1.8">' +
      tx("res.auxBodyHtml") +
      "</p>";
    host.appendChild(aux);
  };

  VIEWS.settings = function (host) {
    var card = el("section", "card");
    card.innerHTML =
      "<h3>" +
      esc(tx("set.levelTitle")) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(tx("set.levelSub")) +
      "</p>";
    var lv = el("div", "chips");
    [1, 2, 3, 4].forEach(function (n) {
      var b = el("button", "chip", "L" + n + " " + levelName(n));
      b.type = "button";
      b.setAttribute("aria-pressed", S.settings.level === n ? "true" : "false");
      b.addEventListener("click", function () {
        S.settings.level = n;
        save();
        render();
      });
      lv.appendChild(b);
    });
    card.appendChild(lv);
    card.appendChild(
      el("p", "faint", tx("set.levelTip", S.settings.level, levelTip(S.settings.level))),
    );
    if (S.settings.level === 1 || S.settings.level === 2)
      card.appendChild(el("p", "faint", tx("set.levelCnHint")));
    host.appendChild(card);

    var cLang = el("section", "card");
    cLang.innerHTML =
      "<h3>" +
      esc(tx("set.langTitle")) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(tx("set.langSub")) +
      "</p>";
    var langs = el("div", "chips");
    langs.setAttribute("role", "group");
    langs.setAttribute("aria-label", tx("set.langTitle"));
    ["zh", "en"].forEach(function (code) {
      var b = el("button", "chip", tx("lang." + code));
      b.type = "button";
      b.lang = code === "zh" ? "zh-CN" : "en";
      b.setAttribute("aria-pressed", I18N.lang() === code ? "true" : "false");
      b.addEventListener("click", function () {
        switchLang(code);
      });
      langs.appendChild(b);
    });
    cLang.appendChild(langs);
    host.appendChild(cLang);

    var c2 = el("section", "card");
    c2.innerHTML =
      "<h3>" +
      esc(tx("set.examTitle")) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(tx("set.examSub")) +
      "</p>";
    var ex = el("div", "chips");
    EXAMS.forEach(function (k) {
      var b = el("button", "chip", examName(k));
      b.type = "button";
      b.setAttribute("aria-pressed", k === S.settings.exam ? "true" : "false");
      b.addEventListener("click", function () {
        S.settings.exam = k;
        save();
        render();
      });
      ex.appendChild(b);
    });
    c2.appendChild(ex);
    host.appendChild(c2);

    var c3 = el("section", "card");
    c3.innerHTML = "<h3>" + esc(tx("set.readTitle")) + "</h3>";
    var r = el("div", "row");
    r.style.marginTop = "10px";
    r.innerHTML = '<span class="faint">' + esc(tx("set.accent")) + "</span>";
    var bA = el("button", "chip", tx("set.accentUS"));
    bA.type = "button";
    bA.setAttribute("aria-pressed", S.settings.accent === "en-US" ? "true" : "false");
    bA.addEventListener("click", function () {
      S.settings.accent = "en-US";
      save();
      render();
    });
    var bB = el("button", "chip", tx("set.accentUK"));
    bB.type = "button";
    bB.setAttribute("aria-pressed", S.settings.accent === "en-GB" ? "true" : "false");
    bB.addEventListener("click", function () {
      S.settings.accent = "en-GB";
      save();
      render();
    });
    r.appendChild(bA);
    r.appendChild(bB);
    c3.appendChild(r);
    var r2 = el("div", "row");
    r2.style.margin = "12px 0 0";
    r2.innerHTML = '<span class="faint">' + esc(tx("set.rate")) + "</span>";
    var rr = el("input");
    rr.type = "range";
    rr.min = "0.7";
    rr.max = "1.2";
    rr.step = "0.05";
    rr.value = S.settings.rate;
    rr.style.width = "160px";
    var val = el("span", "faint", S.settings.rate + "x");
    rr.addEventListener("input", function () {
      S.settings.rate = parseFloat(rr.value);
      val.textContent = S.settings.rate + "x";
      save();
    });
    r2.appendChild(rr);
    r2.appendChild(val);
    c3.appendChild(r2);
    var bTest = el("button", "btn small ghost", tx("set.test"));
    bTest.type = "button";
    bTest.style.marginTop = "10px";
    bTest.addEventListener("click", function () {
      TTS.words = [];
      TTS.speak("Reading a little every day beats reading a lot once.", {});
    });
    c3.appendChild(bTest);
    c3.appendChild(el("p", "faint", tx("set.noSound")));
    host.appendChild(c3);

    var c4 = el("section", "card");
    c4.innerHTML = "<h3>" + esc(tx("set.displayTitle")) + "</h3>";
    var bCN = el("button", "chip", S.settings.showCN ? tx("set.cnOn") : tx("set.cnOff"));
    bCN.type = "button";
    bCN.setAttribute("aria-pressed", S.settings.showCN ? "true" : "false");
    bCN.style.marginTop = "10px";
    bCN.addEventListener("click", function () {
      S.settings.showCN = !S.settings.showCN;
      save();
      render();
    });
    c4.appendChild(bCN);
    var bTheme = el(
      "button",
      "chip",
      tx(
        "set.theme",
        tx(
          S.settings.theme === "auto"
            ? "theme.auto"
            : S.settings.theme === "dark"
              ? "theme.dark"
              : "theme.light",
        ),
      ),
    );
    bTheme.type = "button";
    bTheme.style.marginTop = "10px";
    bTheme.style.marginLeft = "8px";
    bTheme.addEventListener("click", function () {
      S.settings.theme =
        S.settings.theme === "auto" ? "light" : S.settings.theme === "light" ? "dark" : "auto";
      save();
      applyTheme();
      render();
    });
    c4.appendChild(bTheme);
    var bSpread = el(
      "button",
      "chip",
      S.settings.spread === false ? tx("set.spreadOff") : tx("set.spreadOn"),
    );
    bSpread.type = "button";
    bSpread.style.marginTop = "10px";
    bSpread.style.marginLeft = "8px";
    bSpread.setAttribute("aria-pressed", S.settings.spread === false ? "false" : "true");
    bSpread.addEventListener("click", function () {
      S.settings.spread = S.settings.spread === false;
      save();
      render();
    });
    c4.appendChild(bSpread);
    c4.appendChild(el("p", "faint", tx("set.spreadHint")));
    host.appendChild(c4);

    var cNet = el("section", "card");
    cNet.innerHTML = "<h3>" + esc(tx("set.pressTitle")) + "</h3>";
    cNet.appendChild(pressGate(render));
    host.appendChild(cNet);

    var c6 = el("section", "card");
    c6.innerHTML =
      "<h3>" +
      esc(tx("set.dataTitle")) +
      '</h3><p class="sub" style="margin:6px 0 10px">' +
      esc(tx("set.dataSub")) +
      "</p>";
    var b1 = el("button", "btn small ghost", tx("set.export"));
    b1.type = "button";
    b1.addEventListener("click", function () {
      download("english-workbench-backup.json", JSON.stringify(S, null, 2), "application/json");
    });
    var b2 = el("button", "btn small ghost", tx("set.clear"));
    b2.type = "button";
    b2.style.marginLeft = "8px";
    // The app frames the page in a sandbox without allow-modals, where confirm() returns false
    // without asking; a second click within a few seconds confirms instead.
    var armed = null;
    b2.addEventListener("click", function () {
      if (!armed) {
        b2.textContent = tx("set.clearConfirm");
        armed = setTimeout(function () {
          armed = null;
          b2.textContent = tx("set.clear");
        }, 5000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      S.saved = { words: [], sentences: [] };
      S.progress = {};
      S.notes = {};
      S.answers = {};
      save();
      render();
      toast(tx("toast.cleared"));
    });
    c6.appendChild(b1);
    c6.appendChild(b2);
    host.appendChild(c6);
  };

  VIEWS.more = function (host) {
    ["press", "wechat", "media", "exams", "words", "resources", "settings"].forEach(
      function (route) {
        var a = el("a", "pick more-row");
        a.href = "#/" + route;
        a.style.marginTop = "10px";
        a.innerHTML =
          '<span class="title">' +
          esc(tx("nav." + route)) +
          '</span><span class="meta">' +
          esc(tx("more." + route)) +
          "</span>";
        host.appendChild(a);
      },
    );
  };

  /* ================================================================ daily press
   * The list comes from the handler, which reads a fixed set of RSS feeds only while the
   * learner has the daily-press switch on (off by default; see pressGate). Reading an article
   * means pasting its text: the handler splits it (POST ../api/press/import-text, no network)
   * and the page keeps the result in the record (S.pressRead, the newest 24). A cover loads in
   * the browser, straight from the address the feed gave, and only while the switch is on. */
  var PRESS = { items: [], loadedAt: 0, fetchedAt: 0, online: null, cat: "all", state: "idle" };
  // Topic keys the handler gives each feed item; "all" shows every topic.
  var PRESS_CATS = ["all", "world", "business", "culture", "tech", "science"];

  function pressReadList() {
    return S.pressRead;
  }
  function pressKeep(item) {
    var list = S.pressRead.filter(function (x) {
      return x.id !== item.id;
    });
    list.unshift(item);
    S.pressRead = list.slice(0, 24);
    save();
  }
  function agoOf(ts) {
    if (!ts) return "";
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return tx("ago.now");
    if (m < 60) return tx("ago.min", m);
    if (m < 1440) return tx("ago.hour", Math.floor(m / 60));
    if (m < 4320) return tx("ago.day", Math.floor(m / 1440));
    var d = new Date(ts);
    return d.getMonth() + 1 + "/" + d.getDate();
  }
  function isTodayTs(ts) {
    if (!ts) return false;
    var a = new Date(ts),
      b = new Date();
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /** The daily-press switch, naming the hosts the server would contact. */
  function pressGate(onChange) {
    var box = el("div", "press-gate");
    var hosts = NET.hosts.length ? joinList(NET.hosts) : tx("press.someFeeds");
    box.appendChild(
      el("p", "sub", NET.online ? tx("press.gateOn", hosts) : tx("press.gateOff", hosts)),
    );
    var b = el(
      "button",
      NET.online ? "btn small ghost" : "btn small primary",
      NET.online ? tx("press.turnOff") : tx("press.turnOn"),
    );
    b.type = "button";
    b.setAttribute("aria-pressed", NET.online ? "true" : "false");
    b.addEventListener("click", function () {
      b.disabled = true;
      api("/settings", { method: "PUT", body: { online: !NET.online } }).then(
        function (r) {
          NET.online = r.online === true;
          if (Array.isArray(r.hosts)) NET.hosts = r.hosts;
          if (onChange) onChange();
        },
        function (e) {
          b.disabled = false;
          toast(
            tx("press.saveFailed") +
              (e && e.status && e.message ? tx("map.colon") + e.message : ""),
          );
        },
      );
    });
    box.appendChild(b);
    return box;
  }

  /** The import card: paste an article's text; title, source and link are optional. The
   * workbench never fetches the page for you. `card._fill(item)` prefills it from a feed item. */
  function importCard() {
    var card = el("section", "card");
    card.id = "importCard";
    card.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("import.title")) +
      '</h3><span class="faint">' +
      esc(tx("import.kinds")) +
      "</span></div>" +
      '<p class="sub" style="margin-bottom:8px">' +
      esc(tx("import.sub")) +
      "</p>";
    var tIn = el("input");
    tIn.type = "text";
    tIn.placeholder = tx("import.titlePh");
    var srcIn = el("input");
    srcIn.type = "text";
    srcIn.placeholder = tx("import.sourcePh");
    srcIn.style.marginTop = "8px";
    var urlIn = el("input");
    urlIn.type = "url";
    urlIn.placeholder = tx("import.urlPh");
    urlIn.style.marginTop = "8px";
    var ta = el("textarea");
    ta.rows = 5;
    ta.placeholder = tx("import.textPh");
    ta.style.marginTop = "8px";
    var go2 = el("button", "btn small primary", tx("import.go"));
    go2.type = "button";
    go2.style.marginTop = "10px";
    var tip = el("p", "faint");
    tip.style.marginTop = "8px";
    card.appendChild(tIn);
    card.appendChild(srcIn);
    card.appendChild(urlIn);
    card.appendChild(ta);
    card.appendChild(go2);
    card.appendChild(tip);

    function busy(b) {
      go2.disabled = b;
      tip.textContent = b ? tx("import.busy") : "";
    }
    go2.addEventListener("click", function () {
      var text = ta.value;
      if (wordCount(text) < 40) {
        toast(tx("err.text-too-short"));
        return;
      }
      var url = urlIn.value.trim();
      if (url && !safeUrl(url)) {
        toast(tx("err.url-invalid"));
        return;
      }
      busy(true);
      api("/press/import-text", {
        method: "POST",
        body: {
          title: tIn.value.trim() || tx("import.defaultTitle"),
          text: text,
          url: url,
          source: srcIn.value.trim() || tx("import.defaultSource"),
        },
      }).then(
        function (r) {
          pressKeep(r.item);
          go("#/press/" + r.item.id);
        },
        function (e) {
          busy(false);
          tip.textContent = (e && e.status && e.message) || tx("import.failed");
          toast(tip.textContent);
        },
      );
    });
    card._fill = function (it) {
      tIn.value = it.title || "";
      srcIn.value = it.source || "";
      urlIn.value = safeUrl(it.url);
      tip.textContent = tx("import.filled");
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      ta.focus({ preventScroll: true });
    };
    return card;
  }

  /** An imported article, by id (they live in the learning record). */
  function pressFind(id) {
    var local = pressReadList().filter(function (x) {
      return x.id === id;
    })[0];
    return local ? { item: local } : null;
  }
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }
  /** A cover box: the illustration, with the feed's cover on top while online and while it loads. */
  function coverBox(url, art, cls) {
    var box = el("div", cls || "pc-cover");
    box.innerHTML = scene(art || "pen");
    var src = coverSrc(url);
    if (!src) return box;
    var img = el("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = src;
    img.addEventListener("error", function () {
      img.remove();
    });
    img.addEventListener("load", function () {
      if (img.naturalWidth < 40 || img.naturalHeight < 40) img.remove();
    });
    box.appendChild(img);
    return box;
  }
  function pressHasCN(it) {
    return (it.paragraphs || []).some(function (p) {
      return p && typeof p !== "string" && p.cn;
    });
  }
  /** A card for a feed item ("rss") or an imported article ("saved"). */
  function pressCard(it, kind) {
    var card = el("article", "press-card");
    card.appendChild(coverBox(it.image, itemArt(it)));
    var body = el("div", "pc-body");
    var top = el("div", "pc-top");
    var url = safeUrl(it.url);
    var src = it.source || hostOf(url) || tx("press.fallbackSource");
    top.innerHTML =
      '<span class="pill accent">' +
      esc(pressTopic(it)) +
      "</span>" +
      (pressHasCN(it)
        ? '<span class="pill cn-badge" title="' +
          esc(tx("press.cnBadgeTitle")) +
          '">' +
          esc(tx("press.cnBadge")) +
          "</span>"
        : "") +
      (url
        ? '<a class="pc-src" href="' +
          esc(url) +
          '" target="_blank" rel="' +
          REL +
          '" title="' +
          esc(tx("press.openSite")) +
          '">' +
          esc(src) +
          " ↗</a>"
        : '<span class="pc-src">' + esc(src) + "</span>") +
      '<span class="faint">' +
      esc(agoOf(it.ts)) +
      "</span>";
    body.appendChild(top);
    var h = el("h3", "pc-title");
    h.textContent = it.title;
    body.appendChild(h);
    if (it.summary) body.appendChild(el("p", "pc-sum", it.summary));
    var tools = el("div", "pc-tools");
    if (kind === "saved") {
      var open = el("a", "btn small primary", tx("press.continue"));
      open.href = "#/press/" + it.id;
      tools.appendChild(open);
    } else {
      var bRead = el("button", "btn small primary", tx("press.pasteRead"));
      bRead.type = "button";
      bRead.addEventListener("click", function () {
        var imp = $("#importCard");
        if (imp && imp._fill) imp._fill(it);
      });
      tools.appendChild(bRead);
    }
    if (url) {
      var ext = el("a", "btn small ghost", tx("article.link"));
      ext.href = url;
      ext.target = "_blank";
      ext.rel = REL;
      tools.appendChild(ext);
    }
    body.appendChild(tools);
    card.appendChild(body);
    return card;
  }

  VIEWS.press = function (host) {
    var p = el("p", "sub");
    p.textContent = tx("press.intro");
    host.appendChild(p);

    var gate = el("section", "card");
    gate.style.marginTop = "14px";
    gate.appendChild(pressGate(render));
    host.appendChild(gate);

    /* ---- imported: what you pasted ---- */
    var saved = pressReadList();
    if (saved.length) {
      var head1 = el("div", "group-head");
      head1.innerHTML =
        "<h3>" +
        esc(tx("press.importedTitle", saved.length)) +
        '</h3><span class="faint">' +
        esc(tx("press.importedSub")) +
        "</span>";
      host.appendChild(head1);
      var grid = el("div", "press-grid");
      saved.forEach(function (it) {
        grid.appendChild(pressCard(it, "saved"));
      });
      host.appendChild(grid);
    }

    /* ---- the feed list ---- */
    var head2 = el("div", "group-head");
    head2.innerHTML =
      "<h3>" +
      esc(tx("press.todayTitle")) +
      '</h3><span class="faint" data-status>' +
      esc(tx("press.loading")) +
      "</span>";
    host.appendChild(head2);

    var chips = el("div", "chips");
    chips.style.margin = "0 0 6px";
    var refresh = el("button", "btn small", tx("press.refresh"));
    refresh.type = "button";
    refresh.style.marginLeft = "8px";
    refresh.disabled = !NET.online;
    if (!NET.online) refresh.title = tx("press.refreshOff");
    var bar = el("div", "row");
    bar.appendChild(chips);
    bar.appendChild(refresh);
    host.appendChild(bar);

    var listBox = el("div");
    listBox.style.marginTop = "10px";
    host.appendChild(listBox);

    var imp = importCard();
    imp.style.marginTop = "22px";
    host.appendChild(imp);

    var status = head2.querySelector("[data-status]");

    PRESS_CATS.forEach(function (c) {
      var b = el("button", "chip", tx("press.cat." + c));
      b.type = "button";
      b.setAttribute("aria-pressed", PRESS.cat === c ? "true" : "false");
      b.addEventListener("click", function () {
        PRESS.cat = c;
        $$(".chip", chips).forEach(function (n, i) {
          n.setAttribute("aria-pressed", PRESS_CATS[i] === c ? "true" : "false");
        });
        paint();
      });
      chips.appendChild(b);
    });

    function paint() {
      listBox.innerHTML = "";
      var items = PRESS.items.filter(function (it) {
        return PRESS.cat === "all" || it.topic === PRESS.cat;
      });
      if (!items.length) {
        if (PRESS.state === "loading") return;
        listBox.appendChild(
          el(
            "p",
            "sub",
            !NET.online && !PRESS.items.length
              ? tx("press.emptyOff")
              : PRESS.state === "error"
                ? tx("press.emptyError")
                : tx("press.emptyCat"),
          ),
        );
        return;
      }
      var today = items.filter(function (it) {
        return isTodayTs(it.ts);
      });
      var older = items.filter(function (it) {
        return !isTodayTs(it.ts);
      });
      function section(title, arr, cap) {
        var g = el("div", "group-head");
        g.innerHTML = "<h3>" + esc(title) + " · " + arr.length + "</h3>";
        listBox.appendChild(g);
        var grid2 = el("div", "press-grid");
        arr.slice(0, cap).forEach(function (it) {
          grid2.appendChild(pressCard(it, "rss"));
        });
        listBox.appendChild(grid2);
      }
      if (today.length) section(tx("press.sectionToday"), today, 40);
      if (older.length) section(tx("press.sectionOlder"), older, 60);
    }
    function describe(err) {
      var when = PRESS.fetchedAt ? new Date(PRESS.fetchedAt).toLocaleTimeString(locale()) : "";
      if (!NET.online) {
        status.textContent = PRESS.items.length
          ? tx("press.offCached", PRESS.items.length, when)
          : tx("press.offEmpty");
        return;
      }
      status.textContent = PRESS.items.length
        ? tx("press.status", PRESS.items.length, when, err)
        : err || tx("press.noneYet");
    }

    function load(force) {
      PRESS.state = "loading";
      status.textContent = NET.online ? tx("press.fetching") : tx("press.loading");
      fetch(API.base + "/press" + (force ? "?refresh=1" : ""), { cache: "no-store" })
        .then(function (r) {
          return r
            .json()
            .catch(function () {
              return {};
            })
            .then(function (d) {
              return { ok: r.ok, status: r.status, d: d || {} };
            });
        })
        .then(function (res) {
          if (!res.ok && !(res.d.items && res.d.items.length))
            throw new Error(errorText(res.d, res.status));
          if (typeof res.d.online === "boolean") NET.online = res.d.online;
          PRESS.items = (res.d.items || []).slice(0, 120);
          PRESS.fetchedAt = res.d.fetchedAt || 0;
          PRESS.loadedAt = Date.now();
          PRESS.online = NET.online;
          PRESS.state = "ok";
          describe(res.ok ? "" : errorText(res.d, res.status));
          paint();
        })
        .catch(function (e) {
          PRESS.state = "error";
          status.textContent = (e && e.message) || tx("err.press-failed");
          paint();
        });
    }

    refresh.addEventListener("click", function () {
      load(true);
    });
    if (
      PRESS.items.length &&
      PRESS.online === NET.online &&
      Date.now() - PRESS.loadedAt < 1000 * 60 * 20
    ) {
      describe("");
      paint();
    } else {
      load(false);
    }
  };

  VIEWS.pressitem = function (host, id) {
    var hit = pressFind(id);
    if (!hit) {
      var miss = el("section", "card");
      miss.innerHTML =
        "<h3>" +
        esc(tx("pressitem.missingTitle")) +
        '</h3><p class="sub" style="margin:8px 0 12px">' +
        esc(tx("pressitem.missingSub")) +
        "</p>";
      var back = el("a", "btn small primary", tx("pressitem.back"));
      back.href = "#/press";
      miss.appendChild(back);
      host.appendChild(miss);
      return;
    }
    var it = hit.item;
    var url = safeUrl(it.url);
    var paras = (it.paragraphs || [])
      .map(function (p) {
        return typeof p === "string"
          ? { en: p, cn: "" }
          : { en: String(p.en || ""), cn: String(p.cn || ""), h: !!p.h };
      })
      .filter(function (p) {
        return p.en;
      });
    var hasCN = paras.some(function (p) {
      return !!p.cn;
    });
    var lim = L().words;
    var cut = cutParagraphs(paras, lim);
    var expanded = false;
    var words = wordCount(
      paras
        .map(function (p) {
          return p.en;
        })
        .join(" "),
    );
    var srcName = it.source || hostOf(url) || tx("press.fallbackSource");

    host.appendChild(
      readerHero({
        art: itemArt(it),
        image: it.image,
        pill: srcName,
        meta: agoOf(it.ts),
        title: it.title,
        note: esc(tx("pressitem.note", S.settings.level, cut.shown, paras.length, words)),
        source: url
          ? esc(tx("pressitem.sourceLabel")) +
            '<a href="' +
            esc(url) +
            '" target="_blank" rel="' +
            REL +
            '">' +
            esc(srcName) +
            " · " +
            esc(hostOf(url)) +
            " " +
            esc(tx("pressitem.original")) +
            "</a>"
          : esc(tx("pressitem.sourceLabel")) + esc(srcName),
      }),
    );

    var tools = el("div", "card");
    var row = el("div", "row");
    var needsCut = cut.shown < paras.length;
    var bAll = el("button", "btn small", tx("article.showAll"));
    bAll.type = "button";
    bAll.disabled = !needsCut;
    bAll.addEventListener("click", function () {
      expanded = !expanded;
      paint();
    });
    var bRead = el("button", "btn small primary", tx("article.readAll"));
    bRead.type = "button";
    bRead.addEventListener("click", function () {
      speakContainer(passage);
    });
    var bOne = el("button", "btn small ghost", tx("pressitem.readFirst"));
    bOne.type = "button";
    bOne.addEventListener("click", function () {
      var p0 = passage.querySelector(".sent");
      if (p0) speakContainer(p0);
    });
    var bCN = el("button", "chip", hasCN && S.settings.showCN ? tx("cn.on") : tx("cn.off"));
    bCN.type = "button";
    if (!hasCN) {
      bCN.disabled = true;
      bCN.title = tx("pressitem.noCnTitle");
      bCN.textContent = tx("cn.none");
    }
    bCN.addEventListener("click", function () {
      if (!hasCN) return;
      S.settings.showCN = !S.settings.showCN;
      save();
      paint();
    });
    var bDone = el(
      "button",
      "btn small",
      todayProgress().press ? tx("pressitem.readCheck") : tx("pressitem.markRead"),
    );
    bDone.type = "button";
    bDone.addEventListener("click", function () {
      toggleTask("press");
      if (todayProgress().press) markRead("press", it.id);
    });
    row.appendChild(bAll);
    row.appendChild(bRead);
    row.appendChild(bOne);
    row.appendChild(bCN);
    row.appendChild(bDone);
    if (url) {
      var bSrc = el("a", "btn small ghost", tx("article.link"));
      bSrc.href = url;
      bSrc.target = "_blank";
      bSrc.rel = REL;
      row.appendChild(bSrc);
    }
    tools.appendChild(row);
    var cnHint = el("p", "faint");
    cnHint.style.margin = "10px 0 0";
    tools.appendChild(cnHint);

    var passage = el("section", "card passage");
    function paint() {
      passage.innerHTML = "";
      renderPassage(passage, paras, {
        vocab: [],
        showCN: hasCN && S.settings.showCN,
        limit: expanded ? 0 : lim,
      });
      bAll.textContent = !needsCut
        ? tx("article.coveredAll")
        : expanded
          ? tx("article.onlyLevel")
          : tx("article.showAll");
      bCN.textContent = hasCN ? (S.settings.showCN ? tx("cn.on") : tx("cn.off")) : tx("cn.none");
      bCN.setAttribute("aria-pressed", hasCN && S.settings.showCN ? "true" : "false");
      cnHint.textContent = hasCN
        ? tx(
            "pressitem.cnHint",
            expanded ? paras.length : cut.shown,
            paras.length,
            !!S.settings.showCN,
          )
        : tx("pressitem.noCnHint");
    }
    paint();
    passage.addEventListener("click", function (e) {
      var w = e.target.closest(".w");
      if (w) {
        showWordPop(w, e);
        return;
      }
      var s = e.target.closest(".sent");
      if (s) speakContainer(s);
    });
    var legend = readTip();

    /* ---- right page ---- */
    var right = [];
    var noteCard = el("section", "card");
    noteCard.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("notes.title")) +
      '</h3><span class="faint">' +
      esc(tx("pressitem.notesSub")) +
      "</span></div>";
    var ta = el("textarea");
    ta.rows = 6;
    ta.placeholder = tx("pressitem.notesPh");
    ta.value = S.notes["press:" + it.id] || "";
    ta.addEventListener("input", function () {
      S.notes["press:" + it.id] = ta.value;
      save();
    });
    noteCard.appendChild(ta);
    right.push(noteCard);

    var srcCard = el("section", "card");
    srcCard.innerHTML =
      "<h3>" +
      esc(tx("pressitem.originTitle")) +
      "</h3>" +
      '<p class="sub" style="margin:8px 0 10px">' +
      esc(srcName) +
      " · " +
      esc(it.date ? String(it.date).slice(0, 10) : "") +
      "</p>";
    if (url) {
      var open = el("a", "btn small", tx("article.openSource"));
      open.href = url;
      open.target = "_blank";
      open.rel = REL;
      srcCard.appendChild(open);
      var hostLine = el("p", "faint");
      hostLine.style.marginTop = "8px";
      hostLine.textContent = hostOf(url);
      srcCard.appendChild(hostLine);
    } else {
      srcCard.appendChild(el("p", "faint", tx("pressitem.noLink")));
    }
    var del = el("button", "btn small ghost", tx("pressitem.delete"));
    del.type = "button";
    del.style.marginLeft = "8px";
    del.addEventListener("click", function () {
      S.pressRead = S.pressRead.filter(function (x) {
        return x.id !== it.id;
      });
      save();
      toast(tx("toast.removed"));
      go("#/press");
    });
    srcCard.appendChild(del);
    right.push(srcCard);

    renderSpread(host, [tools, legend, passage], right);
  };

  /* ================================================================ WeChat accounts */
  // The type filter: an account's `type` key, "" for all of them.
  var wechatType = "";
  VIEWS.wechat = function (host) {
    var list = C.wechat || [];
    var p = el("p", "sub");
    p.textContent = tx("wechat.intro");
    host.appendChild(p);

    var how = el("section", "card");
    how.style.marginTop = "14px";
    how.innerHTML =
      '<div class="card-head"><h3>' +
      esc(tx("wechat.howTitle")) +
      '</h3><span class="faint">' +
      esc(tx("wechat.howSteps")) +
      "</span></div>" +
      '<ol class="steps">' +
      "<li>" +
      esc(tx("wechat.step1")) +
      "</li>" +
      "<li>" +
      esc(tx("wechat.step2")) +
      "</li>" +
      "<li>" +
      esc(tx("wechat.step3")) +
      "</li>" +
      "</ol>";
    host.appendChild(how);

    var types = [""];
    list.forEach(function (w) {
      if (types.indexOf(w.type) < 0) types.push(w.type);
    });
    var chips = el("div", "chips");
    chips.style.margin = "16px 0 6px";
    types.forEach(function (t) {
      var b = el("button", "chip", t ? tag("wechat.type", t) : tx("common.all"));
      b.type = "button";
      b.setAttribute("aria-pressed", wechatType === t ? "true" : "false");
      b.addEventListener("click", function () {
        wechatType = t;
        render();
      });
      chips.appendChild(b);
    });
    host.appendChild(chips);

    var grid = el("div", "grid2");
    grid.style.marginTop = "12px";
    list
      .filter(function (w) {
        return !wechatType || w.type === wechatType;
      })
      .forEach(function (w) {
        var card = el("article", "wx-card");
        card.innerHTML =
          '<div class="row" style="justify-content:space-between"><span class="pill accent">' +
          esc(tag("wechat.type", w.type)) +
          "</span>" +
          '<span class="faint">' +
          esc(w.cadence) +
          "</span></div>" +
          '<h3 class="wx-name">' +
          esc(w.name) +
          "</h3>" +
          '<p class="wx-meta">' +
          esc(w.level) +
          " · " +
          esc(w.owner) +
          "</p>" +
          '<p class="wx-use">' +
          esc(w.howto) +
          "</p>" +
          (w.note ? '<p class="faint" style="margin-top:6px">' + esc(w.note) + "</p>" : "");
        var row = el("div", "row");
        row.style.marginTop = "12px";
        var bCopy = el("button", "btn small ghost", tx("wechat.copyName"));
        bCopy.type = "button";
        bCopy.addEventListener("click", function () {
          copy(w.name);
        });
        var bSearch = el("a", "btn small", tx("wechat.search"));
        bSearch.href =
          "https://weixin.sogou.com/weixin?type=1&query=" + encodeURIComponent(w.search || w.name);
        bSearch.target = "_blank";
        bSearch.rel = REL;
        row.appendChild(bCopy);
        row.appendChild(bSearch);
        card.appendChild(row);
        grid.appendChild(card);
      });
    host.appendChild(grid);

    var imp = importCard();
    imp.style.marginTop = "20px";
    host.appendChild(imp);

    var foot = el("p", "faint");
    foot.style.marginTop = "16px";
    foot.textContent = tx("wechat.foot");
    host.appendChild(foot);
  };

  /* ---------------------------------------------------------------- utils */
  function shuffle(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i];
      r[i] = r[j];
      r[j] = t;
    }
    return r;
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain" });
    var a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  /* ---------------------------------------------------------------- boot
   * Read the record and the press switch from the handler, then draw. When the record cannot
   * be read, the page still works but sends nothing (see "sync"), and says so once. */
  function boot() {
    // The chrome in the interface language while the record loads; the save line keeps saying
    // that it is being read until the first render.
    applyStatic();
    renderNavMeta();
    $("#sideSync").textContent = tx("side.loading");
    $("#pageTitle").textContent = tx(TITLES[parseHash().name] || "app.name");
    var gotData = api("/data").then(
      function (r) {
        S = adopt(r.data);
        SYNC.savedAt = r.savedAt || 0;
        SYNC.ready = true;
      },
      function () {
        SYNC.ready = false;
      },
    );
    var gotSettings = api("/settings").then(
      function (r) {
        NET.online = r.online === true;
        NET.hosts = Array.isArray(r.hosts) ? r.hosts : [];
      },
      function () {},
    );
    Promise.all([gotData, gotSettings]).then(function () {
      applyTheme();
      render();
      if (!SYNC.ready) toast(tx("sync.loadFailed"));
    });
  }
  boot();
})();
