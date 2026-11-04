/**
 * Bare URLs in chat Markdown: where one starts, what it may contain, and where it ends.
 *
 * GFM's autolink literal runs a bare URL to the next whitespace or `<`. Chinese puts no space
 * after a URL, so in `**http://localhost:7367/**，要看的博文：http://…` everything up to the end
 * of the line is one link: the `**` meant to close the bold, the comma, the clause and the
 * second URL. Trimming the link afterwards cannot repair the bold, because emphasis is resolved
 * while parsing, with the `**` already inside the URL.
 *
 * So the URL is bounded while parsing, by this micromark construct, which replaces GFM's.
 *
 * ## The rule
 *
 * - **Characters.** A URL is made of the characters RFC 3986 allows, ASCII only:
 *   `A–Z a–z 0–9 - . _ ~ : / ? # [ ] @ ! $ & ' ( ) * + , ; = %`. Anything else ends it: CJK
 *   text, full-width punctuation, emoji, whitespace, `<`, `>`, `"`, `` ` ``, `{`, `}`, `|`, `\`,
 *   `^`. A URL with unencoded non-ASCII in it (`…/wiki/中文` pasted raw) is cut before the first
 *   such character; the same URL percent-encoded is kept whole.
 * - **Trail.** GFM's trail rule then applies at that end: a run of `! & ' ) * , . : ; ? _ ~`
 *   (and an `&name;` reference) directly before the end is left out of the URL, so the `.` of a
 *   sentence and the `**` of a bold span stay text. The same characters inside the URL stay in
 *   it: `https://a.com/a_b?q=*b`.
 * - **Brackets.** A `)` the URL opened stays in it, as in GFM: `https://a.com/x_(y)`. A `]` the
 *   URL did not open ends it outright — RFC 3986 allows brackets only around an IP literal — and
 *   that is also what keeps a URL inside a `[label](…)` from running into the label's end.
 * - **Start.** `http://` and `https://` (any case) after anything but an ASCII letter, and `www.`
 *   followed by a letter or digit, after anything but an ASCII letter: `中文https://…` and
 *   `访问www.…` link. The domain is ASCII letters, digits, `-`, `.` and `_`, with GFM's checks (no
 *   `_` in the last two labels). An email address is GFM's: ASCII already, so unchanged.
 * - **Never inside a link.** A URL in a link's text renders as that text, not a second link:
 *   `[https://a.com](https://b.com)` is one link to b. Code spans, fenced and indented code and
 *   math never reach a text construct, so nothing in them is linked. `<https://a.com>` is
 *   CommonMark's own autolink and `[text](url)` is a link; neither goes through here.
 *
 * Because the URL ends where the rule says, the `**` after it is an ordinary delimiter run, and
 * emphasis pairs as if the URL were a word: `**http://localhost:7367/**，` is bold.
 *
 * ## Shape
 *
 * Three constructs on the characters GFM's autolink literal uses (`h`/`H` for a protocol, `w`/`W`
 * for `www.`, every ASCII letter, digit and `+ - . _` for an email), each producing one token
 * whose text is the whole URL. The mdast extension turns that token into a `link` node holding one
 * `text` child, as GFM does, or into plain text when it sits inside a link already.
 *
 * Types are declared structurally rather than taken from `micromark-util-types` and
 * `mdast-util-from-markdown`, the trade packages/ui's own micromark constructs make.
 */

type Code = number | null;
interface Token {
  type: string;
}
type State = (code: Code) => State | undefined;
interface TokenizeContext {
  /** The character before the one being tokenized; `null` at the start of the content. */
  previous: Code;
}
type Tokenizer = (this: TokenizeContext, effects: Effects, ok: State, nok: State) => State;
interface Construct {
  tokenize: Tokenizer;
  partial?: boolean;
  name?: string;
  previous?: (this: TokenizeContext, code: Code) => boolean;
}
interface Effects {
  enter(type: string): Token;
  exit(type: string): Token;
  consume(code: Code): void;
  attempt(construct: Construct, ok: State, nok?: State): State;
  check(construct: Construct, ok: State, nok?: State): State;
}

