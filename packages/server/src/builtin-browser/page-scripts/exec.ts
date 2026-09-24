// Ported from GenericAgent's assets/tmwd_cdp_bridge/background.js (MIT, Copyright (c) 2025 lsdefine) — https://github.com/lsdefine/genericagent
/**
 * web_execute_js's page side: how a script an agent sends is run, and what it gets back.
 * GenericAgent's buildExecScript, whose semantics the skill teaches:
 *
 * - A script whose last line starts with `return` runs as the body of an async function.
 * - Anything else is `eval`ed first, so a bare expression — or the last expression statement
 *   of a longer script — is the value (`document.title` returns the title).
 * - When that is a syntax error about `return` or `await` (a top-level `await`, an early
 *   `return`), it runs as an async function body instead, with `return` put in front of its
 *   last line when that line is an expression.
 * - DOM results come back as HTML (an element as its outerHTML, a NodeList as a list of them),
 *   everything else as JSON.
 *
 * A thrown error is caught and returned as `{ ok: false, error: { name, message } }`, so the
 * caller can tell "the script failed" from "the page could not run it". A JavaScript SOURCE
 * STRING, for the reason simplify.ts gives; the script travels inside it as a JSON string.
 */

const EXEC_HEAD = String.raw`(async () => {
  function smartProcessResult(result) {
    if (result === null || result === undefined || typeof result !== 'object') return result;
    try { if (result.window === result && result.document) return '[Window: ' + (result.location?.href || 'about:blank') + ']'; } catch(_){}
    if (typeof jQuery !== 'undefined' && result instanceof jQuery) {
      const elements = []; for (let i = 0; i < result.length; i++) { if (result[i] && result[i].nodeType === 1) elements.push(result[i].outerHTML); } return elements;
    }
    if (result instanceof NodeList || result instanceof HTMLCollection) {
      const elements = []; for (let i = 0; i < result.length; i++) { if (result[i] && result[i].nodeType === 1) elements.push(result[i].outerHTML); } return elements;
    }
    if (result.nodeType === 1) return result.outerHTML;
    if (!Array.isArray(result) && typeof result === 'object' && 'length' in result && typeof result.length === 'number') {
      const firstElement = result[0];
      if (firstElement && firstElement.nodeType === 1) {
        const elements = []; const length = Math.min(result.length, 100);
        for (let i = 0; i < length; i++) { const elem = result[i]; if (elem && elem.nodeType === 1) elements.push(elem.outerHTML); } return elements;
      }
    }
    try { return JSON.parse(JSON.stringify(result, function(key, value) { if (typeof value === 'object' && value !== null) { if (value.nodeType === 1) return value.outerHTML; if (value === window || value === document) return '[Object]'; try { if (value.window === value && value.document) return '[Window]'; } catch(_){} } return value; })); } catch (e) { return '[unserializable: ' + e.message + ']'; }
  }
  try {
    const jsCode = `;

const EXEC_TAIL = String.raw`.trim();
    const lines = jsCode.split(/\r?\n/).filter(l => l.trim());
    const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    let r;
    function _air(c) { const ls = c.split(/\r?\n/); let i = ls.length - 1; while (i >= 0 && !ls[i].trim()) i--; if (i < 0) return c; const t = ls[i].trim(); if (/^(return |return;|return$|let |const |var |if |if\(|for |for\(|while |while\(|switch|try |throw |class |function |async |import |export |\/\/|})/.test(t)) return c; ls[i] = ls[i].match(/^(\s*)/)[1] + 'return ' + t; return ls.join('\n'); }
    if (lastLine.startsWith('return')) {
      r = await (new AsyncFunction(jsCode))();
    } else {
      try { r = eval(jsCode); if (r instanceof Promise) r = await r; } catch (e) {
        if (e instanceof SyntaxError && (/return/i.test(e.message) || /await/i.test(e.message))) { r = await (new AsyncFunction(_air(jsCode)))(); } else throw e;
      }
    }
    return { ok: true, data: smartProcessResult(r) };
  } catch (e) {
    return { ok: false, error: { name: (e && e.name) || 'Error', message: (e && e.message) || String(e) } };
  }
})()`;

/** The expression that runs `code` the way GenericAgent's web_execute_js does (see the module doc). */
export function execExpression(code: string): string {
  return EXEC_HEAD + JSON.stringify(code) + EXEC_TAIL;
}

/** What `execExpression` resolves to. */
export type ExecOutcome =
  { ok: true; data?: unknown } | { ok: false; error: { name: string; message: string } };
