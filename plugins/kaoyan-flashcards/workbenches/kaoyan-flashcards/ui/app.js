/* Kaoyan Flashcards: question bank, quiz with spaced review, and recitation documents.
 *
 * - Content: the built-in question bank is data/decks.json and the preset recitation documents
 *   are data/docs.json, both fetched at start (boot, at the end). A file that fails to load
 *   leaves its part empty and #loadNote says which one.
 * - Progress: three localStorage keys, kmc:state, kmc:docs and kmc:imported. storage-bridge.js,
 *   loaded first in <head>, namespaces them per Agent and keeps them in the workbench's own
 *   state on the server (../api/saves).
 * - There are no accounts: the app's sign-in is the account, so the page opens straight in.
 * - Everything runs in the page: no remote script, style or font; file import (docx, pdf, text)
 *   is parsed here without a library.
 * - Language: every text the page shows comes from i18n.js (loaded before this script) through
 *   T(key, …). The nav bar's switch changes the language and applyLang (near the end) draws the
 *   page again in place. Content data (the bank, the documents, the import sample) and the
 *   patterns that read Chinese input stay as written.
 */
(function () {
  "use strict";

  var I18N = window.KaoyanI18n;
  var T = I18N.t;

  /* ══════════════ Lightweight LaTeX rendering (no dependencies) ══════════════ */
  var GREEK = {
    alpha: "α",
    beta: "β",
    gamma: "γ",
    delta: "δ",
    epsilon: "ε",
    varepsilon: "ε",
    zeta: "ζ",
    eta: "η",
    theta: "θ",
    vartheta: "ϑ",
    iota: "ι",
    kappa: "κ",
    lambda: "λ",
    mu: "μ",
    nu: "ν",
    xi: "ξ",
    pi: "π",
    varpi: "ϖ",
    rho: "ρ",
    varrho: "ϱ",
    sigma: "σ",
    varsigma: "ς",
    tau: "τ",
    upsilon: "υ",
    phi: "φ",
    varphi: "φ",
    chi: "χ",
    psi: "ψ",
    omega: "ω",
    Gamma: "Γ",
    Delta: "Δ",
    Theta: "Θ",
    Lambda: "Λ",
    Xi: "Ξ",
    Pi: "Π",
    Sigma: "Σ",
    Upsilon: "Υ",
    Phi: "Φ",
    Psi: "Ψ",
    Omega: "Ω",
  };
  var SYM = {
    times: "×",
    cdot: "·",
    div: "÷",
    pm: "±",
    mp: "∓",
    leq: "≤",
    le: "≤",
    geq: "≥",
    ge: "≥",
    neq: "≠",
    ne: "≠",
    approx: "≈",
    equiv: "≡",
    sim: "∼",
    simeq: "≃",
    cong: "≅",
    propto: "∝",
    infty: "∞",
    partial: "∂",
    nabla: "∇",
    circ: "°",
    degree: "°",
    prime: "′",
    ldots: "…",
    cdots: "⋯",
    dots: "…",
    to: "→",
    rightarrow: "→",
    leftarrow: "←",
    Rightarrow: "⇒",
    Leftarrow: "⇐",
    leftrightarrow: "↔",
    sum: "∑",
    int: "∫",
    prod: "∏",
    angle: "∠",
    perp: "⊥",
    parallel: "∥",
    mid: "|",
    vert: "|",
    lbrace: "{",
    rbrace: "}",
    langle: "⟨",
    rangle: "⟩",
    lfloor: "⌊",
    rfloor: "⌋",
    lceil: "⌈",
    rceil: "⌉",
    floor: "⌊",
    ceil: "⌈",
    cup: "∪",
    cap: "∩",
    subset: "⊂",
    subseteq: "⊆",
    in: "∈",
    notin: "∉",
    emptyset: "∅",
    forall: "∀",
    exists: "∃",
    iint: "∬",
    iiint: "∭",
    oint: "∮",
    therefore: "∴",
    because: "∵",
    "%": "%",
    $: "$",
    "&": "&",
    _: "_",
    "#": "#",
    "{": "{",
    "}": "}",
    ",": "\u2009",
    ";": "\u2005",
    ":": "\u2005",
    "!": "",
    " ": "\u00a0",
    quad: "\u2003",
    qquad: "\u2003\u2003",
  };
  var FUNCS = {
    sin: 1,
    cos: 1,
    tan: 1,
    cot: 1,
    sec: 1,
    csc: 1,
    arcsin: 1,
    arccos: 1,
    arctan: 1,
    sinh: 1,
    cosh: 1,
    tanh: 1,
    log: 1,
    ln: 1,
    lg: 1,
    exp: 1,
    lim: 1,
    max: 1,
    min: 1,
    det: 1,
    arg: 1,
    deg: 1,
  };
  var ACCENT = {
    hat: "\u0302",
    bar: "\u0304",
    vec: "\u20d7",
    dot: "\u0307",
    ddot: "\u0308",
    tilde: "\u0303",
    widehat: "\u0302",
    overline: "\u0305",
    underline: "\u0332",
  };
  var UPRIGHT = {
    mathrm: 1,
    text: 1,
    operatorname: 1,
    mathbf: 1,
    mathit: 1,
    mathsf: 1,
    textrm: 1,
    mbox: 1,
  };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function tokenize(src) {
    var out = [],
      i = 0,
      c;
    while (i < src.length) {
      c = src[i];
      if (c === "\\") {
        i++;
        if (i >= src.length) break;
        if (/[a-zA-Z]/.test(src[i])) {
          var name = "";
          while (i < src.length && /[a-zA-Z]/.test(src[i])) {
            name += src[i];
            i++;
          }
          out.push({ t: "cmd", v: name });
        } else {
          out.push({ t: "cmd", v: src[i] });
          i++;
        }
      } else if (c === "{" || c === "}" || c === "^" || c === "_") {
        out.push({ t: c });
        i++;
      } else if (/\s/.test(c)) {
        i++;
      } else if (/[0-9]/.test(c)) {
        var num = "";
        while (i < src.length && /[0-9.]/.test(src[i])) {
          num += src[i];
          i++;
        }
        out.push({ t: "ch", v: num });
      } else {
        out.push({ t: "ch", v: c });
        i++;
      }
    }
    return out;
  }

  function texToHtml(src) {
    var tk = tokenize(src.replace(/\u00a7/g, "\\")),
      i = 0;

    function wrapChar(v) {
      if (/^[a-zA-Z]$/.test(v)) return '<i class="m-var">' + v + "</i>";
      return escHtml(v);
    }
    function parseArg() {
      var t = tk[i];
      if (!t) return "";
      if (t.t === "{") {
        i++;
        var h = parseSeq();
        if (tk[i] && tk[i].t === "}") i++;
        return h;
      }
      return atom();
    }
    function command(name) {
      if (GREEK[name]) return '<i class="m-var">' + GREEK[name] + "</i>";
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        var a = parseArg(),
          b = parseArg();
        return (
          '<span class="m-frac"><span class="m-num">' +
          a +
          "</span>" +
          '<span class="m-den">' +
          b +
          "</span></span>"
        );
      }
      if (name === "sqrt")
        return '<span class="m-sqrt">√<span class="m-rad">' + parseArg() + "</span></span>";
      if (UPRIGHT[name]) return '<span class="m-up">' + parseArg() + "</span>";
      if (ACCENT[name])
        return (
          '<span class="m-up">' + parseArg() + '</span><i class="m-mark">' + ACCENT[name] + "</i>"
        );
      if (FUNCS[name]) return '<span class="m-up">' + name + "</span>";
      if (name === "left" || name === "right") {
        if (tk[i] && tk[i].t === "ch") i++;
        else if (tk[i] && tk[i].t === "{") parseArg();
        return "";
      }
      if (name === "\\") return "<br>";
      if (SYM[name] !== undefined) return SYM[name];
      return '<span class="m-up">' + escHtml(name) + "</span>";
    }
    function atom() {
      var t = tk[i];
      if (!t) return "";
      if (t.t === "ch") {
        i++;
        return wrapChar(t.v);
      }
      if (t.t === "cmd") {
        i++;
        return command(t.v);
      }
      if (t.t === "{") {
        i++;
        var h = parseSeq();
        if (tk[i] && tk[i].t === "}") i++;
        return h;
      }
      i++;
      return "";
    }
    function withScripts(base) {
      var sup = "",
        sub = "";
      while (tk[i] && (tk[i].t === "^" || tk[i].t === "_")) {
        var k = tk[i].t;
        i++;
        var h = parseArg();
        if (k === "^") sup += h;
        else sub += h;
      }
      if (!sup && !sub) return base;
      return (
        '<span class="m-sc">' +
        base +
        (sup ? "<sup>" + sup + "</sup>" : "") +
        (sub ? "<sub>" + sub + "</sub>" : "") +
        "</span>"
      );
    }
    function parseSeq() {
      var html = "";
      while (tk[i] && tk[i].t !== "}") html += withScripts(atom());
      return html;
    }
    return parseSeq();
  }

  function fmt(text) {
    if (text == null) return "";
    var s = String(text),
      out = [],
      last = 0,
      m;
    var re = /\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$/g;
    while ((m = re.exec(s))) {
      out.push(escHtml(s.slice(last, m.index)));
      if (m[1] !== undefined) out.push('<span class="m-block">' + texToHtml(m[1]) + "</span>");
      else out.push('<span class="m-inline">' + texToHtml(m[2]) + "</span>");
      last = m.index + m[0].length;
    }
    out.push(escHtml(s.slice(last)));
    return out.join("");
  }

  /* ══════════════ File parsing: docx / pdf / text ══════════════ */
  /* An error that carries its dictionary key, so it reads in the language shown when it is
     displayed (errorText), not the one it was raised in. */
  function fail(key) {
    var err = new Error(T(key));
    err.i18nKey = key;
    return err;
  }
  function errorText(err) {
    if (err && err.i18nKey) return T(err.i18nKey);
    return err && err.message ? err.message : "";
  }
  function needInflate() {
    if (typeof DecompressionStream === "undefined") {
      throw fail("err.noInflate");
    }
  }
  async function inflateData(bytes, mode) {
    needInflate();
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(mode));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function decodeXml(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }
  function latin1(bytes) {
    var s = "",
      CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return s;
  }

  /* ---- ZIP (for docx) ---- */
  function zipEntries(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength),
      eocd = -1,
      i;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw fail("err.zip");
    var count = dv.getUint16(eocd + 10, true),
      off = dv.getUint32(eocd + 16, true),
      out = {};
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true),
        csize = dv.getUint32(off + 20, true);
      var nameLen = dv.getUint16(off + 28, true),
        extraLen = dv.getUint16(off + 30, true);
      var commentLen = dv.getUint16(off + 32, true),
        lho = dv.getUint32(off + 42, true);
      var name = new TextDecoder("utf-8").decode(u8.subarray(off + 46, off + 46 + nameLen));
      var lNameLen = dv.getUint16(lho + 26, true),
        lExtraLen = dv.getUint16(lho + 28, true);
      var dataStart = lho + 30 + lNameLen + lExtraLen;
      out[name] = { method: method, data: u8.subarray(dataStart, dataStart + csize) };
      off += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }
  async function docxText(u8) {
    var entries = zipEntries(u8),
      target = entries["word/document.xml"],
      k;
    if (!target) {
      for (k in entries) {
        if (/^word\/document\d*\.xml$/.test(k)) {
          target = entries[k];
          break;
        }
      }
    }
    if (!target) throw fail("err.notDocx");
    var bytes = target.data;
    if (target.method === 8) bytes = await inflateData(bytes, "deflate-raw");
    else if (target.method !== 0) throw fail("err.compression");
    var xml = new TextDecoder("utf-8").decode(bytes);
    var paras = xml.split(/<\/w:p>/),
      lines = [];
    for (var p = 0; p < paras.length; p++) {
      var txt = "",
        re = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g,
        m;
      while ((m = re.exec(paras[p]))) {
        if (m[1] !== undefined) txt += decodeXml(m[1]);
        else txt += m[0].indexOf("tab") >= 0 ? " " : "\n";
      }
      if (txt.trim()) lines.push(txt.trim());
    }
    return lines.join("\n");
  }

  /* ---- PDF ---- */
  function balanced(s, start) {
    var depth = 0,
      i = start;
    while (i < s.length - 1) {
      if (s[i] === "<" && s[i + 1] === "<") {
        depth++;
        i += 2;
        continue;
      }
      if (s[i] === ">" && s[i + 1] === ">") {
        depth--;
        i += 2;
        if (depth === 0) return s.slice(start, i);
        continue;
      }
      if (s[i] === "(") {
        var d = 1;
        i++;
        while (i < s.length && d > 0) {
          if (s[i] === "\\") i += 2;
          else {
            if (s[i] === "(") d++;
            else if (s[i] === ")") d--;
            i++;
          }
        }
        continue;
      }
      i++;
    }
    return s.slice(start);
  }
  function findDict(str, key) {
    var i = str.indexOf("/" + key);
    while (i >= 0) {
      var j = str.indexOf("<<", i);
      if (j < 0) return null;
      var between = str.slice(i + key.length + 1, j);
      if (/^\s*$/.test(between)) return balanced(str, j);
      i = str.indexOf("/" + key, i + 1);
    }
    return null;
  }
  function intOf(dict, key) {
    var m = new RegExp("/" + key + "\\s+(\\d+)").exec(dict || "");
    return m ? +m[1] : null;
  }
  function refOf(dict, key) {
    var m = new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(dict || "");
    return m ? +m[1] : null;
  }
  function dictOf(body) {
    var i = body.indexOf("stream");
    return i < 0 ? body : body.slice(0, i);
  }
  async function streamData(u8, o) {
    if (!o || o.bodyStart < 0) return null;
    var s = o.body,
      i = s.indexOf("stream");
    if (i < 0) return null;
    var p = i + 6;
    if (s[p] === "\r") p++;
    if (s[p] === "\n") p++;
    var e = s.lastIndexOf("endstream");
    if (e < 0) return null;
    var q = e;
    while (q > p && (s[q - 1] === "\n" || s[q - 1] === "\r")) q--;
    var raw = u8.subarray(o.bodyStart + p, o.bodyStart + q);
    var d = dictOf(s);
    var filt = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(d);
    var f = filt ? filt[1] : "";
    if (/FlateDecode/.test(f)) {
      try {
        return await inflateData(raw, "deflate");
      } catch (err) {
        try {
          return await inflateData(raw, "deflate-raw");
        } catch (err2) {
          return null;
        }
      }
    }
    return raw;
  }
  function hexToStr(h) {
    h = h.replace(/[^0-9A-Fa-f]/g, "");
    var s = "";
    for (var i = 0; i < h.length; i += 4) {
      var v = parseInt((h.substr(i, 4) + "0000").slice(0, 4), 16);
      if (!isNaN(v)) s += String.fromCharCode(v);
    }
    return s;
  }
  function codesFromBinary(bin, twoByte) {
    var codes = [],
      i;
    if (twoByte) {
      for (i = 0; i + 1 < bin.length; i += 2)
        codes.push((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    } else {
      for (i = 0; i < bin.length; i++) codes.push(bin.charCodeAt(i));
    }
    return codes;
  }
  function codesFromHex(hex, twoByte) {
    var h = hex.replace(/[^0-9A-Fa-f]/g, ""),
      codes = [],
      i;
    if (twoByte) {
      for (i = 0; i + 4 <= h.length; i += 4) codes.push(parseInt(h.substr(i, 4), 16));
    } else {
      for (i = 0; i + 2 <= h.length; i += 2) codes.push(parseInt(h.substr(i, 2), 16));
    }
    return codes;
  }
  function parseCMap(text) {
    var map = {},
      m,
      re = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = re.exec(text))) {
      var pr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
        g;
      while ((g = pr.exec(m[1]))) map[parseInt(g[1], 16)] = hexToStr(g[2]);
    }
    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = re.exec(text))) {
      var rr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g,
        g2;
      while ((g2 = rr.exec(m[1]))) {
        var lo = parseInt(g2[1], 16),
          hi = parseInt(g2[2], 16),
          c;
        if (g2[3]) {
          var base = hexToStr(g2[3]);
          for (c = lo; c <= hi && c - lo < 4096; c++) {
            map[c] =
              base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo));
          }
        } else {
          var items = g2[4].match(/<([0-9A-Fa-f]+)>/g) || [];
          for (var k = 0; k < items.length; k++) {
            if (lo + k <= hi) map[lo + k] = hexToStr(items[k].replace(/[<>]/g, ""));
          }
        }
      }
    }
    return map;
  }
  function unescapePdfString(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c !== "\\") {
        out += c;
        continue;
      }
      var n = s[++i];
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else if (n === "b") out += "\b";
      else if (n === "f") out += "\f";
      else if (n === "(" || n === ")" || n === "\\") out += n;
      else if (n === "\n") {
        /* line continuation */
      } else if (n >= "0" && n <= "7") {
        var oct = n;
        for (var k = 0; k < 2 && s[i + 1] >= "0" && s[i + 1] <= "7"; k++) oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else if (n !== undefined) out += n;
    }
    return out;
  }
  function decodeCodes(codes, font) {
    var out = "",
      i,
      v;
    if (font && font.cmap) {
      for (i = 0; i < codes.length; i++) {
        v = font.cmap[codes[i]];
        if (v !== undefined) out += v;
      }
      return out;
    }
    if (font && font.twoByte) return "";
    for (i = 0; i < codes.length; i++) {
      v = codes[i];
      if (v >= 32 || v === 10 || v === 13 || v === 9) out += String.fromCharCode(v);
      else out += " ";
    }
    return out;
  }
  function contentToText(content, fonts) {
    var tokens = [],
      i = 0;
    while (i < content.length) {
      var ch = content[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === "(") {
        var d = 1,
          j = i + 1,
          s = "";
        while (j < content.length && d > 0) {
          var c = content[j];
          if (c === "\\") {
            s += c + (content[j + 1] || "");
            j += 2;
          } else if (c === "(") {
            d++;
            s += c;
            j++;
          } else if (c === ")") {
            d--;
            if (d > 0) s += c;
            j++;
          } else {
            s += c;
            j++;
          }
        }
        tokens.push({ t: "str", v: s });
        i = j;
        continue;
      }
      if (ch === "<" && content[i + 1] !== "<") {
        var e = content.indexOf(">", i);
        if (e < 0) break;
        tokens.push({ t: "hex", v: content.slice(i + 1, e) });
        i = e + 1;
        continue;
      }
      if (ch === "<" && content[i + 1] === "<") {
        var dd = balanced(content, i);
        i += dd.length;
        continue;
      }
      if (ch === "[" || ch === "]") {
        tokens.push({ t: ch });
        i++;
        continue;
      }
      if (ch === "/") {
        var nj = i + 1;
        while (nj < content.length && !/[\s\/\[\]<>()]/.test(content[nj])) nj++;
        tokens.push({ t: "name", v: content.slice(i + 1, nj) });
        i = nj;
        continue;
      }
      if (/[+\-0-9]/.test(ch)) {
        var numS = "",
          p2 = i;
        while (p2 < content.length && /[+\-0-9.]/.test(content[p2])) {
          numS += content[p2];
          p2++;
        }
        if (numS.length && !isNaN(parseFloat(numS))) {
          tokens.push({ t: "num", v: parseFloat(numS) });
          i = p2;
          continue;
        }
      }
      var oj = i;
      while (oj < content.length && !/[\s\/\[\]<>()]/.test(content[oj])) oj++;
      if (oj === i) {
        i++;
        continue;
      }
      tokens.push({ t: "op", v: content.slice(i, oj) });
      i = oj;
    }

    var out = "",
      stack = [],
      inArr = false,
      arr = [],
      cur = null;
    for (var k = 0; k < tokens.length; k++) {
      var tk = tokens[k];
      if (tk.t === "[") {
        inArr = true;
        arr = [];
        continue;
      }
      if (tk.t === "]") {
        inArr = false;
        stack.push({ t: "arr", items: arr });
        continue;
      }
      if (inArr) {
        arr.push(tk);
        continue;
      }
      if (tk.t !== "op") {
        stack.push(tk);
        continue;
      }
      var op = tk.v;
      if (op === "Tf") {
        var sizeTok = stack.pop(),
          nameTok = stack.pop();
        cur = (nameTok && nameTok.v && fonts[nameTok.v]) || null;
      } else if (op === "Tj" || op === "'" || op === '"') {
        var st = null;
        for (var q = stack.length - 1; q >= 0; q--) {
          if (stack[q].t === "str" || stack[q].t === "hex") {
            st = stack[q];
            break;
          }
        }
        if (st) {
          if (op !== "Tj") out += "\n";
          var two = !!(cur && cur.twoByte);
          var codes =
            st.t === "str"
              ? codesFromBinary(unescapePdfString(st.v), two)
              : codesFromHex(st.v, two);
          out += decodeCodes(codes, cur);
        }
      } else if (op === "TJ") {
        var arrTok = null;
        for (var q2 = stack.length - 1; q2 >= 0; q2--) {
          if (stack[q2].t === "arr") {
            arrTok = stack[q2];
            break;
          }
        }
        if (arrTok) {
          for (var z = 0; z < arrTok.items.length; z++) {
            var it = arrTok.items[z];
            var two2 = !!(cur && cur.twoByte);
            if (it.t === "str")
              out += decodeCodes(codesFromBinary(unescapePdfString(it.v), two2), cur);
            else if (it.t === "hex") out += decodeCodes(codesFromHex(it.v, two2), cur);
          }
        }
      } else if (op === "Td" || op === "TD") {
        var ty = stack[stack.length - 1];
        if (ty && ty.t === "num" && Math.abs(ty.v) > 0.5) out += "\n";
        else out += " ";
      } else if (op === "T*") {
        out += "\n";
      } else if (op === "BT" || op === "ET") {
        if (out && !/\n$/.test(out)) out += "\n";
      }
      stack = [];
    }
    return out;
  }
  async function pdfPageFonts(u8, objs, pageNum) {
    var fonts = {},
      dict = dictOf(objs[pageNum].body),
      resStr = null,
      guard = 0;
    while (dict && guard++ < 6) {
      var r = findDict(dict, "Resources");
      if (r) {
        resStr = r;
        break;
      }
      var parent = refOf(dict, "Parent");
      if (!parent || !objs[parent]) break;
      dict = dictOf(objs[parent].body);
    }
    if (!resStr) return fonts;
    var fontDict = findDict(resStr, "Font");
    if (!fontDict) return fonts;
    var re = /\/([^\s\/\[\]<>()]+)\s+(\d+)\s+\d+\s+R/g,
      m;
    while ((m = re.exec(fontDict))) {
      var name = m[1],
        num = +m[2],
        fo = objs[num];
      if (!fo) continue;
      var fd = dictOf(fo.body),
        cmap = null,
        tu = refOf(fd, "ToUnicode");
      if (tu && objs[tu]) {
        try {
          var data = await streamData(u8, objs[tu]);
          if (data) cmap = parseCMap(latin1(data));
        } catch (e) {}
      }
      fonts[name] = { cmap: cmap, twoByte: /\/Identity-[HV]/.test(fd) || /\/Type0/.test(fd) };
    }
    return fonts;
  }
  async function pdfText(u8) {
    var s = latin1(u8),
      objs = {},
      heads = [],
      m;
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    while ((m = re.exec(s))) heads.push({ num: +m[1], start: m.index, bodyStart: re.lastIndex });
    if (!heads.length) throw fail("err.pdf");
    for (var k = 0; k < heads.length; k++) {
      var h = heads[k],
        end = k + 1 < heads.length ? heads[k + 1].start : s.length;
      objs[h.num] = { body: s.slice(h.bodyStart, end), bodyStart: h.bodyStart };
    }
    // Unpack object streams (/Type /ObjStm, PDF 1.5 and later)
    var nums = Object.keys(objs);
    for (var i = 0; i < nums.length; i++) {
      var o = objs[nums[i]],
        d0 = dictOf(o.body);
      if (!/\/Type\s*\/ObjStm/.test(d0)) continue;
      var data0 = null;
      try {
        data0 = await streamData(u8, o);
      } catch (e) {
        continue;
      }
      if (!data0) continue;
      var text0 = latin1(data0),
        n0 = intOf(d0, "N") || 0,
        first0 = intOf(d0, "First") || 0;
      var header = text0.slice(0, first0).trim().split(/\s+/);
      for (var j = 0; j < n0; j++) {
        var onum = +header[j * 2],
          offs = +header[(j + 1) * 2];
        var nextOff = j + 1 < n0 ? +header[(j + 1) * 2 + 1] : text0.length - first0;
        if (isNaN(onum) || isNaN(offs)) continue;
        objs[onum] = { body: text0.slice(first0 + offs, first0 + nextOff), bodyStart: -1 };
      }
    }
    // Pages
    var pages = [],
      pnum;
    for (pnum in objs) {
      var dd = dictOf(objs[pnum].body);
      if (/\/Type\s*\/Page\b/.test(dd) && !/\/Type\s*\/Pages\b/.test(dd)) pages.push(+pnum);
    }
    pages.sort(function (a, b) {
      return a - b;
    });
    var out = [];
    for (var pi = 0; pi < pages.length; pi++) {
      var num = pages[pi],
        pd = dictOf(objs[num].body),
        refs = [];
      var cm = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pd);
      if (cm) {
        var rr = cm[1].match(/(\d+)\s+\d+\s+R/g) || [];
        rr.forEach(function (r) {
          refs.push(+r.match(/(\d+)/)[1]);
        });
      }
      if (!refs.length) continue;
      var content = "";
      for (var ri = 0; ri < refs.length; ri++) {
        var ro = objs[refs[ri]];
        if (!ro) continue;
        var cdata = null;
        try {
          cdata = await streamData(u8, ro);
        } catch (e) {}
        if (cdata) content += latin1(cdata) + "\n";
      }
      if (!content) continue;
      var fonts = await pdfPageFonts(u8, objs, num);
      out.push(contentToText(content, fonts));
    }
    return out
      .join("\n\n")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/[ ]*\n[ ]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function fileToText(file) {
    var name = (file.name || "").toLowerCase();
    var buf = new Uint8Array(await file.arrayBuffer());
    if (name.endsWith(".docx")) return await docxText(buf);
    if (name.endsWith(".pdf")) return await pdfText(buf);
    if (name.endsWith(".doc")) throw fail("err.doc");
    var txt = new TextDecoder("utf-8").decode(buf);
    if ((txt.match(/\uFFFD/g) || []).length > txt.length * 0.01) {
      try {
        txt = new TextDecoder("gbk").decode(buf);
      } catch (e) {}
    }
    return txt;
  }

  /* ══════════════ Data ══════════════ */
  /* Card types the app knows, by their data value; typeLabel shows an unknown one as `fallback`. */
  var TYPES = ["single_choice", "multiple_choice", "true_false", "basic", "cloze"];
  function typeLabel(type, fallback) {
    return TYPES.indexOf(type) >= 0 ? T("type." + type) : fallback;
  }
  /* Deck fields: the two data/decks.json uses (content values, matched as written) and the two
     the app gives the decks it makes itself. fieldLabel shows any other field as written. */
  var FIELD_PUBLIC = "公共课",
    FIELD_MAJOR = "专业课",
    FIELD_REAL = ":real",
    FIELD_BANK = ":bank";
  function fieldLabel(field) {
    if (field === FIELD_PUBLIC) return T("field.public");
    if (field === FIELD_MAJOR) return T("field.major");
    if (field === FIELD_REAL) return T("field.real");
    if (field === FIELD_BANK) return T("field.bank");
    return field || T("field.practice");
  }

  /* One local profile: kmc:state, kmc:docs, kmc:imported (storage-bridge.js scopes them). */
  function keyOf(kind) {
    return "kmc:" + kind;
  }
  function keyState() {
    return keyOf("state");
  }
  function keyDocs() {
    return keyOf("docs");
  }
  function keyImported() {
    return keyOf("imported");
  }

  /* Tags that name a card's origin or kind rather than its chapter: the importer's tag for a card
     outside any chapter heading (toCard; kept in saved imports and backups) and a kind tag. They
     are content values, written and matched as they are. */
  var IMPORT_TAG = "导入";
  var NOT_CHAPTER_TAGS = ["判断题", IMPORT_TAG];
  /* The chapter of a card without a chapter tag; chapterName shows it in the current language. */
  var NO_CHAPTER = ":imported";
  function chapterOf(c) {
    var tags = Array.isArray(c.tags) ? c.tags : [];
    for (var k = 0; k < tags.length; k++)
      if (NOT_CHAPTER_TAGS.indexOf(tags[k]) < 0) return String(tags[k]);
    return NO_CHAPTER;
  }
  function chapterName(chapter) {
    return chapter === NO_CHAPTER ? T("chapter.imported") : chapter;
  }
  function normalize(c, idx) {
    var type = c.type || "basic";
    var opts = Array.isArray(c.options)
      ? c.options.map(function (o) {
          return { id: String(o.id), text: String(o.text == null ? "" : o.text) };
        })
      : [];
    var answers = [];
    if (type === "single_choice") answers = c.answer == null ? [] : [String(c.answer)];
    else if (type === "multiple_choice")
      answers = Array.isArray(c.answers) ? c.answers.map(String) : [];
    else if (type === "true_false") answers = [c.answer === true ? "T" : "F"];
    return {
      id: String(c.id || "card-" + idx),
      type: type,
      opts: opts,
      answers: answers,
      prompt:
        type === "true_false"
          ? String(c.statement || "")
          : c.front != null
            ? String(c.front)
            : String(c.question != null ? c.question : c.template || ""),
      note: c.note ? String(c.note) : "",
      back: c.back != null ? String(c.back) : "",
      template: c.template ? String(c.template) : "",
      blanks: c.answers && !Array.isArray(c.answers) ? c.answers : null,
      chapter: chapterOf(c),
      school: c.school ? String(c.school) : "",
      year: c.year ? String(c.year) : "",
      tags: Array.isArray(c.tags) ? c.tags : [],
    };
  }
  /* data/decks.json and data/docs.json, fetched by boot(). */
  function fetchJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }
  /* decks.json is {"decks":[{id, name, field, icon, desc, cards:[…], chapters:[…]}]}; a bare
     array of cards is taken as one deck. Returns whether it held at least one deck. */
  function useBank(data) {
    if (Array.isArray(data)) {
      BUILTIN = [{ id: "builtin", gen: "builtin", field: FIELD_BANK, cards: data }];
      labelDeck(BUILTIN[0]);
    } else if (data && Array.isArray(data.decks)) {
      BUILTIN = data.decks.filter(function (d) {
        return d && Array.isArray(d.cards);
      });
    } else {
      BUILTIN = [];
    }
    DECKS = BUILTIN.slice();
    return BUILTIN.length > 0;
  }

  var store = {
    ratings: {},
    fav: {},
    theme: null,
    today: { d: "", n: 0 },
    filters: null,
    pos: 0,
    mode: "home",
    goal: 30,
    wrong: {},
    due: {},
    reps: {},
    quiz: { right: 0, wrong: 0 },
    streak: { d: "", n: 0 },
    lastDeck: null,
  };
  var importedCards = [],
    docs = [],
    ALL = [],
    seen = {},
    CHAPTERS = [];
  var BUILTIN = [],
    PRESETS = [],
    DECKS = [],
    docsFailed = false;

  var state = {
    f: {
      decks: [],
      chapters: [],
      types: [],
      schools: [],
      years: [],
      scope: "all",
      shuffle: false,
      q: "",
    },
    order: [],
    pos: 0,
    ui: { selected: [], judged: false, revealed: false },
    session: { again: 0, hard: 0, good: 0 },
    doc: { id: null, veil: false, peek: {} },
  };

  function syncImportedDeck() {
    DECKS = DECKS.filter(function (d) {
      return d.id.indexOf("imp_") !== 0;
    });
    if (!importedCards.length) return;
    var have = {};
    DECKS.forEach(function (d) {
      have[d.id] = 1;
    });
    var map = {},
      order = [];
    importedCards.forEach(function (c) {
      var id = c.deck || "imp_misc";
      if (!map[id]) {
        map[id] = { id: id, n: 0, school: c.school || "", year: c.year || "" };
        order.push(id);
      }
      map[id].n++;
    });
    order.forEach(function (id) {
      var m = map[id];
      if (have[id]) return; /* its cards went into an existing deck, which is listed already */
      var deck = {
        id: m.id,
        gen: "imported",
        field: FIELD_REAL,
        kind: "real",
        school: m.school,
        year: m.year,
        n: m.n,
        cards: [],
      };
      labelDeck(deck);
      DECKS.push(deck);
    });
  }
  /* Decks the app makes itself (a bare card list in decks.json, imported past papers) take their
     name, description and icon from the dictionary; labelDecks runs again on a language switch. */
  function labelDeck(d) {
    if (d.gen === "builtin") {
      d.name = T("deck.builtin.name");
      d.desc = T("deck.builtin.desc");
      d.icon = T("app.logo");
    } else if (d.gen === "imported") {
      d.name = T("deck.imported.name", d.school, d.year);
      d.desc = T("deck.imported.desc", d.school, d.year, d.n);
      d.icon = T("deck.imported.icon");
    }
  }
  function labelDecks() {
    DECKS.forEach(labelDeck);
  }
  function index(list, deckId) {
    list.forEach(function (c, i) {
      var n;
      try {
        n = normalize(c, i);
      } catch (e) {
        return;
      } /* a malformed card (from an import) is skipped */
      if (seen[n.id]) return;
      seen[n.id] = 1;
      n.deck = c.deck ? String(c.deck) : deckId || "builtin";
      ALL.push(n);
    });
  }
  function refreshChapters() {
    CHAPTERS = [];
    ALL.forEach(function (c) {
      if (CHAPTERS.indexOf(c.chapter) < 0) CHAPTERS.push(c.chapter);
    });
  }

  function readKey(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  /* Counters are written into innerHTML (home tiles, stats strip), and a restored backup file
     can carry anything: keep them non-negative integers. */
  function count(v) {
    v = Math.floor(+v);
    return isFinite(v) && v > 0 ? v : 0;
  }
  function dayCount(o) {
    return o && typeof o === "object" ? { d: String(o.d || ""), n: count(o.n) } : { d: "", n: 0 };
  }
  /* Documents come from storage, a restored backup or an import: keep what the reader can show. */
  function cleanDocs(list) {
    return list
      .filter(function (d) {
        return d && typeof d === "object" && Array.isArray(d.blocks);
      })
      .map(function (d) {
        d.blocks = d.blocks.filter(function (b) {
          return b && typeof b.text === "string";
        });
        return d;
      });
  }

  function initData() {
    store = {
      ratings: {},
      fav: {},
      theme: store.theme,
      today: { d: "", n: 0 },
      filters: null,
      pos: 0,
      mode: "home",
      goal: 30,
      wrong: {},
      due: {},
      reps: {},
      quiz: { right: 0, wrong: 0 },
      streak: { d: "", n: 0 },
      lastDeck: null,
    };
    try {
      var raw = readKey(keyState());
      if (raw) {
        var p = JSON.parse(raw) || {};
        store.ratings = p.ratings || {};
        store.fav = p.fav || {};
        if (p.theme) store.theme = p.theme;
        store.today = dayCount(p.today);
        store.filters = p.filters || null;
        store.pos = count(p.pos);
        store.mode = p.mode === "read" || p.mode === "quiz" || p.mode === "deck" ? p.mode : "home";
        store.wrong = p.wrong || {};
        store.due = p.due || {};
        store.reps = p.reps || {};
        store.quiz =
          p.quiz && typeof p.quiz === "object"
            ? { right: count(p.quiz.right), wrong: count(p.quiz.wrong) }
            : { right: 0, wrong: 0 };
        store.streak = dayCount(p.streak);
        store.lastDeck = p.lastDeck || null;
        store.goal = +p.goal > 0 ? +p.goal : 30;
        store.presetDocsDone = !!p.presetDocsDone;
      }
    } catch (e) {}

    importedCards = [];
    docs = [];
    try {
      var imp = JSON.parse(readKey(keyImported()) || "[]");
      if (Array.isArray(imp))
        importedCards = imp.filter(function (c) {
          return c && typeof c === "object";
        });
    } catch (e) {}
    try {
      var dc = JSON.parse(readKey(keyDocs()) || "[]");
      if (Array.isArray(dc)) docs = cleanDocs(dc);
    } catch (e) {}
    seedPresets();

    ALL = [];
    seen = {};
    DECKS = BUILTIN.slice();
    syncImportedDeck();
    DECKS.forEach(function (d) {
      index(d.cards, d.id);
    });
    index(importedCards, "imp_misc");
    refreshChapters();

    state.f = {
      decks: [],
      chapters: [],
      types: [],
      schools: [],
      years: [],
      scope: "all",
      shuffle: false,
      q: "",
    };
    if (store.filters && typeof store.filters === "object") {
      state.f.decks = Array.isArray(store.filters.decks) ? store.filters.decks : [];
      state.f.schools = Array.isArray(store.filters.schools) ? store.filters.schools : [];
      state.f.years = Array.isArray(store.filters.years) ? store.filters.years : [];
      state.f.chapters = Array.isArray(store.filters.chapters) ? store.filters.chapters : [];
      state.f.types = Array.isArray(store.filters.types) ? store.filters.types : [];
      state.f.scope = store.filters.scope || "all";
      state.f.shuffle = !!store.filters.shuffle;
      state.f.q = store.filters.q || "";
    }
  }

  /* Preset recitation documents go into Recite on the first visit; deleted ones do not come back. */
  function presetDocs() {
    return PRESETS; /* data/docs.json, fetched by boot() */
  }
  function seedPresets() {
    if (store.presetDocsDone || docs.length) return;
    var list = presetDocs();
    if (!list.length) return;
    docs = list.map(function (d) {
      var cp = JSON.parse(JSON.stringify(d));
      cp.id = "doc-" + Math.random().toString(36).slice(2, 8);
      return cp;
    });
    store.presetDocsDone = true;
    saveDocs();
  }
  function save() {
    try {
      localStorage.setItem(
        keyState(),
        JSON.stringify({
          ratings: store.ratings,
          fav: store.fav,
          theme: store.theme,
          today: store.today,
          filters: state.f,
          pos: state.pos,
          mode: store.mode,
          wrong: store.wrong,
          due: store.due,
          reps: store.reps,
          quiz: store.quiz,
          streak: store.streak,
          lastDeck: store.lastDeck,
          presetDocsDone: store.presetDocsDone,
          goal: store.goal,
        }),
      );
    } catch (e) {}
  }
  function saveDocs() {
    try {
      localStorage.setItem(keyDocs(), JSON.stringify(docs));
      return true;
    } catch (e) {
      toast(lazyT("toast.docsTooBig"));
      return false;
    }
  }
  function saveImported() {
    try {
      localStorage.setItem(keyImported(), JSON.stringify(importedCards));
    } catch (e) {
      toast(lazyT("toast.cardsTooMany"));
    }
  }

  /* ══════════════ DOM ══════════════ */
  var $ = function (id) {
    return document.getElementById(id);
  };
  var homeView = $("homeView"),
    quizView = $("quizView"),
    readView = $("readView"),
    deckView = $("deckView");
  var cardArea = $("cardArea"),
    chapterLabel = $("chapterLabel"),
    progCount = $("progCount");
  var barFill = $("barFill"),
    bar = $("bar"),
    todayStat = $("todayStat");
  var rateBar = $("rateBar"),
    btnAgain = $("rateAgain"),
    btnHard = $("rateHard"),
    btnGood = $("rateGood");
  var roundStat = $("roundStat"),
    btnPrevCard = $("btnPrev"),
    btnNextCard = $("btnNextCard");
  var drawer = $("drawer"),
    scrim = $("scrim"),
    toastEl = $("toast");
  var docSelect = $("docSelect"),
    docBody = $("docBody"),
    docMeta = $("docMeta"),
    docProgress = $("docProgress"),
    docBar = $("docBar"),
    btnVeil = $("btnVeil");

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function dayKey(off) {
    var d = new Date(Date.now() + (off || 0) * 864e5);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function bumpToday() {
    var t = todayStr();
    if (store.today.d !== t) store.today = { d: t, n: 0 };
    store.today.n++;
    if (!store.streak || !store.streak.d) store.streak = { d: t, n: 1 };
    else if (store.streak.d !== t) {
      store.streak = { d: t, n: (store.streak.d === dayKey(-1) ? store.streak.n || 0 : 0) + 1 };
    }
    renderToday();
  }
  /* The result of an answer: accuracy and the wrong-answer book */
  function recordAttempt(card, ok) {
    if (!card) return;
    var k = ok ? "right" : "wrong";
    store.quiz[k] = (store.quiz[k] || 0) + 1;
    if (ok) delete store.wrong[card.id];
    else store.wrong[card.id] = 1;
    save();
  }
  /* When a card is due again: Again in about 10 hours, Hard in a day, Good after 1, 2, 4, 7, 15, 30
     and then 60 days */
  function scheduleDue(card, kind) {
    var DAY = 864e5,
      now = Date.now(),
      reps = store.reps[card.id] || 0;
    if (kind === "again") {
      store.due[card.id] = now + Math.round(0.4 * DAY);
      store.reps[card.id] = 0;
    } else if (kind === "hard") {
      store.due[card.id] = now + DAY;
    } else {
      var seq = [1, 2, 4, 7, 15, 30, 60];
      store.due[card.id] = now + seq[Math.min(reps, seq.length - 1)] * DAY;
      store.reps[card.id] = reps + 1;
    }
  }
  function renderToday() {
    if (store.today.d !== todayStr()) store.today = { d: todayStr(), n: 0 };
    todayStat.textContent = T("quiz.today", store.today.n);
    if (document.body.getAttribute("data-mode") === "home") renderHome();
  }
  /* A text that is read when it is shown, so a toast still on screen when the language changes
     is redrawn in the new one (applyLang). */
  function lazyT() {
    var args = arguments;
    return function () {
      return T.apply(null, args);
    };
  }
  var toastTimer,
    toastText = null;
  function toast(msg) {
    toastText = typeof msg === "function" ? msg : null;
    toastEl.textContent = toastText ? toastText() : msg;
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("on");
    }, 2800);
  }

  /* ══════════════ Quiz ══════════════ */
  function deckOn(c) {
    return !state.f.decks.length || state.f.decks.indexOf(c.deck) >= 0;
  }
  function queryHit(c) {
    var q = (state.f.q || "").trim().toLowerCase();
    if (!q) return true;
    var hay = [
      c.prompt,
      c.back,
      c.note,
      chapterName(c.chapter) || "",
      c.school || "",
      c.year || "",
    ];
    c.opts.forEach(function (o) {
      hay.push(o.text);
    });
    return hay.join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function passFilter(c, now) {
    var f = state.f,
      r = store.ratings[c.id];
    if (!deckOn(c)) return false;
    if (!queryHit(c)) return false;
    if (f.schools.length && f.schools.indexOf(c.school) < 0) return false;
    if (f.years.length && f.years.indexOf(c.year) < 0) return false;
    if (f.chapters.length && f.chapters.indexOf(c.chapter) < 0) return false;
    if (f.types.length && f.types.indexOf(c.type) < 0) return false;
    if (f.scope === "todo" && r === "good") return false;
    if (f.scope === "hard" && r !== "again" && r !== "hard") return false;
    if (f.scope === "done" && r !== "good") return false;
    if (f.scope === "fav" && !store.fav[c.id]) return false;
    if (f.scope === "wrong" && !store.wrong[c.id]) return false;
    if (f.scope === "due" && !(store.due[c.id] && store.due[c.id] <= now)) return false;
    return true;
  }
  function matchedList() {
    var now = Date.now();
    return ALL.filter(function (c) {
      return passFilter(c, now);
    });
  }
  function hasFilter() {
    var f = state.f;
    return !!(
      f.decks.length ||
      f.chapters.length ||
      f.types.length ||
      f.schools.length ||
      f.years.length ||
      (f.q || "").trim() ||
      f.scope !== "all"
    );
  }
  function buildOrder(keepPos) {
    var list = matchedList(),
      i,
      j,
      t;
    if (state.f.shuffle) {
      for (i = list.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        t = list[i];
        list[i] = list[j];
        list[j] = t;
      }
    }
    state.order = list;
    if (!keepPos) state.pos = 0;
    if (state.pos >= list.length) state.pos = Math.max(0, list.length - 1);
    resetUI();
  }
  function resetUI() {
    state.ui = { selected: [], judged: false, revealed: false };
  }

  function setProgress() {
    var total = state.order.length,
      shown = Math.min(state.pos + 1, total);
    progCount.textContent = total ? shown + " / " + total : "– / –";
    var pct = total ? Math.round((shown / total) * 100) : 0;
    barFill.style.width = pct + "%";
    bar.setAttribute("aria-valuenow", String(pct));
    var card = state.order[state.pos];
    if (card) {
      var dn = "";
      DECKS.forEach(function (d) {
        if (d.id === card.deck) dn = d.name;
      });
      chapterLabel.textContent =
        dn && dn !== card.chapter
          ? dn + " · " + chapterName(card.chapter)
          : chapterName(card.chapter);
    } else chapterLabel.textContent = T("quiz.noCards");
    var done = state.session.good + state.session.hard + state.session.again;
    roundStat.innerHTML = done ? T("quiz.roundHtml", done) : "";
    btnPrevCard.disabled = state.pos <= 0;
    btnNextCard.disabled = !total || state.pos >= total;
  }
  function answerText(card) {
    if (card.type === "true_false") return card.answers[0] === "T" ? T("tf.true") : T("tf.false");
    if (card.type === "basic") return card.back;
    if (card.type === "cloze") {
      var b = card.blanks || {};
      return Object.keys(b)
        .map(function (k) {
          return (b[k] || []).join(" / ");
        })
        .join(T("list.sep"));
    }
    return card.answers
      .map(function (id) {
        for (var k = 0; k < card.opts.length; k++) {
          if (card.opts[k].id === id) return id.toUpperCase() + ". " + card.opts[k].text;
        }
        return id.toUpperCase();
      })
      .join(T("list.sep"));
  }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    return a.slice().sort().join("|") === b.slice().sort().join("|");
  }
  function optionClass(card, id) {
    var ui = state.ui;
    var isAns = card.answers.indexOf(id) >= 0,
      isSel = ui.selected.indexOf(id) >= 0;
    if (ui.judged) return isAns ? "correct" : isSel ? "wrong" : "";
    return isSel ? "sel" : "";
  }
  function renderCard(card) {
    var ui = state.ui,
      h = [];
    h.push(
      '<article class="card' + (stillCard ? " still" : "") + '" id="card" aria-live="polite">',
    );
    h.push('<div class="card-top">');
    h.push('<span class="pill">' + escHtml(typeLabel(card.type, T("type.card"))) + "</span>");
    h.push('<span class="pill">' + escHtml(chapterName(card.chapter)) + "</span>");
    if (card.year || card.school) {
      h.push(
        '<span class="pill src">' +
          escHtml((card.year || "") + (card.school ? (card.year ? " · " : "") + card.school : "")) +
          "</span>",
      );
    }
    h.push(
      '<button class="star' +
        (store.fav[card.id] ? " on" : "") +
        '" id="btnStar" aria-pressed="' +
        (store.fav[card.id] ? "true" : "false") +
        '" aria-label="' +
        escHtml(T("quiz.star")) +
        '">' +
        '<svg viewBox="0 0 24 24" fill="' +
        (store.fav[card.id] ? "currentColor" : "none") +
        '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8z"/></svg></button>',
    );
    h.push("</div>");
    h.push('<p class="q">' + fmt(card.prompt) + "</p>");
    if (card.type === "single_choice" || card.type === "multiple_choice") {
      h.push('<div class="options" role="group" aria-label="' + escHtml(T("quiz.options")) + '">');
      card.opts.forEach(function (o, idx) {
        h.push(
          '<button class="opt ' +
            optionClass(card, o.id) +
            '" data-opt="' +
            escHtml(o.id) +
            '">' +
            '<span class="key" aria-hidden="true">' +
            String.fromCharCode(65 + idx) +
            ".</span>" +
            '<span class="opt-t">' +
            fmt(o.text) +
            "</span></button>",
        );
      });
      h.push("</div>");
      if (card.type === "multiple_choice" && !ui.judged) {
        h.push(
          '<button class="confirm" id="btnConfirm"' +
            (ui.selected.length ? "" : " disabled") +
            ">" +
            escHtml(T("quiz.confirm", ui.selected.length)) +
            "</button>",
        );
      }
    }
    if (card.type === "true_false") {
      h.push('<div class="tf">');
      ["T", "F"].forEach(function (k) {
        var cls = "";
        if (ui.judged)
          cls = card.answers[0] === k ? "correct" : ui.selected[0] === k ? "wrong" : "";
        else if (ui.selected[0] === k) cls = "sel";
        h.push(
          '<button class="opt ' +
            cls +
            '" data-tf="' +
            k +
            '">' +
            escHtml(k === "T" ? T("tf.true") : T("tf.false")) +
            "</button>",
        );
      });
      h.push("</div>");
    }
    h.push('<div class="answer"' + (ui.revealed ? "" : " hidden") + ">");
    h.push(
      '<div class="ans-head"><span class="caption">' +
        escHtml(T("quiz.answer")) +
        '</span><span class="ans-text">' +
        fmt(answerText(card)) +
        "</span>",
    );
    if (ui.judged) {
      h.push(
        '<span class="verdict ' +
          (sameSet(ui.selected, card.answers) ? "ok" : "bad") +
          '">' +
          escHtml(sameSet(ui.selected, card.answers) ? T("quiz.correct") : T("quiz.incorrect")) +
          "</span>",
      );
    }
    h.push("</div>");
    if (card.note) h.push('<div class="note">' + fmt(card.note) + "</div>");
    h.push("</div>");
    if (!ui.revealed)
      h.push('<button class="reveal" id="btnReveal">' + escHtml(T("quiz.reveal")) + "</button>");
    h.push("</article>");
    return h.join("");
  }
  function renderDone() {
    var s = state.session;
    rateBar.hidden = true;
    return (
      '<section class="panel"><h2>' +
      escHtml(T("done.title")) +
      "</h2>" +
      "<p>" +
      escHtml(T("done.text", state.order.length)) +
      "</p>" +
      '<div class="stats"><div class="stat"><b>' +
      s.good +
      "</b><span>" +
      escHtml(T("rate.good")) +
      "</span></div>" +
      '<div class="stat"><b>' +
      s.hard +
      "</b><span>" +
      escHtml(T("rate.hard")) +
      "</span></div>" +
      '<div class="stat"><b>' +
      s.again +
      "</b><span>" +
      escHtml(T("rate.again")) +
      "</span></div></div>" +
      '<div class="row"><button class="btn primary" id="btnRedo">' +
      escHtml(T("done.redo")) +
      "</button>" +
      '<button class="btn" id="btnDrill">' +
      escHtml(T("done.drill")) +
      "</button></div></section>"
    );
  }
  function renderEmpty() {
    rateBar.hidden = true;
    return (
      '<section class="panel"><h2>' +
      escHtml(T("quiz.noCards")) +
      "</h2>" +
      "<p>" +
      escHtml(T("empty.text")) +
      "</p>" +
      '<div class="row"><button class="btn primary" id="btnOpenFilter">' +
      escHtml(T("empty.adjust")) +
      "</button>" +
      '<button class="btn" id="btnAll">' +
      escHtml(T("empty.all")) +
      "</button></div></section>"
    );
  }
  function needPick() {
    return !hasFilter() && !store.lastDeck;
  }
  function renderChooser() {
    rateBar.hidden = true;
    progCount.textContent = "– / –";
    barFill.style.width = "0%";
    chapterLabel.textContent = T("chooser.none");
    var groups = [],
      i;
    DECKS.forEach(function (d) {
      if (!deckStats(d).total) return;
      var g = null;
      for (i = 0; i < groups.length; i++) if (groups[i].name === d.field) g = groups[i];
      if (!g) {
        g = { name: d.field, items: [] };
        groups.push(g);
      }
      g.items.push(d);
    });
    var nWrong = countWrong(),
      nDue = countDue();
    var quick = "";
    if (nWrong || nDue) {
      quick =
        '<div class="chips" style="margin-top:12px">' +
        (nWrong
          ? '<button class="chip" data-act="wrong">' +
            escHtml(T("scope.wrong")) +
            " " +
            nWrong +
            "</button>"
          : "") +
        (nDue
          ? '<button class="chip" data-act="due">' +
            escHtml(T("scope.due")) +
            " " +
            nDue +
            "</button>"
          : "") +
        "</div>";
    }
    return (
      '<section class="panel" style="margin-top:14px"><h2>' +
      escHtml(T("chooser.title")) +
      "</h2>" +
      "<p>" +
      escHtml(T("chooser.text")) +
      "</p>" +
      quick +
      groups
        .map(function (g) {
          return (
            '<div class="deck-group" style="margin-top:16px"><h2>' +
            escHtml(fieldLabel(g.name)) +
            "</h2>" +
            g.items
              .map(function (d) {
                return deckHTML({ d: d, st: deckStats(d) });
              })
              .join("") +
            "</div>"
          );
        })
        .join("") +
      '<div class="row" style="margin-top:14px"><button class="btn" id="btnGoDecks">' +
      escHtml(T("chooser.browse")) +
      "</button></div></section>"
    );
  }
  function render() {
    if (needPick()) {
      cardArea.innerHTML = renderChooser();
      return;
    }
    if (!state.order.length) {
      cardArea.innerHTML = renderEmpty();
      setProgress();
      return;
    }
    if (state.pos >= state.order.length) {
      cardArea.innerHTML = renderDone();
      setProgress();
      return;
    }
    rateBar.hidden = document.body.getAttribute("data-mode") !== "quiz";
    cardArea.innerHTML = renderCard(state.order[state.pos]);
    setProgress();
    var revealed = state.ui.revealed;
    btnAgain.disabled = !revealed;
    btnHard.disabled = !revealed;
    btnGood.disabled = !revealed;
  }
  function reveal() {
    if (!state.ui.revealed) {
      state.ui.revealed = true;
      render();
    }
  }
  function pickOption(id) {
    if (state.ui.judged) return;
    if (state.order[state.pos].type === "multiple_choice") {
      var k = state.ui.selected.indexOf(id);
      if (k >= 0) state.ui.selected.splice(k, 1);
      else state.ui.selected.push(id);
      render();
    } else {
      state.ui.selected = [id];
      state.ui.judged = true;
      state.ui.revealed = true;
      recordAttempt(state.order[state.pos], state.order[state.pos].answers.indexOf(id) >= 0);
      render();
    }
  }
  function submitChoice() {
    if (!state.ui.selected.length || state.ui.judged) return;
    state.ui.judged = true;
    state.ui.revealed = true;
    var card = state.order[state.pos];
    recordAttempt(card, sameSet(state.ui.selected, card.answers));
    render();
  }
  function answerTF(k) {
    if (state.ui.judged) return;
    state.ui.selected = [k];
    state.ui.judged = true;
    state.ui.revealed = true;
    recordAttempt(state.order[state.pos], state.order[state.pos].answers[0] === k);
    render();
  }
  function toggleFav() {
    var card = state.order[state.pos];
    if (!card) return;
    if (store.fav[card.id]) {
      delete store.fav[card.id];
      toast(lazyT("toast.unstarred"));
    } else {
      store.fav[card.id] = 1;
      toast(lazyT("toast.starred"));
    }
    save();
    render();
  }
  function rate(kind) {
    if (!state.ui.revealed || state.pos >= state.order.length) return;
    var card = state.order[state.pos];
    store.ratings[card.id] = kind;
    scheduleDue(card, kind);
    if (kind === "good") delete store.wrong[card.id];
    state.session[kind]++;
    bumpToday();
    state.pos++;
    resetUI();
    save();
    render();
  }
  function next() {
    if (state.pos >= state.order.length) return;
    state.pos++;
    resetUI();
    save();
    render();
  }
  function prev() {
    if (state.pos <= 0) return;
    state.pos--;
    resetUI();
    save();
    render();
  }

  cardArea.addEventListener("click", function (e) {
    var t = e.target;
    if (deckClick(e)) return;
    if (t.closest("#btnGoDecks")) {
      setMode("deck");
      return;
    }
    if (t.closest("#btnStar")) {
      toggleFav();
      return;
    }
    var opt = t.closest("[data-opt]");
    if (opt) {
      pickOption(opt.getAttribute("data-opt"));
      return;
    }
    var tf = t.closest("[data-tf]");
    if (tf) {
      answerTF(tf.getAttribute("data-tf"));
      return;
    }
    if (t.closest("#btnConfirm")) {
      submitChoice();
      return;
    }
    if (t.closest("#btnReveal")) {
      reveal();
      return;
    }
    if (t.closest("#btnRedo")) {
      state.pos = 0;
      state.session = { again: 0, hard: 0, good: 0 };
      buildOrder();
      render();
      return;
    }
    if (t.closest("#btnDrill")) {
      state.f.scope = "hard";
      buildOrder();
      render();
      syncChips();
      return;
    }
    if (t.closest("#btnOpenFilter")) {
      openDrawer();
      return;
    }
    if (t.closest("#btnAll")) {
      state.f = {
        decks: [],
        chapters: [],
        types: [],
        schools: [],
        years: [],
        scope: "all",
        shuffle: false,
        q: "",
      };
      buildOrder();
      render();
      syncChips();
      return;
    }
    if (t.closest(".card") && !state.ui.revealed) reveal();
  });
  btnAgain.addEventListener("click", function () {
    rate("again");
  });
  btnHard.addEventListener("click", function () {
    rate("hard");
  });
  btnGood.addEventListener("click", function () {
    rate("good");
  });
  btnPrevCard.addEventListener("click", prev);
  btnNextCard.addEventListener("click", function () {
    next();
  });

  var drag = null;
  cardArea.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button")) return;
    drag = { x: e.clientX, y: e.clientY };
  });
  cardArea.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    drag = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    } else if (dy < -70) reveal();
  });
  cardArea.addEventListener("pointercancel", function () {
    drag = null;
  });

  document.addEventListener("keydown", function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.body.getAttribute("data-mode") !== "quiz") {
      if (e.key === "Escape") closeDrawer();
      return;
    }
    if (
      document.activeElement &&
      document.activeElement.closest &&
      document.activeElement.closest("#drawer")
    )
      return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (state.ui.judged) next();
      else reveal();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "1") rate("again");
    else if (e.key === "2") rate("hard");
    else if (e.key === "3") rate("good");
    else if (e.key === "Escape") closeDrawer();
  });

  /* ══════════════ Drawer ══════════════ */
  var chapChips = $("chapChips"),
    typeChips = $("typeChips"),
    scopeChips = $("scopeChips"),
    orderChips = $("orderChips");
  var deckChips = $("deckChips"),
    schoolChips = $("schoolChips"),
    yearChips = $("yearChips");
  function scopeList() {
    var wrong = 0,
      due = 0,
      now = Date.now();
    ALL.forEach(function (c) {
      if (store.wrong[c.id]) wrong++;
      if (store.due[c.id] && store.due[c.id] <= now) due++;
    });
    return [
      { k: "all", t: T("scope.all") },
      { k: "todo", t: T("scope.todo") },
      { k: "done", t: T("scope.done") },
      { k: "hard", t: T("scope.hard") },
      { k: "wrong", t: T("scope.wrong") + (wrong ? " " + wrong : "") },
      { k: "due", t: T("scope.due") + (due ? " " + due : "") },
      { k: "fav", t: T("scope.fav") },
    ];
  }
  function chipsHTML(items, activeFn) {
    return items
      .map(function (it) {
        var on = activeFn(it);
        return (
          '<button class="chip' +
          (on ? " on" : "") +
          '" data-k="' +
          escHtml(it.k) +
          '" aria-pressed="' +
          (on ? "true" : "false") +
          '">' +
          escHtml(it.t) +
          "</button>"
        );
      })
      .join("");
  }
  function syncChips() {
    deckChips.innerHTML = chipsHTML(
      DECKS.map(function (d) {
        return { k: d.id, t: d.name };
      }),
      function (it) {
        return state.f.decks.indexOf(it.k) >= 0;
      },
    );
    if ($("qInput") && $("qInput").value !== (state.f.q || "")) $("qInput").value = state.f.q || "";
    var pool = ALL.filter(deckOn);
    var schs = [],
      yrs = [];
    pool.forEach(function (c) {
      if (c.school && schs.indexOf(c.school) < 0) schs.push(c.school);
      if (c.year && yrs.indexOf(c.year) < 0) yrs.push(c.year);
    });
    yrs.sort().reverse();
    $("srcSection").hidden = !schs.length && !yrs.length;
    schoolChips.innerHTML = chipsHTML(
      schs.map(function (k) {
        return { k: k, t: k };
      }),
      function (it) {
        return state.f.schools.indexOf(it.k) >= 0;
      },
    );
    yearChips.innerHTML = chipsHTML(
      yrs.map(function (k) {
        return { k: k, t: T("drawer.year", k) };
      }),
      function (it) {
        return state.f.years.indexOf(it.k) >= 0;
      },
    );
    var chs = [];
    pool.forEach(function (c) {
      if (chs.indexOf(c.chapter) < 0) chs.push(c.chapter);
    });
    chapChips.innerHTML = chipsHTML(
      chs.map(function (c) {
        return { k: c, t: chapterName(c) };
      }),
      function (it) {
        return state.f.chapters.indexOf(it.k) >= 0;
      },
    );
    var types = ["single_choice", "multiple_choice", "true_false"];
    if (
      ALL.some(function (c) {
        return c.type === "basic";
      })
    )
      types.push("basic");
    types = types.map(function (k) {
      return { k: k, t: typeLabel(k, k) };
    });
    typeChips.innerHTML = chipsHTML(types, function (it) {
      return state.f.types.indexOf(it.k) >= 0;
    });
    scopeChips.innerHTML = chipsHTML(scopeList(), function (it) {
      return state.f.scope === it.k;
    });
    orderChips.innerHTML = chipsHTML(
      [
        { k: "seq", t: T("order.seq") },
        { k: "shuffle", t: T("order.shuffle") },
      ],
      function (it) {
        return (it.k === "shuffle") === !!state.f.shuffle;
      },
    );
    updateMatchLine();
  }
  function updateMatchLine() {
    var ml = $("matchLine");
    if (!ml) return;
    ml.innerHTML =
      T("filter.matchHtml", matchedList().length) +
      (hasFilter()
        ? '<button class="link-btn" id="btnClearFilters">' +
          escHtml(T("filter.reset")) +
          "</button>"
        : "");
  }
  function toggleIn(list, v) {
    var k = list.indexOf(v);
    if (k >= 0) list.splice(k, 1);
    else list.push(v);
  }
  function filterClick(e) {
    var b = e.target.closest("[data-k]");
    if (!b) return;
    var k = b.getAttribute("data-k");
    if (e.currentTarget === scopeChips) state.f.scope = k;
    else if (e.currentTarget === orderChips) state.f.shuffle = k === "shuffle";
    else if (e.currentTarget === typeChips) toggleIn(state.f.types, k);
    else if (e.currentTarget === deckChips) {
      toggleIn(state.f.decks, k);
      state.f.chapters = [];
    } else if (e.currentTarget === schoolChips) toggleIn(state.f.schools, k);
    else if (e.currentTarget === yearChips) toggleIn(state.f.years, k);
    else toggleIn(state.f.chapters, k);
    state.session = { again: 0, hard: 0, good: 0 };
    buildOrder();
    syncChips();
    save();
    render();
  }
  deckChips.addEventListener("click", filterClick);
  schoolChips.addEventListener("click", filterClick);
  yearChips.addEventListener("click", filterClick);
  chapChips.addEventListener("click", filterClick);
  typeChips.addEventListener("click", filterClick);
  scopeChips.addEventListener("click", filterClick);
  orderChips.addEventListener("click", filterClick);
  $("matchLine").addEventListener("click", function (e) {
    if (!e.target.closest("#btnClearFilters")) return;
    state.f = {
      decks: [],
      chapters: [],
      types: [],
      schools: [],
      years: [],
      scope: "all",
      shuffle: false,
      q: "",
    };
    store.lastDeck = null;
    state.session = { again: 0, hard: 0, good: 0 };
    buildOrder(false);
    syncChips();
    save();
    render();
    toast(lazyT("toast.filtersReset"));
  });

  function openDrawer() {
    syncChips();
    drawer.classList.add("on");
    drawer.setAttribute("aria-hidden", "false");
    scrim.classList.add("on");
    document.body.style.overflow = "hidden";
    $("btnCloseDrawer").focus();
  }
  function closeDrawer() {
    drawer.classList.remove("on");
    drawer.setAttribute("aria-hidden", "true");
    scrim.classList.remove("on");
    document.body.style.overflow = "";
  }
  $("btnFilter").addEventListener("click", openDrawer);
  $("btnCloseDrawer").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);

  /* A button whose label changes (a confirm-by-second-click button) keeps its key in data-i18n,
     so a language switch redraws whichever label it shows. */
  function setLabel(el, key) {
    el.setAttribute("data-i18n", key);
    el.textContent = T(key);
  }
  var resetArmed = false;
  $("btnReset").addEventListener("click", function () {
    var btn = this;
    if (!resetArmed) {
      resetArmed = true;
      setLabel(btn, "drawer.resetConfirm");
      setTimeout(function () {
        resetArmed = false;
        setLabel(btn, "drawer.reset");
      }, 3000);
      return;
    }
    store.ratings = {};
    store.fav = {};
    store.today = { d: todayStr(), n: 0 };
    state.pos = 0;
    resetArmed = false;
    setLabel(btn, "drawer.reset");
    save();
    buildOrder();
    render();
    renderToday();
    toast(lazyT("toast.progressCleared"));
  });

  /* ══════════════ Study data backup ══════════════ */
  function exportBackup() {
    var data = {
      app: "kaoyan-cards",
      version: 1,
      at: new Date().toISOString(),
      store: {
        ratings: store.ratings,
        fav: store.fav,
        wrong: store.wrong,
        due: store.due,
        reps: store.reps,
        quiz: store.quiz,
        today: store.today,
        streak: store.streak,
      },
      imported: importedCards,
      docs: docs,
    };
    var blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "kaoyan-backup-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    toast(lazyT("toast.exported"));
  }
  $("btnBackup").addEventListener("click", exportBackup);
  $("btnRestore").addEventListener("click", function () {
    $("fileBackup").click();
  });
  $("fileBackup").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var o = JSON.parse(String(reader.result));
        if (!o || o.app !== "kaoyan-cards") throw new Error("not a backup");
        var st = o.store || {};
        localStorage.setItem(
          keyState(),
          JSON.stringify({
            ratings: st.ratings || {},
            fav: st.fav || {},
            theme: store.theme,
            today: st.today || { d: "", n: 0 },
            filters: state.f,
            pos: 0,
            mode: "deck",
            wrong: st.wrong || {},
            due: st.due || {},
            reps: st.reps || {},
            quiz: st.quiz || { right: 0, wrong: 0 },
            streak: st.streak || { d: "", n: 0 },
            lastDeck: null,
          }),
        );
        if (Array.isArray(o.imported))
          localStorage.setItem(keyImported(), JSON.stringify(o.imported));
        if (Array.isArray(o.docs)) localStorage.setItem(keyDocs(), JSON.stringify(o.docs));
        toast(lazyT("toast.restored"));
        setTimeout(function () {
          location.reload();
        }, 500);
      } catch (err) {
        toast(lazyT("toast.notBackup"));
      }
    };
    reader.readAsText(file, "utf-8");
  });

  /* ══════════════ Card JSON import ══════════════ */
  var fileCards = $("fileCards");
  $("btnImportCards").addEventListener("click", function () {
    fileCards.click();
  });
  fileCards.addEventListener("change", function () {
    var file = fileCards.files && fileCards.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var arr = Array.isArray(data)
          ? data
          : data && Array.isArray(data.cards)
            ? data.cards
            : null;
        if (!arr) throw new Error("no array");
        var added = 0;
        arr.forEach(function (c, i) {
          var n = normalize(c, i);
          if (seen[n.id]) {
            var k = 0;
            while (seen[n.id + "-" + k]) k++;
            n.id = n.id + "-" + k;
          }
          seen[n.id] = 1;
          n.deck = c.deck || "imp_misc";
          ALL.push(n);
          importedCards.push(c);
          added++;
        });
        refreshChapters();
        saveImported();
        syncImportedDeck();
        buildOrder(false);
        syncChips();
        render();
        toast(added ? lazyT("toast.cardsImported", added) : lazyT("toast.noNewCards"));
      } catch (err) {
        toast(lazyT("toast.badCardJson"));
      }
      fileCards.value = "";
    };
    reader.readAsText(file, "utf-8");
  });

  /* ══════════════ Home ══════════════ */
  var GOAL_CHOICES = [10, 20, 30, 50, 100];
  function greeting() {
    var h = new Date().getHours();
    if (h < 6) return T("greet.night");
    if (h < 11) return T("greet.morning");
    if (h < 14) return T("greet.noon");
    if (h < 18) return T("greet.afternoon");
    return T("greet.evening");
  }
  function countGood() {
    var n = 0;
    ALL.forEach(function (c) {
      if (store.ratings[c.id] === "good") n++;
    });
    return n;
  }
  function renderHome() {
    var d = new Date(),
      goal = store.goal || 30;
    if (store.today.d !== todayStr()) store.today = { d: todayStr(), n: 0 };
    var done = store.today.n || 0,
      pct = goal ? Math.min(1, done / goal) : 0;
    $("heroHi").textContent = greeting();
    $("heroDate").textContent =
      T("home.date", d) + (store.streak.n > 1 ? " · " + T("home.streak", store.streak.n) : "");
    $("goalDone").textContent = done;
    $("goalTotal").textContent = goal;
    var C = 2 * Math.PI * 52;
    var fg = $("ringFg");
    fg.style.strokeDasharray = C;
    fg.style.strokeDashoffset = C * (1 - pct);
    fg.setAttribute("class", "ring-fg" + (pct >= 1 ? " done" : ""));

    var due = countDue(),
      wrong = countWrong();
    $("goalMsg").innerHTML =
      pct >= 1
        ? escHtml(T(wrong ? "home.goalDoneWrong" : "home.goalDone"))
        : done
          ? T("home.goalLeftHtml", goal - done)
          : T("home.goalStartHtml", goal);
    $("goalChips").innerHTML = GOAL_CHOICES.map(function (n) {
      return (
        '<button class="chip' +
        (n === goal ? " on" : "") +
        '" data-goal="' +
        n +
        '">' +
        escHtml(T("home.goalChip", n)) +
        "</button>"
      );
    }).join("");
    $("btnStartToday").textContent = due
      ? T("home.reviewDue", due)
      : pct >= 1
        ? T("home.again")
        : T("home.start");

    var right = store.quiz.right || 0,
      wq = store.quiz.wrong || 0;
    var acc = right + wq ? Math.round((right / (right + wq)) * 100) + "%" : "—";
    var tiles = [
      { k: "due", v: due, t: T("stat.due"), hint: T(due ? "tile.dueHint" : "tile.dueNone") },
      {
        k: "wrong",
        v: wrong,
        t: T("tile.wrong"),
        hint: T(wrong ? "tile.wrongHint" : "tile.wrongNone"),
      },
      { k: "good", v: countGood(), t: T("stat.mastered"), hint: T("tile.total", ALL.length) },
      { k: "acc", v: acc, t: T("stat.accuracy"), hint: T("tile.answers", right + wq) },
    ];
    $("homeTiles").innerHTML = tiles
      .map(function (x) {
        var tag = x.k === "acc" ? "div" : "button";
        return (
          "<" +
          tag +
          ' class="tile"' +
          (x.k === "acc" ? "" : ' data-tile="' + x.k + '"') +
          ">" +
          "<b>" +
          x.v +
          "</b><span>" +
          escHtml(x.t) +
          "</span><small>" +
          escHtml(x.hint) +
          "</small></" +
          tag +
          ">"
        );
      })
      .join("");
    $("homeQuick").innerHTML =
      '<button class="quick-btn" data-home-act="continue"><span class="ico">▶</span>' +
      escHtml(T("home.resume")) +
      '<span class="n">' +
      (store.lastDeck ? "" : escHtml(T("home.notStarted"))) +
      "</span></button>" +
      '<button class="quick-btn" data-home-act="due"><span class="ico">↻</span>' +
      escHtml(T("scope.due")) +
      '<span class="n">' +
      (due ? escHtml(T("home.count", due)) : "") +
      "</span></button>" +
      '<button class="quick-btn" data-home-act="wrong"><span class="ico">✕</span>' +
      escHtml(T("scope.wrong")) +
      '<span class="n">' +
      (wrong ? escHtml(T("home.count", wrong)) : "") +
      "</span></button>" +
      '<button class="quick-btn" data-home-act="import"><span class="ico">＋</span>' +
      escHtml(T("home.import")) +
      '<span class="n"></span></button>';

    var rows = DECKS.map(function (deck) {
      return { d: deck, st: deckStats(deck) };
    }).filter(function (x) {
      return x.st.total;
    });
    rows.sort(function (a, b) {
      return b.st.good / b.st.total - a.st.good / a.st.total;
    });
    $("homeDecks").innerHTML = rows
      .map(function (x) {
        var p = Math.round((x.st.good / x.st.total) * 100);
        return (
          '<button class="prog-row" data-deck="' +
          escHtml(x.d.id) +
          '">' +
          '<span class="prog-line"><span class="prog-name">' +
          escHtml(x.d.name) +
          "</span>" +
          '<span class="prog-num">' +
          x.st.good +
          " / " +
          x.st.total +
          " · " +
          p +
          "%</span></span>" +
          '<span class="deck-bar"><i style="width:' +
          p +
          '%"></i></span></button>'
        );
      })
      .join("");
  }
  function continueLast() {
    var id = store.lastDeck;
    if (
      !DECKS.some(function (d) {
        return d.id === id;
      })
    )
      id = DECKS.length ? DECKS[0].id : null;
    if (id) pickDeck(id);
    else toast(lazyT("toast.bankEmpty"));
  }
  $("homeView").addEventListener("click", function (e) {
    var b = e.target.closest("[data-goal]");
    if (b) {
      store.goal = +b.getAttribute("data-goal");
      save();
      renderHome();
      return;
    }
    if (e.target.closest("#btnStartToday")) {
      if (countDue()) openScope("due");
      else continueLast();
      return;
    }
    b = e.target.closest("[data-tile]");
    if (b) {
      var k = b.getAttribute("data-tile");
      if (k === "due") openScope("due");
      else if (k === "wrong") openScope("wrong");
      else if (k === "good") openScope("done");
      return;
    }
    b = e.target.closest("[data-home-act]");
    if (b) {
      var a = b.getAttribute("data-home-act");
      if (a === "continue") continueLast();
      else if (a === "due") openScope("due");
      else if (a === "wrong") openScope("wrong");
      else if (a === "import") openImport();
      return;
    }
    b = e.target.closest("[data-deck]");
    if (b) pickDeck(b.getAttribute("data-deck"));
  });

  /* ══════════════ Decks view (grouped by field) ══════════════ */
  function deckStats(d) {
    var total = 0,
      good = 0,
      wrong = 0;
    ALL.forEach(function (c) {
      if (c.deck !== d.id) return;
      total++;
      if (store.ratings[c.id] === "good") good++;
      if (store.wrong[c.id]) wrong++;
    });
    return { total: total, good: good, wrong: wrong };
  }
  function renderStatsStrip() {
    var total = ALL.length,
      good = 0,
      due = 0,
      now = Date.now();
    ALL.forEach(function (c) {
      if (store.ratings[c.id] === "good") good++;
      if (store.due[c.id] && store.due[c.id] <= now) due++;
    });
    var right = store.quiz.right || 0,
      wrong = store.quiz.wrong || 0;
    var acc = right + wrong ? Math.round((right / (right + wrong)) * 100) + "%" : "—";
    var cells = [
      [total, T("stat.total")],
      [good, T("stat.mastered")],
      [acc, T("stat.accuracy")],
      [store.streak.n || 0, T("stat.streak")],
    ];
    if (due) cells.push([due, T("stat.due")]);
    $("statsStrip").innerHTML = cells
      .map(function (c) {
        return '<div class="cell"><b>' + c[0] + "</b><span>" + escHtml(c[1]) + "</span></div>";
      })
      .join("");
  }
  function chapterList(d) {
    var out = [],
      i;
    ALL.forEach(function (c) {
      if (c.deck !== d.id) return;
      for (i = 0; i < out.length; i++)
        if (out[i].name === c.chapter) {
          out[i].n++;
          return;
        }
      out.push({ name: c.chapter, n: 1 });
    });
    return out;
  }
  function chapterChips(d) {
    var list = chapterList(d);
    if (list.length < 2) return "";
    return (
      '<div class="deck-chaps">' +
      list
        .map(function (x) {
          return (
            '<button class="chip mini" data-deck="' +
            escHtml(d.id) +
            '" data-chap="' +
            escHtml(x.name) +
            '">' +
            escHtml(chapterName(x.name)) +
            '<span class="n">' +
            x.n +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function deckHTML(it) {
    var pct = it.st.total ? Math.round((it.st.good / it.st.total) * 100) : 0;
    return (
      '<div class="deck-wrap">' +
      '<button class="deck" data-deck="' +
      escHtml(it.d.id) +
      '">' +
      '<span class="deck-icon" aria-hidden="true">' +
      escHtml(it.d.icon || T("deck.icon")) +
      "</span>" +
      '<span class="deck-main"><span class="deck-name">' +
      escHtml(it.d.name) +
      (it.d.subject ? '<span class="deck-sub">' + escHtml(it.d.subject) + "</span>" : "") +
      (it.d.year ? '<span class="tag-best">' + escHtml(it.d.year) + "</span>" : "") +
      (store.lastDeck === it.d.id
        ? '<span class="tag-best">' + escHtml(T("deck.last")) + "</span>"
        : "") +
      "</span>" +
      '<span class="deck-desc">' +
      escHtml(it.d.desc || "") +
      "</span>" +
      '<span class="deck-bar"><i style="width:' +
      pct +
      '%"></i></span></span>' +
      '<span class="deck-side">' +
      T("deck.sideHtml", it.st.total, it.st.good) +
      "</span></button>" +
      chapterChips(it.d) +
      "</div>"
    );
  }
  function groupDecks(list) {
    var groups = [];
    list.forEach(function (item) {
      var g = null,
        i;
      for (i = 0; i < groups.length; i++) if (groups[i].name === item.name) g = groups[i];
      if (!g) {
        g = { name: item.name, items: [] };
        groups.push(g);
      }
      g.items.push(item.it);
    });
    return groups
      .map(function (g) {
        return "<h2>" + escHtml(g.name) + "</h2>" + g.items.map(deckHTML).join("");
      })
      .join("");
  }
  function renderDeckView() {
    renderStatsStrip();
    var real = [],
      practice = [];
    DECKS.forEach(function (d) {
      var st = deckStats(d);
      if (!st.total) return;
      var item = { d: d, st: st };
      if (d.kind === "real" || d.school)
        real.push({ name: d.school || T("deck.noSchool"), it: item });
      else practice.push({ name: fieldLabel(d.field), field: d.field, it: item });
    });
    practice.sort(function (a, b) {
      return (a.field === FIELD_PUBLIC ? 0 : 1) - (b.field === FIELD_PUBLIC ? 0 : 1);
    });
    var html = "";
    html += '<div class="deck-group"><h2>' + escHtml(T("decks.real")) + "</h2>";
    if (real.length) html += groupDecks(real);
    if (!real.length)
      html +=
        '<p class="src-hint">' +
        T("decks.realHintHtml") +
        "</p>" +
        '<button class="btn" style="margin-top:8px" data-import="1">' +
        escHtml(T("decks.importReal")) +
        "</button>";
    html += "</div>";
    if (practice.length) {
      html +=
        '<div class="deck-group"><h2>' +
        escHtml(T("decks.practice")) +
        "</h2>" +
        groupDecks(practice) +
        "</div>";
    }
    $("deckGroups").innerHTML = html;
  }
  function pickDeck(id, chapter) {
    var d = null;
    DECKS.forEach(function (x) {
      if (x.id === id) d = x;
    });
    if (!d) return;
    state.f.decks = [id];
    state.f.chapters = chapter ? [chapter] : [];
    state.f.q = "";
    state.f.scope = "all";
    store.lastDeck = id;
    state.session = { again: 0, hard: 0, good: 0 };
    buildOrder(false);
    syncChips();
    save();
    setMode("quiz");
    toast(lazyT("toast.start", d.name + (chapter ? " · " + chapterName(chapter) : "")));
  }
  function deckClick(e) {
    var act = e.target.closest("[data-act]");
    if (act) {
      openScope(act.getAttribute("data-act"));
      return true;
    }
    var chap = e.target.closest("[data-chap]");
    if (chap) {
      pickDeck(chap.getAttribute("data-deck"), chap.getAttribute("data-chap"));
      return true;
    }
    var b = e.target.closest("[data-deck]") || e.target.closest("[data-pick]");
    if (b) {
      pickDeck(b.getAttribute("data-deck") || b.getAttribute("data-pick"));
      return true;
    }
    return false;
  }
  $("deckGroups").addEventListener("click", function (e) {
    if (e.target.closest("[data-import]")) {
      openImport();
      return;
    }
    deckClick(e);
  });
  $("btnContinue").addEventListener("click", continueLast);
  function countWrong() {
    var n = 0;
    ALL.forEach(function (c) {
      if (store.wrong[c.id]) n++;
    });
    return n;
  }
  function countDue() {
    var now = Date.now(),
      n = 0;
    ALL.forEach(function (c) {
      if (store.due[c.id] && store.due[c.id] <= now) n++;
    });
    return n;
  }
  function openScope(scope) {
    var n = scope === "wrong" ? countWrong() : countDue();
    if (!n) {
      toast(lazyT(scope === "wrong" ? "toast.noWrong" : "toast.noDue"));
      return;
    }
    state.f = {
      decks: [],
      chapters: [],
      types: [],
      schools: [],
      years: [],
      scope: scope,
      shuffle: false,
      q: "",
    };
    buildOrder(false);
    syncChips();
    save();
    setMode("quiz");
  }
  $("btnWrongBook").addEventListener("click", function () {
    openScope("wrong");
  });
  $("btnDueToday").addEventListener("click", function () {
    openScope("due");
  });
  var qTimer = null;
  $("qInput").addEventListener("input", function () {
    state.f.q = this.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      buildOrder(true);
      updateMatchLine();
      if (store.mode === "quiz") render();
      save();
    }, 220);
  });

  /* ══════════════ Recite (documents) ══════════════ */
  function currentDoc() {
    for (var i = 0; i < docs.length; i++) if (docs[i].id === state.doc.id) return docs[i];
    return null;
  }
  function renderDocList() {
    if (!docs.length) {
      docSelect.innerHTML = "<option>" + escHtml(T("read.noDocs")) + "</option>";
      docSelect.disabled = true;
      return;
    }
    docSelect.disabled = false;
    docSelect.innerHTML = docs
      .map(function (d) {
        return (
          '<option value="' +
          escHtml(d.id) +
          '"' +
          (d.id === state.doc.id ? " selected" : "") +
          ">" +
          escHtml(T("read.option", d.title || T("read.untitled"), d.blocks ? d.blocks.length : 0)) +
          "</option>"
        );
      })
      .join("");
  }
  /* keepScroll: a language switch draws the document again where the reader is, without going
     back to the saved position. */
  function renderDoc(keepScroll) {
    var d = currentDoc();
    renderDocList();
    var total = d ? d.blocks.length : 0;
    var marked = 0,
      i;
    if (d) for (i = 0; i < d.blocks.length; i++) if (d.marks && d.marks[i]) marked++;
    docBody.className = "doc" + (state.doc.veil ? " veil" : "");
    btnVeil.classList.toggle("on", state.doc.veil);
    btnVeil.setAttribute("aria-pressed", state.doc.veil ? "true" : "false");
    if (!d) {
      docBody.innerHTML = "";
      docMeta.textContent = T("read.noDocs");
      docProgress.textContent = "";
      docBar.style.width = "0%";
      docBody.insertAdjacentHTML("afterend", "");
      var empty = document.querySelector(".doc-empty");
      if (!empty) {
        /* Built once and kept: its texts carry data-i18n, so applyLang redraws them. */
        var box = document.createElement("div");
        box.className = "doc-empty";
        box.innerHTML =
          '<h2 style="margin:0;font-size:17px;font-weight:600" data-i18n="read.emptyTitle">' +
          escHtml(T("read.emptyTitle")) +
          "</h2>" +
          '<p style="margin:0;font-size:13.5px;color:var(--fg-muted);max-width:30ch" data-i18n="read.emptyText">' +
          escHtml(T("read.emptyText")) +
          "</p>" +
          '<div class="row"><button class="btn primary" id="btnImportDoc" data-i18n="home.import">' +
          escHtml(T("home.import")) +
          "</button>" +
          '<button class="btn" id="btnSeedDocs" data-i18n="read.presets">' +
          escHtml(T("read.presets")) +
          "</button></div>";
        readView.appendChild(box);
        $("btnImportDoc").addEventListener("click", openImport);
        var sd = $("btnSeedDocs");
        if (sd)
          sd.addEventListener("click", function () {
            $("btnPresets").click();
          });
      }
      return;
    }
    var old = document.querySelector(".doc-empty");
    if (old) old.remove();
    var html = d.blocks
      .map(function (b, idx) {
        var isHead = b.head ? " head" : "";
        var isMark = d.marks && d.marks[idx] ? " mark" : "";
        var isPeek = state.doc.peek[idx] ? " peek" : "";
        var masked = state.doc.veil && !b.head && !!(d.marks && d.marks[idx]);
        return (
          '<p class="blk' +
          isHead +
          isMark +
          isPeek +
          '" data-i="' +
          idx +
          '">' +
          blockInner(b.text, masked, !!state.doc.peek[idx]) +
          "</p>"
        );
      })
      .join("");
    docBody.innerHTML = html;
    docMeta.textContent = (d.title || T("read.untitled")) + " · " + T("read.paras", total);
    var pct = state.doc.veil
      ? marked
        ? Math.round((countPeek() / marked) * 100)
        : 0
      : total
        ? Math.round((marked / total) * 100)
        : 0;
    docProgress.textContent = state.doc.veil
      ? T("read.veilProgress", marked, countPeek())
      : T("read.marked", marked, total);
    docBar.style.width = pct + "%";
    if (!keepScroll && typeof d.scroll === "number") {
      requestAnimationFrame(function () {
        window.scrollTo(0, d.scroll);
      });
    }
  }
  /* ===== Hide marked: pick out the parts of a paragraph worth testing (numbers, symbols,
     definitions, enumerations, limits…) and blank only those, leaving the rest as a scaffold for
     recall, so each paragraph is blanked in its own places. The rules match Chinese text. ===== */
  var VEIL_RULES = [
    /* Numbers with a unit or a measure word: 0.02mm, 35%, 200 N */
    {
      re: /\d+(?:\.\d+)?\s*(?:%|％|mm|cm|dm|km|N·m|N|kN|MPa|GPa|Pa|kg|g|mg|ms|s|min|h|Hz|HBW|HRC|HBS|HV|r\/min|m\/s|°|℃|倍|次|个|种|类|条|级|项|段|圈|转|分|克|千克|毫米|微米)/g,
      w: 9,
    },
    /* Codes and symbols: Z1, HRC52, σH, α */
    { re: /[A-Za-z]{1,4}\d{1,3}|[A-Z]{2,5}|[αβγδεζησθφψωΣΔλμ]{1,2}\d?/g, w: 8 },
    /* "called …", "defined as …": the name itself */
    {
      re: /(?:称为|叫做|称作|简称|又称|也称|记为|记作|表示为|命名为|定义为)([^，。；、\s]{1,16})/g,
      w: 9,
      g: 1,
    },
    /* Text inside quotation marks and title marks */
    { re: /[“「『《]([^”」』》]{2,30})[”」』》]/g, w: 7, g: 1 },
    /* The subject of a definition ("tolerance is …") */
    { re: /^([^，。；：]{2,14}?)(?:是指|指的是|就是指|是|即|，就是)/g, w: 6, g: 1 },
    /* Limits and conclusions: "must not exceed …", "at most …" */
    {
      re: /(?:必须|不得|应当|需要|最大|最小|不超过|不小于|不大于|不应|不能)([^，。；]{1,18})/g,
      w: 8,
      g: 1,
    },
  ];
  function veilFallback(text) {
    var n = text.length,
      re = /[^，。；：、,.;:!?！？\s]+/g,
      m,
      parts = [],
      i;
    while ((m = re.exec(text))) parts.push({ s: m.index, e: m.index + m[0].length });
    if (parts.length >= 2) {
      var best = parts[1];
      for (i = 2; i < parts.length; i++)
        if (parts[i].e - parts[i].s > best.e - best.s) best = parts[i];
      if (best.e - best.s >= 2) return { s: best.s, e: best.e, w: 3 };
    }
    var s0 = Math.floor(n * 0.42);
    if (s0 > 0 && /[0-9A-Za-z]/.test(text.charAt(s0)) && /[0-9A-Za-z]/.test(text.charAt(s0 - 1)))
      s0--;
    var e0 = Math.min(n, s0 + 22);
    while (e0 > s0 + 2 && /[，。；：、！？,.;:!?]/.test(text.charAt(e0 - 1))) e0--;
    return { s: s0, e: e0, w: 3 };
  }
  function veilSpans(text) {
    var n = text.length,
      spans = [],
      i,
      m;
    if (n < 8) return [];
    for (i = 0; i < VEIL_RULES.length; i++) {
      var r = VEIL_RULES[i],
        re = r.re;
      re.lastIndex = 0;
      var guard = 0;
      while ((m = re.exec(text)) && guard++ < 4000) {
        if (!m[0].length) {
          re.lastIndex++;
          continue;
        }
        var g = r.g || 0;
        if (!m[g]) continue;
        var s = m.index,
          e = m.index + m[0].length;
        if (g) {
          var off = m[0].indexOf(m[g]);
          if (off < 0) continue;
          s = m.index + off;
          e = s + m[g].length;
        }
        spans.push({ s: s, e: e, w: r.w });
      }
    }
    /* Enumerations (shaft, gear, key): blank every other item and leave the rest as hints */
    var reEnum = /[^，。；：、\s（）()]{2,14}(?:、[^，。；：、\s（）()]{2,14})+/g;
    var mE;
    while ((mE = reEnum.exec(text)) && guard++ < 4000) {
      var parts = mE[0].split("、"),
        off = mE.index,
        k2;
      for (k2 = 1; k2 < parts.length; k2 += 2) {
        var st = off + parts.slice(0, k2).join("、").length + 1;
        if (parts[k2].length >= 2) spans.push({ s: st, e: st + parts[k2].length, w: 7 });
      }
    }
    if (!spans.length) spans.push(veilFallback(text));
    spans.sort(function (a, b) {
      return a.s - b.s;
    });
    var merged = [];
    for (i = 0; i < spans.length; i++) {
      var sp = spans[i],
        prev = merged[merged.length - 1];
      if (prev && sp.s <= prev.e) {
        prev.e = Math.max(prev.e, sp.e);
        prev.w = Math.max(prev.w, sp.w);
      } else merged.push({ s: sp.s, e: sp.e, w: sp.w });
    }
    function hidden() {
      var t = 0;
      for (var k = 0; k < merged.length; k++) t += merged[k].e - merged[k].s;
      return t;
    }
    /* Too little hidden: add one span. Too much (or nearly the whole paragraph): release the
       least important spans first. */
    if (hidden() < n * 0.12) {
      var fb = veilFallback(text);
      merged.push(fb);
      merged.sort(function (a, b) {
        return a.s - b.s;
      });
      var m2 = [];
      for (i = 0; i < merged.length; i++) {
        var q = merged[i],
          pv = m2[m2.length - 1];
        if (pv && q.s <= pv.e) {
          pv.e = Math.max(pv.e, q.e);
          pv.w = Math.max(pv.w, q.w);
        } else m2.push({ s: q.s, e: q.e, w: q.w });
      }
      merged = m2;
    }
    while (merged.length > 1 && hidden() > n * 0.62) {
      var lo = 0;
      for (i = 1; i < merged.length; i++) if (merged[i].w < merged[lo].w) lo = i;
      merged.splice(lo, 1);
    }
    /* Keep at least 30% of the text as a hint */
    var keep = n - hidden();
    if (keep < n * 0.3 && merged.length) {
      var big = merged[0];
      for (i = 1; i < merged.length; i++)
        if (merged[i].e - merged[i].s > big.e - big.s) big = merged[i];
      var cut = Math.ceil(n * 0.3 - keep);
      big.s += cut;
      if (big.e - big.s < 2) merged.splice(merged.indexOf(big), 1);
    }
    return merged.filter(function (x) {
      return x.e - x.s > 0;
    });
  }
  function blockInner(text, masked, revealed) {
    if (!masked) return '<span class="t">' + escHtml(text) + "</span>";
    var spans = veilSpans(text),
      out = "",
      pos = 0,
      i;
    if (!spans.length) return '<span class="t">' + escHtml(text) + "</span>";
    for (i = 0; i < spans.length; i++) {
      if (spans[i].s > pos)
        out += '<span class="cue">' + escHtml(text.slice(pos, spans[i].s)) + "</span>";
      out += '<span class="mask">' + escHtml(text.slice(spans[i].s, spans[i].e)) + "</span>";
      pos = spans[i].e;
    }
    if (pos < text.length) out += '<span class="cue">' + escHtml(text.slice(pos)) + "</span>";
    return '<span class="t">' + out + "</span>";
  }
  function countPeek() {
    var n = 0,
      k;
    for (k in state.doc.peek) if (state.doc.peek[k]) n++;
    return n;
  }
  docBody.addEventListener("click", function (e) {
    var blk = e.target.closest(".blk");
    if (!blk) return;
    var d = currentDoc();
    if (!d) return;
    var idx = +blk.getAttribute("data-i");
    if (state.doc.veil && d.marks && d.marks[idx]) {
      state.doc.peek[idx] = !state.doc.peek[idx];
      blk.classList.toggle("peek", !!state.doc.peek[idx]);
      blk.innerHTML = blockInner(d.blocks[idx].text, !d.blocks[idx].head, !!state.doc.peek[idx]);
      docProgress.textContent = T("read.veilProgress", distinctMarks(d), countPeek());
      docBar.style.width =
        (distinctMarks(d) ? Math.round((countPeek() / distinctMarks(d)) * 100) : 0) + "%";
      return;
    }
    d.marks = d.marks || {};
    if (d.marks[idx]) delete d.marks[idx];
    else d.marks[idx] = 1;
    blk.classList.toggle("mark", !!d.marks[idx]);
    state.doc.peek[idx] = false;
    blk.classList.remove("peek");
    blk.innerHTML = blockInner(
      d.blocks[idx].text,
      state.doc.veil && !d.blocks[idx].head && !!d.marks[idx],
      false,
    );
    saveDocs();
    var marked = distinctMarks(d);
    docMeta.textContent =
      (d.title || T("read.untitled")) + " · " + T("read.paras", d.blocks.length);
    if (state.doc.veil) {
      var seen = countPeek();
      docProgress.textContent = T("read.veilProgress", marked, seen);
      docBar.style.width = (marked ? Math.round((seen / marked) * 100) : 0) + "%";
    } else {
      docProgress.textContent = T("read.marked", marked, d.blocks.length);
      docBar.style.width =
        (d.blocks.length ? Math.round((marked / d.blocks.length) * 100) : 0) + "%";
    }
  });
  function distinctMarks(d) {
    var n = 0,
      k;
    if (d && d.marks) for (k in d.marks) if (d.marks[k]) n++;
    return n;
  }
  var scrollTimer;
  window.addEventListener("scroll", function () {
    if (document.body.getAttribute("data-mode") !== "read") return;
    var d = currentDoc();
    if (!d) return;
    clearTimeout(scrollTimer);
    /* Restoring the saved position scrolls too; only a new position is written (and synced). */
    scrollTimer = setTimeout(function () {
      if (d.scroll === window.scrollY) return;
      d.scroll = window.scrollY;
      saveDocs();
    }, 400);
  });
  docSelect.addEventListener("change", function () {
    state.doc.id = docSelect.value;
    state.doc.peek = {};
    renderDoc();
    window.scrollTo(0, 0);
  });
  btnVeil.addEventListener("click", function () {
    state.doc.veil = !state.doc.veil;
    state.doc.peek = {};
    renderDoc();
  });
  $("btnPresets").addEventListener("click", function () {
    var list = presetDocs();
    if (!list.length) {
      toast(lazyT(docsFailed ? "toast.presetsFailed" : "toast.noPresets"));
      return;
    }
    var have = {};
    docs.forEach(function (d) {
      have[d.title] = 1;
    });
    var added = 0;
    list.forEach(function (d) {
      if (have[d.title]) return;
      var cp = JSON.parse(JSON.stringify(d));
      cp.id = "doc-" + Date.now().toString(36) + "-" + added++;
      docs.push(cp);
    });
    if (!added) {
      toast(lazyT("toast.presetsHere"));
      return;
    }
    if (!state.doc.id) state.doc.id = docs[0].id;
    saveDocs();
    renderDoc();
    toast(lazyT("toast.presetsAdded", added));
  });
  $("btnClearMarks").addEventListener("click", function () {
    var d = currentDoc();
    if (!d) return;
    d.marks = {};
    state.doc.peek = {};
    saveDocs();
    renderDoc();
    toast(lazyT("toast.marksCleared"));
  });
  var delArmed = false;
  $("btnDelDoc").addEventListener("click", function () {
    var btn = this,
      d = currentDoc();
    if (!d) return;
    if (!delArmed) {
      delArmed = true;
      setLabel(btn, "read.deleteConfirm");
      setTimeout(function () {
        delArmed = false;
        setLabel(btn, "read.delete");
      }, 3000);
      return;
    }
    delArmed = false;
    setLabel(btn, "read.delete");
    docs = docs.filter(function (x) {
      return x.id !== d.id;
    });
    state.doc.id = docs.length ? docs[0].id : null;
    state.doc.peek = {};
    saveDocs();
    renderDoc();
    toast(lazyT("toast.deleted"));
  });

  /* quiet: no save. startApp opens the saved mode quietly, because a write before
     storage-bridge.js has merged the server's saves would be stamped newer than them. */
  function setMode(mode, quiet) {
    store.mode = mode;
    document.body.setAttribute("data-mode", mode);
    homeView.hidden = mode !== "home";
    quizView.hidden = mode !== "quiz";
    readView.hidden = mode !== "read";
    deckView.hidden = mode !== "deck";
    $("tabHome").classList.toggle("on", mode === "home");
    $("tabDeck").classList.toggle("on", mode === "deck");
    $("tabQuiz").classList.toggle("on", mode === "quiz");
    $("tabRead").classList.toggle("on", mode === "read");
    $("tabHome").setAttribute("aria-selected", mode === "home" ? "true" : "false");
    $("tabDeck").setAttribute("aria-selected", mode === "deck" ? "true" : "false");
    $("tabQuiz").setAttribute("aria-selected", mode === "quiz" ? "true" : "false");
    $("tabRead").setAttribute("aria-selected", mode === "read" ? "true" : "false");
    rateBar.hidden = mode !== "quiz";
    if (mode === "home") {
      renderHome();
    } else if (mode === "quiz") {
      render();
    } else if (mode === "deck") {
      renderDeckView();
    } else {
      if (!state.doc.id && docs.length) state.doc.id = docs[0].id;
      renderDoc();
    }
    if (!quiet) save();
    window.scrollTo(0, 0);
  }
  $("tabHome").addEventListener("click", function () {
    setMode("home");
  });
  $("tabDeck").addEventListener("click", function () {
    setMode("deck");
  });
  $("tabQuiz").addEventListener("click", function () {
    setMode("quiz");
  });
  $("tabRead").addEventListener("click", function () {
    setMode("read");
  });

  /* ══════════════ Import ══════════════ */
  var importModal = $("importModal"),
    pasteArea = $("pasteArea"),
    importPreview = $("importPreview");
  var pending = null,
    parseTimer = null;

  /* One click shows the importer at work: single and multiple choice, true/false, a short answer,
     explanations and both answer-line styles. It is a Chinese exam paper, so it is not translated;
     its first line is the title the sample is imported under. */
  var SAMPLE = [
    "机械设计 · 示例试卷",
    "示例大学 2019 年硕士研究生入学考试",
    "一、选择题",
    "1. 滚动轴承代号 6208 中，轴承的内径为______。",
    "A. 8 mm　B. 20 mm　C. 40 mm　D. 80 mm",
    "【答案】C",
    "【解析】内径代号 04～96 乘以 5 即为内径，08 × 5 = 40 mm。",
    "2. 链传动中，链节数一般取偶数，主要是为了（　）。",
    "A. 提高传动效率",
    "B. 避免使用过渡链节",
    "C. 减小链条磨损",
    "D. 降低运动不均匀性",
    "答案：B",
    "3. 下列措施中，能提高轴的疲劳强度的有______。",
    "A. 增大轴肩处的过渡圆角半径　B. 对轴的表面进行滚压或喷丸处理　C. 轴肩处改用尖角过渡　D. 把合金钢轴换成普通碳钢轴",
    "【答案】AB",
    "二、判断题",
    "4. 带传动中的弹性滑动是不可避免的，而打滑是可以避免的。",
    "【答案】√",
    "5. 闭式软齿面齿轮传动的主要失效形式是齿面磨损。",
    "【答案】×",
    "【解析】应为齿面疲劳点蚀；磨损是开式齿轮的主要失效形式。",
    "三、填空题",
    "6. 一对标准直齿圆柱齿轮，模数 m = 2 mm，小齿轮齿数 z = 30，其分度圆直径为______mm。",
    "【答案】60",
  ].join("\n");

  function openImport() {
    importModal.hidden = false;
    document.body.style.overflow = "hidden";
    fillTargets();
    setTimeout(function () {
      pasteArea.focus();
    }, 60);
  }
  function closeImport() {
    importModal.hidden = true;
    document.body.style.overflow = "";
  }
  function fillTargets() {
    var sel = $("importTarget");
    if (!sel) return;
    var keep = sel.value,
      html = '<option value="__new__">' + escHtml(T("import.newDeck")) + "</option>",
      i,
      ok = false;
    DECKS.forEach(function (d) {
      html +=
        '<option value="' + escHtml(d.id) + '">' + escHtml(T("import.into", d.name)) + "</option>";
    });
    sel.innerHTML = html;
    for (i = 0; i < sel.options.length; i++) if (sel.options[i].value === keep) ok = true;
    sel.value = ok ? keep : "__new__";
  }
  var KIND_ORDER = ["single_choice", "multiple_choice", "true_false", "basic"];
  function briefStem(c) {
    var s = c.type === "true_false" ? c.statement || "" : c.question || c.front || "";
    return s.replace(/\s+/g, " ").trim();
  }
  function briefAnswer(c) {
    if (c.type === "true_false") return c.answer ? T("tf.true") : T("tf.false");
    if (c.type === "multiple_choice") return (c.answers || []).join("").toUpperCase() || "—";
    if (c.type === "basic") return String(c.back || T("type.basic")).slice(0, 12);
    return String(c.answer || "").toUpperCase() || "—";
  }
  function renderPreview(title, cards, blocks, srcName, school, year) {
    pending = {
      title: title,
      cards: cards,
      blocks: blocks,
      srcName: srcName || "",
      school: school || "",
      year: year || "",
    };
    importPreview.hidden = false;
    $("docTitle").value = title;
    $("chkCards").checked = cards.length > 0;
    $("chkDoc").checked = blocks.length > 0;
    $("chkCards").disabled = cards.length === 0;
    $("chkDoc").disabled = blocks.length === 0;
    $("importTarget").disabled = cards.length === 0;
    $("targetLabel").hidden = cards.length === 0;
    $("btnDoImport").disabled = !(cards.length || blocks.length);
    renderPreviewText();
  }
  /* The preview's words; applyLang calls it again so an open preview follows a language switch.
     It leaves the title and the checkboxes as the person set them. */
  function renderPreviewText() {
    if (!pending) return;
    var cards = pending.cards,
      blocks = pending.blocks;
    var srcName = pending.sample ? T("import.sampleSource") : pending.srcName;
    var kinds = {},
      kindHTML = "",
      i;
    cards.forEach(function (c) {
      kinds[c.type] = (kinds[c.type] || 0) + 1;
    });
    for (i = 0; i < KIND_ORDER.length; i++) {
      var k = KIND_ORDER[i];
      if (kinds[k])
        kindHTML += "<span>" + escHtml(typeLabel(k, k)) + " <b>" + kinds[k] + "</b></span>";
    }
    $("kindLine").innerHTML = kindHTML || "<span>" + escHtml(T("import.noQuestions")) + "</span>";
    $("countLine").innerHTML =
      T("import.foundHtml", cards.length, blocks.length) +
      (srcName ? ' · <span class="file-name">' + escHtml(srcName) + "</span>" : "");
    $("pvList").innerHTML = cards.length
      ? cards
          .slice(0, 20)
          .map(function (c) {
            return (
              '<div class="pv-item"><span class="k">' +
              escHtml(typeLabel(c.type, T("type.question"))) +
              '</span><span class="t">' +
              escHtml(briefStem(c)) +
              "</span>" +
              '<span class="a">' +
              escHtml(briefAnswer(c)) +
              "</span></div>"
            );
          })
          .join("") +
        (cards.length > 20
          ? '<div class="pv-empty">' + escHtml(T("import.more", cards.length - 20)) + "</div>"
          : "")
      : '<div class="pv-empty">' + escHtml(T("import.textOnly")) + "</div>";
    $("cardsLabel").innerHTML = T("import.addCardsHtml", cards.length);
    $("docLabel").innerHTML = T("import.addDocHtml", blocks.length);
    fillTargets();
  }
  function parseNow(text, srcName, titleGuess) {
    if (!text || !text.trim()) {
      importPreview.hidden = true;
      pending = null;
      $("btnDoImport").disabled = true;
      return;
    }
    var res = splitContent(text);
    renderPreview(
      titleGuess || (srcName ? srcName.replace(/\.[^.]+$/, "") : T("import.pasted")),
      res.cards,
      res.blocks,
      srcName,
      res.school,
      res.year,
    );
  }

  /* ── Parsing rules: the usual layouts of past papers and revision outlines (Chinese input) ── */
  var SCHOOL_RE = /([\u4e00-\u9fa5]{2,12}?(?:大学|学院))/;
  var YEAR_RE = /((?:19|20)\d{2})\s*年/;
  var Q_NO_RE = /^[（(【\[]?\s*(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.、．)）】\]]\s*/;
  var OPT_START_RE = /^[（(]?([A-Ha-h])\s*(?:[.、．)）:：])\s*/;
  var ANS_RE = /^[（(【\[]?\s*(?:参考|正确)?答案\s*[】\])）]?\s*[:：.、]?\s*(.*)$/;
  var NOTE_RE =
    /^[（(【\[]?\s*(?:解析|答案解析|试题解析|解题思路|分析|点评|考点)\s*[】\])）]?\s*[:：.、]?\s*(.*)$/;
  var TYPE_HEAD_RE = /^[一二三四五六七八九十]+\s*[、.．]\s*.{0,16}$/;

  function detectSource(text) {
    var out = { school: "", year: "" };
    if (!text) return out;
    var y = YEAR_RE.exec(text);
    if (y) out.year = y[1];
    var m = SCHOOL_RE.exec(text);
    if (m) out.school = m[1];
    return out;
  }
  function isHeading(t) {
    if (t.length > 28) return false;
    if (/_{2,}|（\s*）|\(\s*\)/.test(t)) return false;
    if (/[。；;]$/.test(t)) return false;
    if (/^#{1,6}\s/.test(t)) return true;
    if (/^(第[一二三四五六七八九十百零\d]+\s*[章节讲篇部]|Chapter\s*\d)/i.test(t)) return true;
    return TYPE_HEAD_RE.test(t);
  }
  /* A line holding several options ("A. x  B. y  C. z") is split into them */
  function splitOptions(line) {
    var re = /(?:^|[\s\u3000])[（(]?([A-Ha-h])[)）]?\s*[.、．)）:：]\s*/g,
      marks = [],
      m;
    while ((m = re.exec(line)))
      marks.push({ key: m[1].toUpperCase(), start: m.index, textStart: re.lastIndex });
    if (marks.length < 2) return null;
    if (marks[0].key !== "A" && marks[0].key !== "B") return null;
    var i;
    for (i = 1; i < marks.length; i++) {
      if (marks[i].key.charCodeAt(0) !== marks[i - 1].key.charCodeAt(0) + 1) return null;
    }
    var opts = [];
    for (i = 0; i < marks.length; i++) {
      var end = i + 1 < marks.length ? marks[i + 1].start : line.length;
      var txt = line
        .slice(marks[i].textStart, end)
        .trim()
        .replace(/[；;，,]\s*$/, "");
      if (txt) opts.push({ key: marks[i].key, text: txt });
    }
    if (opts.length < 2) return null;
    return { head: line.slice(0, marks[0].start).trim(), opts: opts };
  }
  function cleanAns(a) {
    return String(a == null ? "" : a)
      .replace(/[（(【\[]/g, " ")
      .replace(/[）)】\]]/g, " ")
      .replace(/[\uFF21-\uFF28]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/[、，,;；\/|]+/g, " ")
      .trim();
  }
  function ansLetters(ans, keys) {
    var s = cleanAns(ans).replace(/\s+/g, "").toUpperCase();
    if (!s || !/^[A-H]+$/.test(s)) return [];
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (keys.indexOf(ch) < 0) return [];
      if (out.indexOf(ch) < 0) out.push(ch);
    }
    return out;
  }
  function splitContent(text) {
    var lines = String(text)
      .replace(/\r\n?/g, "\n")
      .replace(/\u3000/g, " ")
      .split("\n");
    var cards = [],
      blocks = [],
      cur = null,
      srcSchool = "",
      srcYear = "",
      section = "";

    function flush() {
      if (!cur) return;
      var card = toCard(cur),
        raw = cur.raw.join("\n").trim();
      if (card) cards.push(card);
      else if (raw) blocks.push(raw);
      cur = null;
    }
    function start(stem) {
      flush();
      cur = {
        stem: stem,
        opts: [],
        answer: null,
        note: "",
        raw: stem ? [stem] : [],
        school: srcSchool,
        year: srcYear,
        section: section,
      };
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;

      /* Paper header: the school and the year, used only to tag the questions */
      var src = detectSource(t);
      if (
        t.length <= 40 &&
        (src.school || src.year) &&
        (/[考卷试题真题入学硕士期末期中复习模拟卷]/.test(t) || t.length <= 16)
      ) {
        if (src.school) srcSchool = src.school;
        if (src.year) srcYear = src.year;
        continue;
      }
      /* Answer line */
      var am = ANS_RE.exec(t);
      if (am && cur && cur.answer == null) {
        cur.answer = am[1].trim();
        cur.raw.push(t);
        continue;
      }
      /* Explanation line */
      var nm = NOTE_RE.exec(t);
      if (nm && cur) {
        cur.note = (cur.note ? cur.note + " " : "") + nm[1].trim();
        cur.raw.push(t);
        continue;
      }
      /* Heading: a chapter heading becomes the section; a question-type heading only separates */
      if (isHeading(t)) {
        flush();
        if (/^(第|#|Chapter)/i.test(t)) section = t.replace(/^#+\s*/, "").trim();
        blocks.push(t);
        continue;
      }
      /* A question number starts a new question */
      var qm = Q_NO_RE.exec(t);
      if (qm && t.length > qm[0].length + 1) {
        start(t.slice(qm[0].length).trim());
        continue;
      }
      /* Several options on one line */
      var sp = splitOptions(t);
      if (sp && (sp.head || cur)) {
        if (!cur) start(sp.head);
        else if (sp.head) cur.stem = (cur.stem ? cur.stem + " " : "") + sp.head;
        for (var oi = 0; oi < sp.opts.length && cur.opts.length < 8; oi++)
          cur.opts.push(sp.opts[oi]);
        cur.raw.push(t);
        continue;
      }
      /* One option per line */
      var om = OPT_START_RE.exec(t);
      if (om && cur && cur.answer == null && t.length > om[0].length) {
        if (cur.opts.length < 8)
          cur.opts.push({ key: om[1].toUpperCase(), text: t.slice(om[0].length).trim() });
        cur.raw.push(t);
        continue;
      }
      /* Continuation line */
      if (cur) {
        if (cur.answer != null) {
          cur.note = (cur.note ? cur.note + " " : "") + t;
          cur.raw.push(t);
          continue;
        }
        if (cur.opts.length) {
          cur.opts[cur.opts.length - 1].text += t;
          cur.raw.push(t);
          continue;
        }
        if (/[。；;]\s*$/.test(cur.stem)) {
          flush();
          blocks.push(t);
          continue;
        }
        cur.stem += t;
        cur.raw.push(t);
        continue;
      }
      blocks.push(t);
    }
    flush();
    return { cards: cards, blocks: blocks, school: srcSchool, year: srcYear };
  }
  function genId() {
    return "imp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }
  function toCard(q) {
    var ansRaw = String(q.answer == null ? "" : q.answer).trim();
    var ans = cleanAns(ansRaw);
    var tag = q.section || IMPORT_TAG;
    var base = {
      schema_version: 1,
      id: genId(),
      note: q.note || "",
      tags: [tag],
      school: q.school || "",
      year: q.year || "",
    };
    var opts = (q.opts || []).filter(function (o) {
      return !!o.text;
    });
    if (!opts.length) {
      if (!ans) return null;
      if (/^(对|√|✓|正确|是|T|TRUE|Y|YES)$/i.test(ans)) {
        return {
          type: "true_false",
          schema_version: 1,
          id: base.id,
          statement: q.stem,
          answer: true,
          note: base.note,
          tags: base.tags,
          school: base.school,
          year: base.year,
        };
      }
      if (/^(错|×|✗|╳|错误|否|F|FALSE|N|NO)$/i.test(ans)) {
        return {
          type: "true_false",
          schema_version: 1,
          id: base.id,
          statement: q.stem,
          answer: false,
          note: base.note,
          tags: base.tags,
          school: base.school,
          year: base.year,
        };
      }
      return {
        type: "basic",
        schema_version: 1,
        id: base.id,
        front: q.stem,
        back: ansRaw,
        note: base.note,
        tags: base.tags,
        school: base.school,
        year: base.year,
      };
    }
    var ids = opts.map(function (o, i) {
      return String.fromCharCode(97 + i);
    });
    var keys = opts.map(function (o, i) {
      return o.key || String.fromCharCode(65 + i);
    });
    var letters = ansLetters(ans, keys);
    var body = {
      schema_version: 1,
      id: base.id,
      question: q.stem,
      options: opts.map(function (o, i) {
        return { id: ids[i], text: o.text };
      }),
      note: base.note,
      tags: base.tags,
      school: base.school,
      year: base.year,
    };
    if (letters.length) {
      var picked = letters.map(function (l) {
        return ids[keys.indexOf(l)];
      });
      if (picked.length === 1) {
        body.type = "single_choice";
        body.answer = picked[0];
        return body;
      }
      body.type = "multiple_choice";
      body.answers = picked;
      return body;
    }
    if (!ans) return null;
    /* Options with a text answer (such as "see the textbook, p. 32") become a short-answer card,
       so nothing is lost */
    return {
      type: "basic",
      schema_version: 1,
      id: base.id,
      front: q.stem + T("import.optionsSuffix", keys.join("/")),
      back: ansRaw,
      note: base.note,
      tags: base.tags,
      school: base.school,
      year: base.year,
    };
  }

  function doImport() {
    if (!pending) return;
    var title = ($("docTitle").value || T("import.defaultTitle")).trim();
    var wantCards = $("chkCards").checked && pending.cards.length > 0;
    var wantDoc = $("chkDoc").checked && pending.blocks.length > 0;
    var addedCards = 0;
    var srcSchool = pending.school || "",
      srcYear = pending.year || "";
    if (!srcSchool || !srcYear) {
      var guess = detectSource(title + " " + (pending.srcName || ""));
      srcSchool = srcSchool || guess.school;
      srcYear = srcYear || guess.year;
    }
    var target = $("importTarget").value || "__new__";
    var deckId =
      target === "__new__"
        ? "imp_" + (srcSchool || "noschool") + "_" + (srcYear || "noyear")
        : target;
    if (wantCards) {
      pending.cards.forEach(function (c) {
        c.deck = deckId;
        if (!c.school) c.school = srcSchool;
        if (!c.year) c.year = srcYear;
      });
      pending.cards.forEach(function (c) {
        var n = normalize(c, 0);
        if (seen[n.id]) {
          var k = 0;
          while (seen[n.id + "-" + k]) k++;
          n.id = n.id + "-" + k;
        }
        seen[n.id] = 1;
        n.deck = c.deck || "imp_misc";
        ALL.push(n);
        importedCards.push(c);
        addedCards++;
      });
      refreshChapters();
      saveImported();
      syncImportedDeck();
      buildOrder(true);
      syncChips();
      render();
    }
    if (wantDoc) {
      var doc = {
        id: "doc-" + Date.now().toString(36),
        title: title,
        school: pending.school || "",
        year: pending.year || "",
        blocks: pending.blocks.map(function (t) {
          var trimmed = t.trim();
          return { text: trimmed, head: trimmed.length <= 22 && !/[。；，,]$/.test(trimmed) };
        }),
        marks: {},
        scroll: 0,
        created: Date.now(),
      };
      docs.unshift(doc);
      state.doc.id = doc.id;
      state.doc.peek = {};
      saveDocs();
    }
    closeImport();
    toast(lazyT("toast.imported", addedCards, wantDoc ? pending.blocks.length : 0));
    if (wantDoc) setMode("read");
    else if (addedCards) setMode("quiz");
    pending = null;
    importPreview.hidden = true;
    $("btnDoImport").disabled = true;
    pasteArea.value = "";
    setFileLabel(noFileLabel);
  }
  /* The dialog's file line is kept as a function, so applyLang can draw it again in the new
     language (a file name stays as it is). */
  function noFileLabel() {
    return T("import.noFile");
  }
  var fileLabel = noFileLabel;
  function setFileLabel(fn) {
    fileLabel = fn;
    $("fileName").textContent = fn();
  }

  /* ── Events ── */
  $("btnImportTop").addEventListener("click", openImport);
  $("btnImport").addEventListener("click", function () {
    closeDrawer();
    openImport();
  });
  $("btnCloseImport").addEventListener("click", closeImport);
  $("btnPickFile").addEventListener("click", function () {
    $("fileDoc").click();
  });

  async function handleFile(file) {
    setFileLabel(function () {
      return T("import.reading", file.name);
    });
    try {
      var text = await fileToText(file);
      if (!text.trim()) throw fail("err.noText");
      setFileLabel(function () {
        return file.name;
      });
      parseNow(text, file.name, file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setFileLabel(function () {
        return T("import.failed", errorText(err) || T("import.unknownError"));
      });
      toast(lazyT("import.failed", errorText(err)));
    }
  }
  $("fileDoc").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (file) handleFile(file);
  });
  /* A drop anywhere on the dialog imports */
  var dropZone = $("dropZone"),
    dragDepth = 0;
  ["dragenter", "dragover"].forEach(function (ev) {
    importModal.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.add("on");
    });
  });
  ["dragleave", "dragend"].forEach(function (ev) {
    importModal.addEventListener(ev, function (e) {
      if (e.target !== importModal && importModal.contains(e.relatedTarget)) return;
      dropZone.classList.remove("on");
    });
  });
  importModal.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZone.classList.remove("on");
    var dt = e.dataTransfer;
    var file = dt && dt.files && dt.files[0];
    if (file) {
      handleFile(file);
      return;
    }
    var txt = dt && dt.getData && dt.getData("text/plain");
    if (txt) {
      pasteArea.value = txt;
      parseNow(txt, "", T("import.pasted"));
    }
  });

  $("btnSample").addEventListener("click", function () {
    pasteArea.value = SAMPLE;
    parseNow(SAMPLE, T("import.sampleSource"), SAMPLE.slice(0, SAMPLE.indexOf("\n")));
    pending.sample = true;
    setFileLabel(function () {
      return T("import.sampleFile");
    });
    toast(lazyT("toast.sampleFilled"));
  });
  pasteArea.addEventListener("input", function () {
    clearTimeout(parseTimer);
    var v = pasteArea.value;
    parseTimer = setTimeout(function () {
      if (!v.trim()) {
        importPreview.hidden = true;
        $("btnDoImport").disabled = true;
        pending = null;
        return;
      }
      parseNow(v, "", T("import.pasted"));
    }, 400);
  });
  pasteArea.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("btnDoImport").disabled) {
      e.preventDefault();
      doImport();
    }
  });
  $("btnResetImport").addEventListener("click", function () {
    pasteArea.value = "";
    pending = null;
    importPreview.hidden = true;
    $("btnDoImport").disabled = true;
    $("fileDoc").value = "";
    setFileLabel(noFileLabel);
  });
  $("btnDoImport").addEventListener("click", doImport);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !importModal.hidden) closeImport();
  });

  /* ══════════════ Theme ══════════════ */
  /* Inside the app's frame the app stamps html.dark / html.light itself, on load and on every
     appearance change, so the page follows the app and hides its own switch. Opened on its own
     (a file, a plain static server) the switch, the saved choice and the system preference
     apply: initTheme runs once now and again in startApp, once the saved choice is read. */
  var btnTheme = $("btnTheme");
  var inAppFrame = window.parent !== window;
  function applyTheme(dark) {
    document.documentElement.classList.toggle("dark", dark);
    var moon = $("iconMoon"),
      sun = $("iconSun");
    if (dark) {
      moon.setAttribute("hidden", "");
      sun.removeAttribute("hidden");
    } else {
      moon.removeAttribute("hidden");
      sun.setAttribute("hidden", "");
    }
  }
  function initTheme() {
    if (inAppFrame) {
      btnTheme.hidden = true;
      return;
    }
    var dark =
      store.theme === "dark" ||
      (store.theme == null &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    applyTheme(dark);
  }
  initTheme();
  btnTheme.addEventListener("click", function () {
    var dark = !document.documentElement.classList.contains("dark");
    applyTheme(dark);
    store.theme = dark ? "dark" : "light";
    save();
  });

  function startApp() {
    started = true;
    document.body.setAttribute("data-mode", "app");
    initTheme();
    renderToday();
    buildOrder(false);
    if (store.pos > 0 && store.pos < state.order.length) state.pos = store.pos;
    syncChips();
    if (docs.length) state.doc.id = docs[0].id;
    setMode(
      store.mode === "read"
        ? "read"
        : store.mode === "quiz"
          ? "quiz"
          : store.mode === "deck"
            ? "deck"
            : "home",
      true,
    );
  }

  /* ══════════════ Language ══════════════ */
  /* started: the bank is read and the views are drawn (startApp). stillCard: renderCard draws
     the card without its entrance animation, for a redraw that only changes the words. */
  var started = false,
    stillCard = false;
  function fill(attr, set) {
    var els = document.querySelectorAll("[" + attr + "]");
    for (var i = 0; i < els.length; i++) set(els[i], T(els[i].getAttribute(attr)));
  }
  /* Puts the current language into every static text (data-i18n*) and draws the visible parts
     again where they are: the open view, the drawer's chips, an open import preview, the load
     note, a toast on screen. Hidden views are drawn when they are next shown. */
  function applyLang() {
    document.title = T("app.title");
    $("appTitleMeta").setAttribute("content", T("app.shortName"));
    fill("data-i18n", function (el, text) {
      el.textContent = text;
    });
    fill("data-i18n-title", function (el, text) {
      el.setAttribute("title", text);
    });
    fill("data-i18n-aria-label", function (el, text) {
      el.setAttribute("aria-label", text);
    });
    fill("data-i18n-placeholder", function (el, text) {
      el.setAttribute("placeholder", text);
    });
    $("fileName").textContent = fileLabel();
    if (toastText && toastEl.classList.contains("on")) toastEl.textContent = toastText();
    var docTitle = $("docTitle"),
      other = I18N.lang() === "zh" ? "en" : "zh";
    if (docTitle.value && docTitle.value === I18N.strings[other]["import.pasted"])
      docTitle.value = T("import.pasted");
    renderLoadNote();
    if (!started) {
      chapterLabel.textContent = T("quiz.preparing");
      todayStat.textContent = T("quiz.today", 0);
      return;
    }
    labelDecks();
    renderToday(); /* also draws the home view when it is open */
    syncChips();
    fillTargets();
    var mode = document.body.getAttribute("data-mode");
    if (mode === "quiz") {
      stillCard = true;
      try {
        render();
      } finally {
        stillCard = false;
      }
    } else if (mode === "deck") renderDeckView();
    else if (mode === "read") renderDoc(true);
    if (!importPreview.hidden) renderPreviewText();
  }
  $("btnLang").addEventListener("click", function () {
    I18N.setLang(I18N.lang() === "zh" ? "en" : "zh");
  });
  I18N.onChange(applyLang);

  /* Fetches the bank and the preset documents, then opens straight into the app. A file that
     fails leaves its part empty and #loadNote says which; imports and progress still work. */
  var loadFailures = [];
  /* Why a data file did not load: the error's own message, or null when it loaded but did not
     hold what the app reads (shown as T('load.badFormat')). */
  function reasonOf(result) {
    if (result.status !== "rejected") return null;
    var r = result.reason;
    return r && r.message ? r.message : String(r);
  }
  function renderLoadNote() {
    if (!loadFailures.length) return;
    var note = $("loadNote");
    note.textContent =
      loadFailures
        .map(function (f) {
          return T(f.key, f.reason == null ? T("load.badFormat") : f.reason);
        })
        .join(T("list.sep")) + T("load.tail");
    note.hidden = false;
  }
  applyLang();
  (async function boot() {
    var got = await Promise.allSettled([fetchJSON("data/decks.json"), fetchJSON("data/docs.json")]);
    if (!(got[0].status === "fulfilled" && useBank(got[0].value))) {
      loadFailures.push({ key: "load.bank", reason: reasonOf(got[0]) });
    }
    if (got[1].status === "fulfilled" && got[1].value && Array.isArray(got[1].value.docs)) {
      PRESETS = got[1].value.docs;
    } else {
      docsFailed = true;
      loadFailures.push({ key: "load.docs", reason: reasonOf(got[1]) });
    }
    renderLoadNote();
    initData();
    startApp();
  })();

  window.__app = {
    count: function () {
      return ALL.length;
    },
    order: function () {
      return state.order.length;
    },
    pos: function () {
      return state.pos;
    },
    docs: function () {
      return docs;
    },
    state: state,
    store: store,
    parse: function (t) {
      return splitContent(t);
    },
    fileToText: fileToText,
    veilSpans: veilSpans,
    blockInner: blockInner,
    decks: function () {
      return DECKS;
    },
    pickDeck: pickDeck,
    renderDecks: renderDeckView,
    deckStats: deckStats,
  };
})();