/** The mdast nodes this builds, and the compile context's members the handlers use. */
interface MdNode {
  type: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
}
type Handle = (this: CompileContext, token: Token) => void;
interface CompileContext {
  stack: MdNode[];
  data: Record<string, unknown>;
  config: { enter: Record<string, Handle>; exit: Record<string, Handle> };
  enter(node: MdNode, token: Token): void;
  exit(token: Token): void;
  sliceSerialize(token: Token): string;
}

const AMPERSAND = 38;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;
const PLUS = 43;
const DASH = 45;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const SEMICOLON = 59;
const AT = 64;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const UNDERSCORE = 95;

function isAsciiAlpha(code: Code): boolean {
  return code !== null && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122));
}

function isAsciiAlphanumeric(code: Code): boolean {
  return isAsciiAlpha(code) || (code !== null && code >= 48 && code <= 57);
}

/** The printable ASCII characters RFC 3986 does not allow in a URL. */
const NOT_IN_URL = new Set([...'"<>\\^`{|}'].map((ch) => ch.charCodeAt(0)));

/**
 * Whether `code` may be part of a URL. micromark's negative codes (line endings, tabs, virtual
 * spaces), the space and everything outside ASCII fall below or above the printable range.
 */
function isUrlCharacter(code: Code): boolean {
  return code !== null && code > 32 && code < 127 && !NOT_IN_URL.has(code);
}

/** GFM's trailing punctuation, less `"` and `<`, which end a URL here before any trail. */
const TRAIL = new Set([..."!')*,.:;?_~"].map((ch) => ch.charCodeAt(0)));

/** An email's local part: ASCII letters, digits, `+`, `-`, `.`, `_`. */
function isAtext(code: Code): boolean {
  return (
    code === PLUS ||
    code === DASH ||
    code === DOT ||
    code === UNDERSCORE ||
    isAsciiAlphanumeric(code)
  );
}

/** A protocol URL or `www.` may start after anything but an ASCII letter (`xhttp://` is a word). */
function startsAfter(code: Code): boolean {
  return !isAsciiAlpha(code);
}

/** An email may not start inside another one, nor right after a `/` (GFM's rule). */
function emailStartsAfter(code: Code): boolean {
  return !(code === SLASH || isAtext(code));
}

/**
 * Whether the run of trailing punctuation starting here reaches the end of the URL: `ok` when it
 * does (the run is left out), `nok` when a URL character follows it (the run is part of the URL).
 * A `]` counts as the end unless the URL has an open `[` for it to close.
 */
function trailConstruct(insideBrackets: boolean): Construct {
  return {
    partial: true,
    tokenize(effects, ok, nok) {
      return trail;

      function trail(code: Code): State | undefined {
        if (code !== null && TRAIL.has(code)) {
          effects.consume(code);
          return trail;
        }
        // `&` then letters then `;` is a character reference, which trails as a whole; any other
        // `&` is part of the URL.
        if (code === AMPERSAND) {
          effects.consume(code);
          return referenceStart;
        }
        if (code === RIGHT_BRACKET) return insideBrackets ? nok(code) : ok(code);
        return isUrlCharacter(code) ? nok(code) : ok(code);
      }

      function referenceStart(code: Code): State | undefined {
        return isAsciiAlpha(code) ? referenceInside(code) : nok(code);
      }

      function referenceInside(code: Code): State | undefined {
        if (code === SEMICOLON) {
          effects.consume(code);
          return trail;
        }
        if (isAsciiAlpha(code)) {
          effects.consume(code);
          return referenceInside;
        }
        return nok(code);
      }
    },
  };
}

/** The trail outside any `[` the URL opened (always, in a domain), and inside one. */
const trailOutsideBrackets = trailConstruct(false);
const trailInsideBrackets = trailConstruct(true);

/**
 * A domain: ASCII letters, digits, `-`, and `.` / `_` that are not trailing punctuation. Refused
 * when empty or when either of its last two labels holds a `_` (GFM's checks).
 */
const domain: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let underscoreInLast = false;
    let underscoreInSecondLast = false;
    let seen = false;
    return inside;

    function inside(code: Code): State | undefined {
      if (code === DOT || code === UNDERSCORE) {
        return effects.check(trailOutsideBrackets, after, atPunctuation)(code);
      }
      if (code === DASH || isAsciiAlphanumeric(code)) {
        seen = true;
        effects.consume(code);
        return inside;
      }
      return after(code);
    }

    function atPunctuation(code: Code): State | undefined {
      if (code === UNDERSCORE) {
        underscoreInLast = true;
      } else {
        underscoreInSecondLast = underscoreInLast;
        underscoreInLast = false;
      }
      effects.consume(code);
      return inside;
    }

    function after(code: Code): State | undefined {
      return seen && !underscoreInLast && !underscoreInSecondLast ? ok(code) : nok(code);
    }
  },
};

/** Everything after the domain: URL characters, up to the trail, a stray `]` or the end. */
const path: Construct = {
  partial: true,
  tokenize(effects, ok) {
    let parensOpen = 0;
    let parensClosed = 0;
    let bracketsOpen = 0;
    let bracketsClosed = 0;
    return inside;

    function inside(code: Code): State | undefined {
      if (code === LEFT_PAREN) {
        parensOpen += 1;
        effects.consume(code);
        return inside;
      }
      if (code === RIGHT_PAREN && parensClosed < parensOpen) return atPunctuation(code);
      if (code === LEFT_BRACKET) {
        bracketsOpen += 1;
        effects.consume(code);
        return inside;
      }
      if (code === RIGHT_BRACKET) {
        if (bracketsClosed === bracketsOpen) return ok(code);
        bracketsClosed += 1;
        effects.consume(code);
        return inside;
      }
      if (code === AMPERSAND || (code !== null && TRAIL.has(code))) {
        const trail = bracketsClosed < bracketsOpen ? trailInsideBrackets : trailOutsideBrackets;
        return effects.check(trail, ok, atPunctuation)(code);
      }
      if (isUrlCharacter(code)) {
        effects.consume(code);
        return inside;
      }
      return ok(code);
    }

    function atPunctuation(code: Code): State | undefined {
      if (code === RIGHT_PAREN) parensClosed += 1;
      effects.consume(code);
      return inside;
    }
  },
};

/** The token types, one per kind; each spans the whole URL as written. */
const HTTP = "bareUrlHttp";
const WWW = "bareUrlWww";
const EMAIL = "bareUrlEmail";

/** `http://` or `https://`, a domain, then a path. */
const protocolUrl: Construct = {
  name: HTTP,
  previous: startsAfter,
  tokenize(effects, ok, nok) {
    const self = this;
    let scheme = "";
    let slashes = 0;
    return start;

    function start(code: Code): State | undefined {
      // micromark offers a construct its character once any construct registered on it accepts
      // the previous one, so the check is repeated here.
      if (!startsAfter(self.previous)) return nok(code);
      effects.enter(HTTP);
      return schemeInside(code);
    }

    function schemeInside(code: Code): State | undefined {
      if (isAsciiAlpha(code) && scheme.length < 5) {
        scheme += String.fromCharCode(code!);
        effects.consume(code);
        return schemeInside;
      }
      const lower = scheme.toLowerCase();
      if (code === COLON && (lower === "http" || lower === "https")) {
        effects.consume(code);
        return slashesInside;
      }
      return nok(code);
    }

    function slashesInside(code: Code): State | undefined {
      if (code !== SLASH) return nok(code);
      effects.consume(code);
      slashes += 1;
      return slashes === 2 ? afterScheme : slashesInside;
    }

    function afterScheme(code: Code): State | undefined {
      if (!isAsciiAlphanumeric(code)) return nok(code);
      return effects.attempt(domain, effects.attempt(path, done), nok)(code);
    }

    function done(code: Code): State | undefined {
      effects.exit(HTTP);
      return ok(code);
    }
  },
};

/** `www.` followed by a letter or digit: checked first, then read again as part of the domain. */
const wwwPrefix: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let size = 0;
    return inside;

    function inside(code: Code): State | undefined {
      if ((code === 87 || code === 119) && size < 3) {
        size += 1;
        effects.consume(code);
        return inside;
      }
      if (code === DOT && size === 3) {
        effects.consume(code);
        return after;
      }
      return nok(code);
    }

    function after(code: Code): State | undefined {
      return isAsciiAlphanumeric(code) ? ok(code) : nok(code);
    }
  },
};

/** `www.example.com…`, linked as `http://www.example.com…`. */
const wwwUrl: Construct = {
  name: WWW,
  previous: startsAfter,
  tokenize(effects, ok, nok) {
    const self = this;
    return start;

    function start(code: Code): State | undefined {
      if (!startsAfter(self.previous)) return nok(code);
      effects.enter(WWW);
      return effects.check(
        wwwPrefix,
        effects.attempt(domain, effects.attempt(path, done), nok),
        nok,
      )(code);
    }

    function done(code: Code): State | undefined {
      effects.exit(WWW);
      return ok(code);
    }
  },
};

/** A `.` in an email's domain trails unless a letter or digit follows it. */
const emailDotTrail: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return start;

    function start(code: Code): State | undefined {
      effects.consume(code);
      return after;
    }

    function after(code: Code): State | undefined {
      return isAsciiAlphanumeric(code) ? nok(code) : ok(code);
    }
  },
};

/**
 * `local@domain.tld`, GFM's grammar: a local part of letters, digits and `+ - . _`, then a domain
 * of letters, digits, `-` and `_` with at least one inner `.`, ending in a letter.
 */
const emailUrl: Construct = {
  name: EMAIL,
  previous: emailStartsAfter,
  tokenize(effects, ok, nok) {
    const self = this;
    let dot = false;
    let label = false;
    return start;

    function start(code: Code): State | undefined {
      // Reached on `h` or `w` when the protocol or `www.` construct accepted the character
      // before, which an email may still refuse (`_http…`).
      if (!emailStartsAfter(self.previous)) return nok(code);
      effects.enter(EMAIL);
      return local(code);
    }

    function local(code: Code): State | undefined {
      if (isAtext(code)) {
        effects.consume(code);
        return local;
      }
      if (code === AT) {
        effects.consume(code);
        return domainInside;
      }
      return nok(code);
    }

    function domainInside(code: Code): State | undefined {
      if (code === DOT) return effects.check(emailDotTrail, domainAfter, domainDot)(code);
      if (code === DASH || code === UNDERSCORE || isAsciiAlphanumeric(code)) {
        label = true;
        effects.consume(code);
        return domainInside;
      }
      return domainAfter(code);
    }

    function domainDot(code: Code): State | undefined {
      dot = true;
      effects.consume(code);
      return domainInside;
    }

    function domainAfter(code: Code): State | undefined {
      if (!label || !dot || !isAsciiAlpha(self.previous)) return nok(code);
      effects.exit(EMAIL);
      return ok(code);
    }
  },
};

/** The micromark syntax extension: the three constructs on the characters each can start with. */
export const bareUrlSyntax: { text: Record<number, Construct[]> } = (() => {
  const text: Record<number, Construct[]> = {};
  for (let code = 48; code <= 122; code += 1) {
    if (isAsciiAlphanumeric(code)) text[code] = [emailUrl];
  }
  for (const code of [PLUS, DASH, DOT, UNDERSCORE]) text[code] = [emailUrl];
  // The email construct first, as in GFM: `http@example.com` is an address.
  for (const code of [72, 104]) text[code] = [emailUrl, protocolUrl];
  for (const code of [87, 119]) text[code] = [emailUrl, wwwUrl];
  return { text };
})();

/** Set on entering a URL that sits inside a link, and read on leaving it. */
const INSIDE_LINK = "bareUrlInsideLink";

function enterUrl(this: CompileContext, token: Token): void {
  const insideLink = this.stack.some((node) => node.type === "link");
  this.data[INSIDE_LINK] = insideLink;
  if (!insideLink) this.enter({ type: "link", title: null, url: "", children: [] }, token);
  // The URL's text: a text child of the new link, or more of the text it sits in.
  this.config.enter.data!.call(this, token);
}

function exitUrl(prefix: string): Handle {
  return function (this: CompileContext, token: Token): void {
    this.config.exit.data!.call(this, token);
    if (this.data[INSIDE_LINK]) return;
    this.stack[this.stack.length - 1]!.url = prefix + this.sliceSerialize(token);
    this.exit(token);
  };
}

/** The mdast extension: each URL token becomes a `link` holding its text, as GFM's do. */
export const bareUrlFromMarkdown: {
  enter: Record<string, Handle>;
  exit: Record<string, Handle>;
} = {
  enter: { [HTTP]: enterUrl, [WWW]: enterUrl, [EMAIL]: enterUrl },
  exit: { [HTTP]: exitUrl(""), [WWW]: exitUrl("http://"), [EMAIL]: exitUrl("mailto:") },
};
